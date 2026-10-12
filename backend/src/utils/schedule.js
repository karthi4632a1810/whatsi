/**
 * When an OP lab report goes out on WhatsApp, and what to call its state.
 *
 * Pure functions (no database, no clock unless passed in) so the rules can be
 * unit-tested: send delay after approval, quiet hours, the auto-send age limit,
 * and the one status label every screen shows for an order.
 *
 * All clock times are India time (Asia/Kolkata has no DST, so adding 24 h is safe).
 */
import { dateFromIstParts, partsInIst } from "./dates.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function parseClock(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute, minutes: hour * 60 + minute };
}

/** Older settings documents used IMMEDIATE / CUSTOM_SCHEDULE. */
export function effectiveMode(settings = {}) {
  if (settings.mode === "END_OF_DAY" || settings.mode === "CUSTOM_SCHEDULE") return "END_OF_DAY";
  return "AFTER_READY";
}

export function delayHours(settings = {}) {
  if (settings.mode === "IMMEDIATE") return 0;
  const n = Number(settings.sendDelayHours);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}

/** Hours after approval beyond which a report is no longer sent automatically. */
export function maxAgeHours(settings = {}) {
  const n = Number(settings.maxAutoSendAgeHours);
  const base = Number.isFinite(n) && n > 0 ? n : 24;
  // Once-a-day mode must still reach yesterday evening's reports at today's run.
  return effectiveMode(settings) === "END_OF_DAY" ? Math.max(base, 30) : base;
}

function quietWindow(settings = {}) {
  if (!settings.quietHoursEnabled) return null;
  const start = parseClock(settings.quietStart);
  const end = parseClock(settings.quietEnd);
  if (!start || !end || start.minutes === end.minutes) return null;
  return { start, end };
}

function istMinutes(date) {
  const p = partsInIst(date);
  return p.hour * 60 + p.minute;
}

/** True when `date` falls inside the quiet hours. */
export function isQuietTime(date, settings) {
  const win = quietWindow(settings);
  if (!win) return false;
  const m = istMinutes(date);
  if (win.start.minutes < win.end.minutes) return m >= win.start.minutes && m < win.end.minutes;
  return m >= win.start.minutes || m < win.end.minutes; // overnight, e.g. 21:00 → 07:00
}

/** `date` itself, or the end of the quiet hours it falls in. */
export function nextAllowedTime(date, settings) {
  const at = new Date(date);
  if (!isQuietTime(at, settings)) return at;
  const { start, end } = quietWindow(settings);
  const p = partsInIst(at);
  let target = dateFromIstParts(p.year, p.month, p.day, end.hour, end.minute);
  const overnight = start.minutes > end.minutes;
  if (overnight && istMinutes(at) >= start.minutes) target = new Date(target.getTime() + DAY_MS);
  return target;
}

/** The time the send delay counts from: EMR approval, else when whatsi first saw it ready. */
export function sendClockBase(report = {}) {
  const value = report.reportReadyAt || report.readySeenAt;
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Next once-a-day run at or after `date`. */
function nextEodRun(date, settings) {
  const clock = parseClock(settings.endOfDayTime) || parseClock("18:00");
  const p = partsInIst(date);
  let run = dateFromIstParts(p.year, p.month, p.day, clock.hour, clock.minute);
  if (run < date) run = new Date(run.getTime() + DAY_MS);
  return run;
}

/**
 * When this report is planned to go out (ignoring whether sending is switched
 * on), already moved out of quiet hours. null when there's no approval time yet.
 */
export function plannedSendAt(report, settings) {
  const base = sendClockBase(report);
  if (!base) return null;
  const raw =
    effectiveMode(settings) === "END_OF_DAY"
      ? nextEodRun(base, settings)
      : new Date(base.getTime() + delayHours(settings) * HOUR_MS);
  return nextAllowedTime(raw, settings);
}

/** True when the report is older than the automatic-send limit. */
export function isTooOldForAutoSend(report, settings, now = new Date()) {
  const base = sendClockBase(report);
  if (!base) return false;
  return now.getTime() - base.getTime() > maxAgeHours(settings) * HOUR_MS;
}

/**
 * Whether the delayed-send worker should send this PENDING report now.
 * Returns { due, reason } — reason explains a "no" for logs and the UI.
 */
export function autoSendDecision(report, settings, now = new Date()) {
  const ruleAllows =
    report.readiness === "READY" ||
    (settings.readinessRule === "PARTIAL" && report.readiness === "PARTIAL");
  if (!ruleAllows) return { due: false, reason: "not-ready" };
  const planned = plannedSendAt(report, settings);
  if (!planned) return { due: false, reason: "no-approval-time" };
  if (planned > now) return { due: false, reason: "scheduled", at: planned };
  if (isQuietTime(now, settings)) return { due: false, reason: "quiet-hours", at: nextAllowedTime(now, settings) };
  if (isTooOldForAutoSend(report, settings, now)) return { due: false, reason: "too-old" };
  return { due: true, reason: "due" };
}

const NOT_ON_WHATSAPP = /not (a|on) whatsapp|not a valid whatsapp|invalid whatsapp|not.*whatsapp user|validWhatsAppNumber|131026/i;
const RATE_LIMITED = /\b429\b|usage limit|rate limit/i;
const PERMANENT = /template|not configured|credentials missing|blocked|excluded|disabled/i;

/** Sorts a send error into a kind, and says whether trying again later can help. */
export function classifyFailure(message = "") {
  const text = String(message || "");
  if (/phone missing|no phone/i.test(text)) return { kind: "NO_PHONE", retryable: false };
  if (NOT_ON_WHATSAPP.test(text)) return { kind: "NOT_ON_WHATSAPP", retryable: false };
  if (/blocked|excluded|disabled|test mode/i.test(text)) return { kind: "BLOCKED", retryable: false };
  if (RATE_LIMITED.test(text)) return { kind: "TEMPORARY", retryable: true };
  if (PERMANENT.test(text)) return { kind: "WATI_REJECTED", retryable: false };
  if (/rejected|\(4\d\d\)/i.test(text)) return { kind: "WATI_REJECTED", retryable: false };
  return { kind: "TEMPORARY", retryable: true };
}

/** Backoff for automatic retries: retryIntervalMinutes, doubling, at most 6 h. */
export function nextRetryTime(attempts, settings, now = new Date()) {
  const base = Number(settings?.retryPolicy?.retryIntervalMinutes) || 15;
  const minutes = Math.min(base * 2 ** Math.max(0, attempts - 1), 360);
  return nextAllowedTime(new Date(now.getTime() + minutes * 60 * 1000), settings);
}

/**
 * The single status shown for an OP order everywhere in the UI.
 * `order` is the HIS board row (may be null for queue-only rows), `report` the
 * WhatsApp queue row (may be null), `flags` = { sendingOn, automationOn, testMode }.
 */
export function deriveStage({ order, report, settings, flags = {}, now = new Date() }) {
  const patientType = String(report?.patientType || order?.patientType || "").toUpperCase();
  const readiness = report?.readiness || order?.readiness || "WAITING";
  const phone = report?.phone || order?.phone || "";

  if (patientType === "ZPATIENT") return stage("excluded", "Excluded", "Z patient — never sent");

  if (report) {
    switch (report.status) {
      case "QUEUED":
        return stage("sending", "Sending", "Handing over to WATI");
      case "NEEDS_REVIEW":
        return stage("review", "Check needed", "The app stopped mid-send — check WhatsApp Monitor before resending");
      case "SENT": {
        if (report.deliveryStatus === "read") return stage("read", "Read", "Patient opened the message", report.readAt);
        if (report.deliveryStatus === "delivered") return stage("delivered", "Delivered", "Reached the patient's phone", report.deliveredAt);
        if (report.deliveryStatus === "failed") return stage("failed", "Not delivered", report.lastError || "WhatsApp could not deliver it");
        return stage("sent", "Sent", "WATI accepted the message", report.sentAt);
      }
      case "FAILED": {
        if (report.failureKind === "NO_PHONE") return stage("no_phone", "No phone", "Add a number in Contacts to send");
        if (report.retryable && report.nextRetryAt) {
          return stage("failed", "Failed", `${report.lastError || "Send failed"} · retrying automatically`, report.nextRetryAt);
        }
        return stage("failed", "Failed", report.lastError || "Send failed");
      }
      default:
        break; // PENDING — fall through to the schedule below
    }
  }

  if (readiness === "WAITING") return stage("in_lab", "In lab", "No results approved yet");
  if (readiness === "PARTIAL" && settings?.readinessRule !== "PARTIAL") {
    const counts = order || report;
    const detail = counts?.procedureTotal
      ? `${counts.approvedCount || 0} of ${counts.procedureTotal} results approved`
      : "Some results still pending";
    return stage("partial", "Partly approved", detail);
  }
  if (!phone) return stage("no_phone", "No phone", "Add a number in Contacts to send");
  if (!report) {
    return stage(
      "ready",
      "Ready",
      flags.automationOn ? "Approved — joins the WhatsApp queue on the next HIS check" : "Approved — send it, or turn on Automatic mode"
    );
  }

  const planned = plannedSendAt(report, settings);
  if (planned && planned > now) {
    return stage("scheduled", "Scheduled", flags.sendingOn ? "Sends automatically" : "Message sending is off", planned);
  }
  if (isTooOldForAutoSend(report, settings, now)) return stage("held", "Send manually", "Approved too long ago for automatic sending");
  if (!flags.sendingOn) return stage("held", "On hold", "Message sending is off in Settings");
  if (flags.testMode) return stage("held", "On hold", "Test send mode — automatic sends are paused");
  if (isQuietTime(now, settings)) return stage("scheduled", "Scheduled", "Quiet hours", nextAllowedTime(now, settings));
  return stage("due", "Due now", "Goes out within a minute");
}

function stage(key, label, detail = "", at = null) {
  return { key, label, detail, at: at ? new Date(at).toISOString() : null };
}

/** Display order of the status filters. */
export const STAGE_ORDER = [
  "in_lab",
  "partial",
  "ready",
  "scheduled",
  "due",
  "held",
  "sending",
  "sent",
  "delivered",
  "read",
  "failed",
  "no_phone",
  "review",
  "excluded",
];

const timeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });

/** "2:30 pm", "tomorrow 7:00 am" or "8 Oct 7:00 am" (India time). */
export function shortWhen(value, now = new Date()) {
  const d = new Date(value);
  const day = dayFmt.format(d);
  const time = timeFmt.format(d);
  if (day === dayFmt.format(now)) return time;
  if (day === dayFmt.format(new Date(now.getTime() + DAY_MS))) return `tomorrow ${time}`;
  return `${new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }).format(d)} ${time}`;
}

/** One line under a queue row's status: when it goes out, or why it doesn't. */
export function scheduleNote(report, settings, flags, now = new Date()) {
  const st = deriveStage({ order: null, report, settings, flags, now });
  switch (st.key) {
    case "scheduled":
      return st.at ? `Sends ${shortWhen(st.at, now)}` : st.detail;
    case "due":
      return "Sending now";
    case "held":
      if (isTooOldForAutoSend(report, settings, now)) return "Old — send manually";
      if (flags.testMode) return "Test mode";
      return "Sending off";
    case "partial":
      return "Waiting for results";
    case "no_phone":
      return "No phone";
    case "review":
      return "Check message log";
    case "sent":
      return st.at ? `Sent ${shortWhen(st.at, now)}` : "Sent";
    case "delivered":
      return st.at ? `Delivered ${shortWhen(st.at, now)}` : "Delivered";
    case "read":
      return st.at ? `Read ${shortWhen(st.at, now)}` : "Read";
    case "failed":
      return report.retryable && report.nextRetryAt
        ? `${report.lastError || "Failed"} · retry ${shortWhen(report.nextRetryAt, now)}`
        : report.lastError || st.detail;
    default:
      return st.detail;
  }
}
