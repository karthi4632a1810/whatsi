import cron from "node-cron";
import { config } from "../config.js";
import {
  getSettings,
  runEmrPoll,
  runBacklogCatchUp,
  sendPendingReports,
} from "../services/reports.js";
import { partsInIst, reportDayKey } from "../utils/dates.js";

let lastEodRunKey = "";

function parseClock(value, fallback = "18:00") {
  const [hh, mm] = String(value || fallback)
    .split(":")
    .map((part) => Number(part));
  return {
    hour: Number.isFinite(hh) ? hh : 18,
    minute: Number.isFinite(mm) ? mm : 0,
  };
}

/** True when India time is at/after today's scheduled send time. */
function isAtOrPastSendTime(endOfDayTime) {
  const now = partsInIst(new Date());
  const { hour, minute } = parseClock(endOfDayTime);
  return now.hour > hour || (now.hour === hour && now.minute >= minute);
}

export function startScheduler() {
  if (config.emr.pollEnabled) {
    cron.schedule(config.emr.pollCron, async () => {
      try {
        const settings = await getSettings();
        if (!settings.automationEnabled) return;

        // 1) Today: refresh board + sync READY → queue
        console.log("[cron] EMR poll start (today)");
        const todayResult = await runEmrPoll({
          autoSend: settings.mode === "IMMEDIATE",
        });
        console.log("[cron] EMR poll done (today)", todayResult.boardRefresh || {}, {
          created: todayResult.created,
          updated: todayResult.updated,
          candidates: todayResult.candidates,
        });

        // 2) Past N days: catch late completions (e.g. 15 Jul order ready on 17 Jul)
        const lookback = config.emr.backlogLookbackDays;
        if (lookback > 0) {
          console.log(`[cron] backlog catch-up start (last ${lookback} days)`);
          const backlog = await runBacklogCatchUp({ lookbackDays: lookback });
          console.log("[cron] backlog catch-up done", {
            days: backlog.days,
            created: backlog.created,
            updated: backlog.updated,
          });

          // Immediate mode: also send anything newly queued from backlog
          if (
            settings.mode === "IMMEDIATE" &&
            settings.messageSendEnabled &&
            !settings.watiTestSendMode &&
            (backlog.created > 0 || backlog.updated > 0)
          ) {
            const sendResult = await sendPendingReports({ triggerType: "AUTO_IMMEDIATE" });
            console.log("[cron] backlog immediate send", sendResult);
          }
        }
      } catch (error) {
        console.error("[cron] EMR poll failed", error.message);
      }
    });
    console.log(
      `[cron] EMR poll scheduled: ${config.emr.pollCron} (today + ${config.emr.backlogLookbackDays} day backlog when Automation is ON)`
    );
  }

  // End-of-day send — India time, once per day at the configured clock
  // Sends ALL pending queue rows (any reportDay), so late 15 Jul READY items
  // synced on 17 Jul go out at 17 Jul's EOD time.
  cron.schedule("* * * * *", async () => {
    try {
      const settings = await getSettings();
      if (!settings.messageSendEnabled || settings.watiTestSendMode) return;
      if (settings.mode !== "END_OF_DAY" && settings.mode !== "CUSTOM_SCHEDULE") return;

      const now = partsInIst(new Date());
      const { hour, minute } = parseClock(settings.endOfDayTime);
      if (now.hour !== hour || now.minute !== minute) return;

      const key = `${reportDayKey()}-${hour}:${minute}`;
      if (lastEodRunKey === key) return;

      lastEodRunKey = key;
      console.log(`[cron] scheduled send start (${settings.endOfDayTime} IST)`);
      const result = await sendPendingReports({ triggerType: "AUTO_EOD" });
      console.log("[cron] scheduled send done", result);
    } catch (error) {
      console.error("[cron] scheduled send failed", error.message);
    }
  });

  // Retries — never dump fresh PENDING before the schedule
  cron.schedule(config.automation.retryCron, async () => {
    try {
      const settings = await getSettings();
      if (!settings.messageSendEnabled || settings.watiTestSendMode) return;

      if (settings.mode === "IMMEDIATE") {
        const result = await sendPendingReports({
          triggerType: "AUTO_EOD",
          statuses: ["FAILED"],
        });
        if (result.sent || result.failed) {
          console.log("[cron] retry (failed only, immediate mode)", result);
        }
        return;
      }

      // END_OF_DAY: only retry failures after the day's send time has passed
      if (!isAtOrPastSendTime(settings.endOfDayTime)) return;

      const result = await sendPendingReports({
        triggerType: "AUTO_EOD",
        statuses: ["FAILED"],
      });
      if (result.sent || result.failed) {
        console.log("[cron] retry (failed only, after schedule)", result);
      }
    } catch (error) {
      console.error("[cron] retry failed", error.message);
    }
  });
}
