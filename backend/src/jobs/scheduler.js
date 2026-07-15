import cron from "node-cron";
import { config } from "../config.js";
import { getSettings, runEmrPoll, sendPendingReports } from "../services/reports.js";
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

        // Sync board → queue only. Sends only when Mode = Immediate.
        console.log("[cron] EMR poll start");
        const result = await runEmrPoll({
          autoSend: settings.mode === "IMMEDIATE",
        });
        console.log("[cron] EMR poll done", result.boardRefresh || {}, result);
      } catch (error) {
        console.error("[cron] EMR poll failed", error.message);
      }
    });
    console.log(
      `[cron] EMR poll scheduled: ${config.emr.pollCron} (queue sync when Automation is ON)`
    );
  }

  // End-of-day send — India time, once per day at the configured clock
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
