import cron from "node-cron";
import { config } from "../config.js";
import {
  dispatchDueReports,
  getSettings,
  recoverStaleSends,
  runBacklogCatchUp,
  runEmrPoll,
} from "../services/reports.js";
import { recoverBoardState } from "../services/hisBoardStore.js";
import { runDeliveryChecks } from "../services/delivery.js";
import { isReadOnlyMode } from "../services/appSettings.js";
import { startPdfCache, sweepPdfCache } from "../services/reportPdf.js";

// What the jobs last did — shown on the dashboard and in Settings.
const jobState = {
  emrPoll: { lastStartedAt: null, lastFinishedAt: null, lastResult: null, lastError: "" },
  sender: { lastRunAt: null, lastResult: null, lastSentAt: null, lastError: "" },
  delivery: { lastRunAt: null, lastResult: null, lastError: "" },
};

export function getJobState() {
  return jobState;
}

let emrPollRunning = false;
let senderRunning = false;

async function emrPollJob() {
  if (emrPollRunning) return;
  const settings = await getSettings();
  if (!settings.automationEnabled) return;
  emrPollRunning = true;
  jobState.emrPoll.lastStartedAt = new Date();
  try {
    // 1) Today: refresh the OP board + queue newly approved reports
    const today = await runEmrPoll();
    // 2) Past N days: orders that became ready after their lab day
    const backlog =
      config.emr.backlogLookbackDays > 0
        ? await runBacklogCatchUp({ lookbackDays: config.emr.backlogLookbackDays })
        : null;
    jobState.emrPoll.lastResult = {
      today: {
        created: today.created,
        updated: today.updated,
        held: today.held,
        candidates: today.candidates,
        boardTotal: today.boardTotal,
      },
      backlog: backlog ? { days: backlog.days, created: backlog.created, updated: backlog.updated } : null,
    };
    jobState.emrPoll.lastError = "";
    console.log("[cron] HIS check done", jobState.emrPoll.lastResult.today);
  } catch (error) {
    jobState.emrPoll.lastError = error.message;
    console.error("[cron] HIS check failed", error.message);
  } finally {
    jobState.emrPoll.lastFinishedAt = new Date();
    emrPollRunning = false;
  }
}

async function senderJob() {
  if (senderRunning) return;
  // Master Settings → Read-only mode pauses automatic sending; due reports go out once it's off.
  if (isReadOnlyMode()) {
    jobState.sender.lastRunAt = new Date();
    jobState.sender.lastResult = { paused: "read-only mode" };
    return;
  }
  senderRunning = true;
  try {
    await recoverStaleSends();
    const result = await dispatchDueReports();
    jobState.sender.lastRunAt = new Date();
    jobState.sender.lastResult = result;
    jobState.sender.lastError = "";
    if (result.sent) jobState.sender.lastSentAt = new Date();
    if (result.sent || result.failed) {
      console.log("[cron] WhatsApp send run", { due: result.due, sent: result.sent, failed: result.failed });
    }
  } catch (error) {
    jobState.sender.lastError = error.message;
    console.error("[cron] WhatsApp send run failed", error.message);
  } finally {
    senderRunning = false;
  }
}

async function deliveryJob() {
  try {
    const result = await runDeliveryChecks();
    jobState.delivery.lastRunAt = new Date();
    jobState.delivery.lastResult = result;
    jobState.delivery.lastError = result.error || "";
  } catch (error) {
    jobState.delivery.lastError = error.message;
  }
}

/** Clean-up for anything a restart interrupted. Runs once before the jobs start. */
export async function recoverAfterRestart() {
  // Nothing can still be in flight right after a start.
  const reviewed = await recoverStaleSends({ olderThanMs: 0 });
  const board = await recoverBoardState();
  if (reviewed || board.stuckRefreshes || board.nonOpOrdersRemoved) {
    console.log("[startup] recovered", { sendsToCheck: reviewed, ...board });
  }
}

export function startScheduler() {
  if (config.emr.pollEnabled) {
    cron.schedule(config.emr.pollCron, emrPollJob, { noOverlap: true });
    console.log(`[cron] HIS check scheduled: ${config.emr.pollCron} (when Automatic mode is on)`);
  }
  cron.schedule("* * * * *", senderJob, { noOverlap: true });
  cron.schedule("*/2 * * * *", deliveryJob, { noOverlap: true });
  // Saved lab report PDFs: what's there now, then a clean-up every night after the 02:00 backup.
  startPdfCache().catch((e) => console.warn("[pdf-cache]", e.message));
  cron.schedule("15 3 * * *", () => sweepPdfCache().catch((e) => console.error("[pdf-cache] sweep failed", e.message)), { noOverlap: true, timezone: "Asia/Kolkata" });
  console.log("[cron] WhatsApp sender every minute · delivery checks every 2 minutes");
}
