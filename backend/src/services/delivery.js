/**
 * WhatsApp ticks for sent reports: Sent → Delivered → Read (or Failed).
 *
 * Statuses arrive two ways (same approach as the investigation-chart portal):
 *  - WATI webhook (POST /api/webhooks/wati/<key>) — instant and free; doesn't
 *    use the WATI API quota. Preferred.
 *  - Status checks: WATI getMessages for the number, 30 min, 6 h and 24 h after
 *    sending, within a daily cap (Settings). Both apps share one WATI account
 *    and quota, so checks stop on their own while webhooks are arriving.
 */
import crypto from "node:crypto";
import { config } from "../config.js";
import { MessageLog, Report, WatiApiSnapshot } from "../models/index.js";
import { fetchWatiMessages } from "./wati.js";
import { getSettings } from "./reports.js";
import { reportDayKey } from "../utils/dates.js";
import { classifyFailure } from "../utils/schedule.js";

const RANK = { SENT: 1, DELIVERED: 2, READ: 3 };
const CHECK_AFTER_MIN = [30, 360, 1440];
const CHECK_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const NUMBERS_PER_RUN = 3;
const WEBHOOK_ACTIVE_MS = 24 * 60 * 60 * 1000;

// ---- webhook key ----------------------------------------------------------

/** Secret path segment for the WATI webhook URL (derived from JWT_SECRET unless set). */
export function watiWebhookKey() {
  if (process.env.WATI_WEBHOOK_KEY) return process.env.WATI_WEBHOOK_KEY;
  return crypto.createHmac("sha256", config.jwtSecret).update("wati-webhook").digest("hex").slice(0, 32);
}

export function isWatiWebhookKey(key) {
  const a = crypto.createHash("sha256").update(String(key || "")).digest();
  const b = crypto.createHash("sha256").update(watiWebhookKey()).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---- applying a status ------------------------------------------------------

function statusFromWebhookEvent(eventType) {
  const t = String(eventType || "");
  if (/^templateMessageSent/i.test(t)) return "SENT";
  if (/^sentMessageDELIVERED/i.test(t)) return "DELIVERED";
  if (/^sentMessage(READ|REPLIED)/i.test(t)) return "READ";
  if (/failed/i.test(t)) return "FAILED";
  return null;
}

function statusFromWatiString(value) {
  const s = String(value || "").toUpperCase();
  if (s === "SENT") return "SENT";
  if (s === "DELIVERED") return "DELIVERED";
  if (s === "READ" || s === "REPLIED") return "READ";
  if (s === "FAILED") return "FAILED";
  return null;
}

function eventTime(event) {
  const created = event?.created ? new Date(event.created) : null;
  if (created && !Number.isNaN(created.getTime())) return created;
  const ts = Number(event?.timestamp);
  return Number.isFinite(ts) && ts > 0 ? new Date(ts * (ts < 1e12 ? 1000 : 1)) : new Date();
}

/**
 * Moves a message log forward (never backwards: READ stays READ) and mirrors it
 * onto the report when this is the report's latest real (non-test) send.
 */
async function applyStatus(log, status, { at = new Date(), source, detail = "", watiMessageId = "" } = {}) {
  const current = log.status;
  if (status === "FAILED") {
    if (current === "READ" || current === "DELIVERED" || current === "FAILED") return false;
  } else if ((RANK[status] || 0) <= (RANK[current] || 0)) {
    if (watiMessageId && !log.watiMessageId) {
      await MessageLog.updateOne({ _id: log._id }, { $set: { watiMessageId } });
    }
    return false;
  }

  const set = { status, statusSource: source };
  if (watiMessageId && !log.watiMessageId) set.watiMessageId = watiMessageId;
  if (status === "DELIVERED") set.deliveredAt = at;
  if (status === "READ") {
    set.readAt = at;
    if (!log.deliveredAt) set.deliveredAt = at;
  }
  if (status === "FAILED") {
    set.failedAt = at;
    set.errorReason = detail || "WhatsApp could not deliver the message";
  }
  if (status === "READ" || status === "FAILED") set.nextCheckAt = null;
  await MessageLog.updateOne({ _id: log._id }, { $set: set });

  if (log.testSend || !log.reportRef) return true;
  const newer = await MessageLog.exists({
    reportRef: log.reportRef,
    testSend: { $ne: true },
    sentAt: { $gt: log.sentAt },
  });
  if (newer) return true;

  const reportSet = { deliveryStatus: status.toLowerCase() };
  if (status === "DELIVERED") reportSet.deliveredAt = at;
  if (status === "READ") {
    reportSet.readAt = at;
    if (!log.deliveredAt) reportSet.deliveredAt = at;
  }
  if (status === "FAILED") {
    const { kind } = classifyFailure(set.errorReason);
    Object.assign(reportSet, {
      status: "FAILED",
      failureKind: kind === "NOT_ON_WHATSAPP" ? "NOT_ON_WHATSAPP" : "WATI_REJECTED",
      retryable: false,
      nextRetryAt: null,
      lastError: `Not delivered: ${set.errorReason}`,
    });
  }
  await Report.updateOne({ _id: log.reportRef, status: { $in: ["SENT", "FAILED"] } }, { $set: reportSet });
  return true;
}

// ---- webhook ----------------------------------------------------------------

export async function handleWatiStatusEvent(event = {}) {
  const status = statusFromWebhookEvent(event.eventType);
  if (!status) return { matched: false, reason: "not a message status event" };


  const ids = [event.localMessageId, event.whatsappMessageId, event.id].filter((v) => typeof v === "string" && v);
  let log = ids.length
    ? await MessageLog.findOne({
        $or: [{ watiLocalMessageId: { $in: ids } }, { watiMessageId: { $in: ids } }],
      })
    : null;

  const at = eventTime(event);
  if (!log && event.waId) {
    const digits = String(event.waId).replace(/\D/g, "");
    log = await MessageLog.findOne({
      phone: digits.length === 10 ? `91${digits}` : digits,
      status: { $in: ["SENT", "DELIVERED"] },
      sentAt: { $gte: new Date(at.getTime() - 15 * 60 * 1000), $lte: new Date(at.getTime() + 2 * 60 * 1000) },
    }).sort({ sentAt: -1 });
  }
  if (!log) return { matched: false, reason: "no matching message" };

  // Only events for whatsi's own messages count as "webhook connected" (the WATI
  // account is shared, so events for the other portal's messages arrive too) —
  // while connected, the paid status checks stop.
  await WatiApiSnapshot.findOneAndUpdate(
    { key: "webhook" },
    { $set: { key: "webhook", data: { lastEventAt: new Date(), eventType: String(event.eventType || "") }, syncedAt: new Date() } },
    { upsert: true }
  ).catch(() => {});

  const detail = [event.failedDetail, event.failedCode && `(code ${event.failedCode})`].filter(Boolean).join(" ");
  const changed = await applyStatus(log, status, {
    at,
    source: "webhook",
    detail,
    watiMessageId: typeof event.id === "string" ? event.id : "",
  });
  return { matched: true, status, changed };
}

export async function webhookState() {
  const doc = await WatiApiSnapshot.findOne({ key: "webhook" }).lean();
  const lastEventAt = doc?.data?.lastEventAt ? new Date(doc.data.lastEventAt) : null;
  return {
    lastEventAt,
    active: Boolean(lastEventAt && Date.now() - lastEventAt.getTime() < WEBHOOK_ACTIVE_MS),
  };
}

// ---- status checks ------------------------------------------------------------

export async function checksUsedToday() {
  const doc = await WatiApiSnapshot.findOne({ key: "statusChecks" }).lean();
  return doc?.data?.day === reportDayKey() ? Number(doc.data.count) || 0 : 0;
}

async function countCheck() {
  const day = reportDayKey();
  const doc = await WatiApiSnapshot.findOne({ key: "statusChecks" }).lean();
  if (doc?.data?.day !== day) {
    await WatiApiSnapshot.findOneAndUpdate(
      { key: "statusChecks" },
      { $set: { key: "statusChecks", data: { day, count: 1 }, syncedAt: new Date() } },
      { upsert: true }
    );
  } else {
    await WatiApiSnapshot.updateOne({ key: "statusChecks" }, { $inc: { "data.count": 1 }, $set: { syncedAt: new Date() } });
  }
}

function nextCheckAfter(log, checksDone) {
  const minutes = CHECK_AFTER_MIN[checksDone];
  if (minutes == null) return null;
  return new Date(new Date(log.sentAt).getTime() + minutes * 60 * 1000);
}

/** The WATI message for this log: by id, else the closest send to the same number. */
function matchItem(log, items, claimed) {
  const byId = items.find(
    (item) =>
      (log.watiMessageId && item.id === log.watiMessageId) ||
      (log.watiLocalMessageId && item.localMessageId === log.watiLocalMessageId)
  );
  if (byId) return byId;
  const sentAt = new Date(log.sentAt).getTime();
  const firstName = String(log.patientName || "").split(/[\s.,]+/).find((w) => w.length > 2) || "";
  let best = null;
  for (const item of items) {
    if (claimed.has(item.id)) continue;
    const delta = new Date(item.created).getTime() - sentAt;
    if (delta < -120_000 || delta > 10 * 60_000) continue;
    const text = String(item.finalText ?? item.text ?? "");
    if (firstName && text && !text.toUpperCase().includes(firstName.toUpperCase())) continue;
    if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { item, delta };
  }
  return best?.item || null;
}

let pollRunning = false;
let lastRun = { at: null, numbers: 0, updated: 0, skipped: "", error: "" };

export async function deliveryCheckState() {
  const settings = await getSettings();
  return {
    ...lastRun,
    enabled: settings.statusChecksEnabled !== false,
    perDay: settings.statusChecksPerDay ?? 100,
    usedToday: await checksUsedToday(),
    webhook: await webhookState(),
    schedule: CHECK_AFTER_MIN,
  };
}

export async function runDeliveryChecks({ now = new Date() } = {}) {
  if (pollRunning) return lastRun;
  const skip = (reason) => {
    lastRun = { ...lastRun, at: now, skipped: reason };
    return lastRun;
  };
  if (!config.wati.token || !config.wati.baseUrl) return skip("WATI not configured");
  const settings = await getSettings();
  if (settings.statusChecksEnabled === false) return skip("Status checks are off in Settings");
  if ((await webhookState()).active) return skip("WATI webhook delivers the ticks");
  let budget = (settings.statusChecksPerDay ?? 100) - (await checksUsedToday());
  if (budget <= 0) return skip("Today's status checks are used up");

  pollRunning = true;
  let numbers = 0;
  let updated = 0;
  let error = "";
  try {
    const logs = await MessageLog.find({
      status: { $in: ["SENT", "DELIVERED"] },
      testSend: { $ne: true },
      sentAt: { $gte: new Date(now.getTime() - CHECK_WINDOW_MS) },
      $or: [{ nextCheckAt: { $lte: now } }, { nextCheckAt: null, statusChecks: 0 }],
    })
      .sort({ nextCheckAt: 1, sentAt: 1 })
      .limit(100);

    const byPhone = new Map();
    for (const log of logs) {
      const firstDue = nextCheckAfter(log, 0);
      if (log.statusChecks === 0 && firstDue > now) {
        await MessageLog.updateOne({ _id: log._id }, { $set: { nextCheckAt: firstDue } });
        continue;
      }
      if (!byPhone.has(log.phone)) byPhone.set(log.phone, []);
      byPhone.get(log.phone).push(log);
    }

    for (const [phone, list] of [...byPhone].slice(0, Math.min(NUMBERS_PER_RUN, budget))) {
      let items;
      try {
        items = await fetchWatiMessages(phone);
        await countCheck();
        budget -= 1;
        numbers += 1;
      } catch (err) {
        error = err.message;
        if (err.rateLimited) break;
        continue;
      }
      const claimed = new Set(
        (await MessageLog.distinct("watiMessageId", { phone, watiMessageId: { $nin: ["", null] } })) || []
      );
      list.sort((a, b) => a.sentAt - b.sentAt);
      for (const log of list) {
        const checksDone = (log.statusChecks || 0) + 1;
        await MessageLog.updateOne(
          { _id: log._id },
          { $set: { lastCheckedAt: now, statusChecks: checksDone, nextCheckAt: nextCheckAfter(log, checksDone) } }
        );
        const item = matchItem(log, items, claimed);
        if (!item) continue;
        claimed.add(item.id);
        const status = statusFromWatiString(item.statusString);
        if (!status) continue;
        const fresh = await MessageLog.findById(log._id);
        if (
          await applyStatus(fresh, status, {
            source: "status-check",
            detail: item.failedDetail ? String(item.failedDetail).slice(0, 500) : "",
            watiMessageId: item.id,
          })
        ) {
          updated += 1;
        }
      }
    }
  } catch (err) {
    error = err.message;
  } finally {
    pollRunning = false;
  }
  lastRun = { at: now, numbers, updated, skipped: "", error };
  return lastRun;
}
