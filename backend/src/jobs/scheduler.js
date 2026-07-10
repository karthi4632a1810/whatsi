import cron from "node-cron";
import { config } from "../config.js";
import { getSettings, runEmrPoll, sendPendingReports } from "../services/reports.js";

let lastEodRunKey = "";

export function startScheduler() {
  if (config.emr.pollEnabled) {
    cron.schedule(config.emr.pollCron, async () => {
      try {
        const settings = await getSettings();
        if (!settings.automationEnabled) return;

        console.log("[cron] EMR poll start");
        const result = await runEmrPoll({
          autoSend: settings.mode === "IMMEDIATE",
        });
        console.log("[cron] EMR poll done", result.boardRefresh || {}, result);
      } catch (error) {
        console.error("[cron] EMR poll failed", error.message);
      }
    });
    console.log(`[cron] EMR poll scheduled: ${config.emr.pollCron} (runs when queue sync is ON in Settings)`);
  }

  cron.schedule("* * * * *", async () => {
    try {
      const settings = await getSettings();
      if (!settings.messageSendEnabled || settings.mode !== "END_OF_DAY" || settings.watiTestSendMode) return;

      const [hh, mm] = String(settings.endOfDayTime || "18:00").split(":").map(Number);
      const now = new Date();
      const key = `${now.toISOString().slice(0, 10)}-${hh}:${mm}`;
      if (now.getHours() !== hh || now.getMinutes() !== mm || lastEodRunKey === key) return;

      lastEodRunKey = key;
      console.log("[cron] EOD send start");
      const result = await sendPendingReports({ triggerType: "AUTO_EOD" });
      console.log("[cron] EOD send done", result);
    } catch (error) {
      console.error("[cron] EOD send failed", error.message);
    }
  });

  cron.schedule(config.automation.retryCron, async () => {
    try {
      const settings = await getSettings();
      if (!settings.messageSendEnabled || settings.watiTestSendMode) return;
      const result = await sendPendingReports({ triggerType: "AUTO_EOD" });
      if (result.sent || result.failed) {
        console.log("[cron] retry pass", result);
      }
    } catch (error) {
      console.error("[cron] retry failed", error.message);
    }
  });
}
