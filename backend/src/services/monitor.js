/**
 * WhatsApp Monitor for OP lab reports — the same screen as the
 * investigation-chart portal's monitor, fed from whatsi's own data:
 * every message in the Message log, plus reports that are being sent right
 * now or were cut off mid-send ("pending"), joined with their queue row.
 *
 * Volumes are small (a few hundred OP reports a day), so a date range is
 * loaded and filtered / counted in memory; the shapes match what the
 * portal's monitor screen expects (summary, insights, patients, messages…).
 */
import { HisLabOrder, MessageLog, Report } from "../models/index.js";
import { config } from "../config.js";
import { DELIVERY_OP_IP_TYPE } from "./emr.js";
import { getSettings, sendReportById } from "./reports.js";
import { checksUsedToday, deliveryCheckState, runDeliveryChecks, watiWebhookKey } from "./delivery.js";
import { readWatiApiUsage } from "./watiCache.js";
import { addIstDays, enumerateDays, reportDayKey } from "../utils/dates.js";
import { classifyFailure, isTooOldForAutoSend, plannedSendAt } from "../utils/schedule.js";

const TZ = "Asia/Kolkata";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const HOUR_MS = 3600_000;
const STATUSES = ["pending", "sent", "delivered", "read", "failed"];
const MAX_ITEMS = 20_000;

const TRIGGER = {
  AUTO_DELAYED: "auto",
  AUTO_IMMEDIATE: "auto",
  AUTO_EOD: "auto",
  AUTO_RETRY: "retry",
  MANUAL: "manual",
  WEBHOOK: "webhook",
};

const istMidnight = (day) => new Date(`${day}T00:00:00+05:30`);
const istAt = (day, hhmm) => new Date(`${day}T${hhmm}:00+05:30`);
const hourIst = (d) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(new Date(d)));

function timeWindow(q) {
  const fromTime = TIME_RE.test(q.fromTime || "") ? q.fromTime : null;
  const toTime = TIME_RE.test(q.toTime || "") ? q.toTime : null;
  return fromTime || toTime ? { fromTime: fromTime || "00:00", toTime: toTime || "23:59" } : null;
}

function cleanRange(q) {
  const today = reportDayKey();
  let from = DAY_RE.test(q.from || "") ? q.from : today;
  let to = DAY_RE.test(q.to || "") ? q.to : from;
  if (from > to) [from, to] = [to, from];
  const days = enumerateDays(from, to);
  if (days.length > 400) {
    const error = new Error("Pick a range of up to 400 days");
    error.status = 400;
    throw error;
  }
  return { from, to, days };
}

const isNotOnWhatsApp = (text) => classifyFailure(text).kind === "NOT_ON_WHATSAPP";

/** A Message log row as a monitor "message". */
function fromLog(log, report, latestLogByReport) {
  const status = String(log.status || "").toLowerCase();
  const failedAfterAccept = status === "failed" && Boolean(log.statusSource);
  const isLatest = latestLogByReport.get(String(log.reportRef))?.id === String(log._id);
  const trigger = TRIGGER[log.triggerType] || (log.sentBy ? "manual" : "auto");
  return {
    id: String(log._id),
    status,
    notOnWhatsApp: status === "failed" && isNotOnWhatsApp(log.errorReason),
    document: log.testSend ? "test" : "lab",
    documentLabel: log.testSend ? "Test send" : "Lab report",
    trigger,
    triggeredBy: log.sentBy ? log.sentBy.split("@")[0] : trigger === "manual" ? "staff" : "system",
    patientName: log.patientName || report?.patientName || "",
    uhid: log.patientId || report?.patientId || "",
    orderId: log.reportId || report?.reportId || "",
    reportDay: log.reportDay || report?.reportDay || null,
    department: report?.department || "",
    toNumber: log.phone || "",
    createdAt: log.sentAt,
    acceptedAt: status !== "failed" || failedAfterAccept ? log.sentAt : null,
    deliveredAt: log.deliveredAt || null,
    readAt: log.readAt || null,
    failedAt: log.failedAt || (status === "failed" ? log.sentAt : null),
    error: log.errorReason || "",
    failedDetail: log.errorReason || "",
    approvedAt: report?.reportReadyAt || report?.readySeenAt || null,
    attempts: report?.attempts || 1,
    nextRetryAt:
      isLatest && report?.status === "FAILED" && report.retryable && report.nextRetryAt ? report.nextRetryAt : null,
    template: log.templateName || "",
    watiMessageId: log.watiMessageId || log.watiLocalMessageId || "",
    watiStatus: log.statusSource ? `${log.status} (${log.statusSource})` : "",
    lastCheckedAt: log.lastCheckedAt || null,
    liveMode: !log.testSend,
    canRetry: isLatest && status === "failed" && !log.testSend && report?.status === "FAILED",
    reportRef: log.reportRef ? String(log.reportRef) : null,
  };
}

/** A report being sent right now, or cut off mid-send ("Check needed"), as a pending message. */
function fromQueue(report) {
  const review = report.status === "NEEDS_REVIEW";
  return {
    id: `q-${report._id}`,
    status: "pending",
    review,
    notOnWhatsApp: false,
    document: "lab",
    documentLabel: "Lab report",
    trigger: TRIGGER[report.triggerType] || "auto",
    triggeredBy: report.sentBy ? report.sentBy.split("@")[0] : "system",
    patientName: report.patientName || "",
    uhid: report.patientId || "",
    orderId: report.reportId || "",
    reportDay: report.reportDay || null,
    department: report.department || "",
    toNumber: report.phone || "",
    createdAt: report.queuedAt || report.updatedAt,
    acceptedAt: null,
    deliveredAt: null,
    readAt: null,
    failedAt: null,
    error: review ? report.lastError || "The app stopped while sending — check before resending" : "",
    failedDetail: "",
    approvedAt: report.reportReadyAt || report.readySeenAt || null,
    attempts: report.attempts || 0,
    nextRetryAt: null,
    template: "",
    watiMessageId: "",
    watiStatus: review ? "Outcome unknown" : "Sending",
    lastCheckedAt: null,
    liveMode: true,
    canRetry: review,
    reportRef: String(report._id),
  };
}

/** Every message (and pending send) in the date range, before the status / search filters. */
async function loadRange(q, { from, to, days }) {
  const basis = q.basis === "sent" ? "sent" : "report";
  const win = timeWindow(q);
  const logQuery = {};
  const pendingQuery = { status: { $in: ["QUEUED", "NEEDS_REVIEW"] }, opIpType: DELIVERY_OP_IP_TYPE };
  if (basis === "report") {
    logQuery.reportDay = { $in: days };
    pendingQuery.reportDay = { $in: days };
  } else {
    const start = win ? istAt(from, win.fromTime) : istMidnight(from);
    const end = win ? new Date(istAt(to, win.toTime).getTime() + 60_000) : new Date(istMidnight(to).getTime() + 86400_000);
    logQuery.sentAt = { $gte: start, $lt: end };
    pendingQuery.queuedAt = { $gte: start, $lt: end };
  }

  const [logs, pending] = await Promise.all([
    MessageLog.find(logQuery).select("-requestPayload -responsePayload").sort({ sentAt: 1 }).limit(MAX_ITEMS).lean(),
    Report.find(pendingQuery).lean(),
  ]);
  const refs = [...new Set(logs.map((l) => String(l.reportRef || "")).filter(Boolean))];
  const reports = refs.length ? await Report.find({ _id: { $in: refs } }).lean() : [];
  const reportById = new Map(reports.map((r) => [String(r._id), r]));

  // Only OP reports (old IP history, if any, stays out).
  const opLogs = logs.filter((l) => {
    const r = reportById.get(String(l.reportRef || ""));
    return !r || r.opIpType === DELIVERY_OP_IP_TYPE;
  });
  const latestLogByReport = new Map();
  for (const l of opLogs) {
    if (!l.reportRef || l.testSend) continue;
    latestLogByReport.set(String(l.reportRef), { id: String(l._id) });
  }

  let items = [
    ...opLogs.map((l) => fromLog(l, reportById.get(String(l.reportRef || "")), latestLogByReport)),
    ...pending.map(fromQueue),
  ];

  // "Report date" with a time of day: the approval time must fall inside it.
  if (win && basis === "report") {
    const start = istAt(from, win.fromTime).getTime();
    const end = istAt(to, win.toTime).getTime() + 60_000;
    items = items.filter((m) => {
      const t = m.approvedAt ? new Date(m.approvedAt).getTime() : null;
      return t != null && t >= start && t < end;
    });
  }
  return { items, basis };
}

const SPECIAL = {
  nowa: (m) => m.status === "failed" && m.notOnWhatsApp,
  fixable: (m) => m.status === "failed" && !m.notOnWhatsApp,
  unread24: (m, now) => m.status === "delivered" && m.deliveredAt && new Date(m.deliveredAt) <= new Date(now - 24 * HOUR_MS),
  stuck6: (m, now) => m.status === "sent" && m.acceptedAt && new Date(m.acceptedAt) <= new Date(now - 6 * HOUR_MS),
  review: (m) => m.status === "pending" && m.review,
};

function applyFilters(items, q, now = Date.now()) {
  let out = items;
  const statuses = String(q.status || "")
    .split(",")
    .filter((s) => STATUSES.includes(s) || SPECIAL[s]);
  if (statuses.length) {
    out = out.filter((m) =>
      statuses.some((s) => {
        if (SPECIAL[s]) return SPECIAL[s](m, now);
        if (s === "failed") return m.status === "failed" && !m.notOnWhatsApp;
        return m.status === s;
      })
    );
  }
  if (q.document === "lab" || q.document === "test") out = out.filter((m) => m.document === q.document);
  if (["auto", "retry", "manual", "webhook"].includes(q.trigger)) out = out.filter((m) => m.trigger === q.trigger);
  const search = String(q.q || "").trim().toLowerCase().slice(0, 60);
  if (search) {
    const digits = search.replace(/\D/g, "");
    out = out.filter(
      (m) =>
        m.patientName.toLowerCase().includes(search) ||
        String(m.uhid).toLowerCase().includes(search) ||
        String(m.orderId).includes(search) ||
        m.triggeredBy.toLowerCase().includes(search) ||
        (digits.length >= 3 && String(m.toNumber).includes(digits))
    );
  }
  return out;
}

const dayOfMessage = (m, basis) => (basis === "report" ? m.reportDay : reportDayKey(m.createdAt));
const avg = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const secsBetween = (a, b) => (a && b ? (new Date(b) - new Date(a)) / 1000 : null);

async function retryPolicy() {
  const s = await getSettings();
  return { maxAttempts: s.retryPolicy?.maxAttempts ?? 3, intervalMinutes: s.retryPolicy?.retryIntervalMinutes ?? 15 };
}

function pollState(state) {
  return {
    at: state.at || null,
    checked: state.numbers || 0,
    updated: state.updated || 0,
    skipped: state.skipped || null,
    error: state.error || null,
    enabled: state.enabled,
    dailyChecks: state.perDay,
    usedToday: state.usedToday,
    webhook: { active: Boolean(state.webhook?.active), lastEventAt: state.webhook?.lastEventAt || null },
  };
}

function summarize(items, range, basis) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const m of items) counts[m.status] = (counts[m.status] || 0) + 1;
  const total = items.length;
  const nowa = items.filter((m) => m.status === "failed" && m.notOnWhatsApp);
  const reachedWati = counts.sent + counts.delivered + counts.read;
  const delivered = counts.delivered + counts.read;
  const hourly = range.from === range.to;

  const buckets = hourly ? Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")) : range.days;
  const series = new Map(buckets.map((b) => [b, { pending: 0, sent: 0, delivered: 0, read: 0, failed: 0, nowa: 0 }]));
  for (const m of items) {
    const bucket = hourly ? String(hourIst(m.createdAt)).padStart(2, "0") : dayOfMessage(m, basis);
    const row = series.get(bucket);
    if (!row) continue;
    row[m.status === "failed" && m.notOnWhatsApp ? "nowa" : m.status] += 1;
  }

  const byDocument = {};
  for (const m of items) byDocument[m.document] = (byDocument[m.document] || 0) + 1;
  const patients = new Set(items.filter((m) => m.uhid).map((m) => `${m.reportDay}|${m.uhid}`));

  return {
    range: { from: range.from, to: range.to, granularity: hourly ? "hour" : "day" },
    total,
    counts,
    funnel: { triggered: total, sent: reachedWati, delivered, read: counts.read },
    failedToSend: counts.failed - nowa.length,
    retrying: items.filter((m) => m.status === "failed" && m.nextRetryAt).length,
    rates: {
      delivered: reachedWati ? delivered / reachedWati : null,
      read: delivered ? counts.read / delivered : null,
      failed: total ? counts.failed / total : null,
    },
    avgSeconds: {
      toDeliver: avg(items.map((m) => secsBetween(m.acceptedAt, m.deliveredAt)).filter((x) => x != null && x >= 0)),
      toRead: avg(items.map((m) => secsBetween(m.acceptedAt, m.readAt)).filter((x) => x != null && x >= 0)),
    },
    patients: patients.size,
    notOnWhatsApp: { messages: nowa.length, numbers: new Set(nowa.map((m) => m.toNumber)).size },
    byDocument,
    series: [...series].map(([bucket, row]) => ({ bucket, ...row })),
  };
}

export async function monitorSummary(q = {}) {
  const range = cleanRange(q);
  const { items, basis } = await loadRange(q, range);
  const filtered = applyFilters(items, q);
  return {
    ...summarize(filtered, range, basis),
    retryPolicy: await retryPolicy(),
    poll: pollState(await deliveryCheckState()),
  };
}

export async function monitorMessages(q = {}) {
  const range = cleanRange(q);
  const { items } = await loadRange(q, range);
  const filtered = applyFilters(items, q).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 5), 200);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  return { total: filtered.length, page, limit, items: filtered.slice((page - 1) * limit, page * limit) };
}

/** A patient's overall state: the weakest step across their reports' latest messages. */
function overallStatus(reports) {
  const statuses = reports.map((r) => r.status);
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("pending")) return "pending";
  if (statuses.includes("sent")) return "sent";
  if (statuses.includes("delivered")) return "delivered";
  return statuses.length ? "read" : "pending";
}

function groupPatients(items) {
  const groups = new Map();
  const sorted = [...items].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  for (const m of sorted) {
    const key = `${m.reportDay || ""}|${m.uhid || `${m.toNumber}|${m.patientName}`}`;
    const g = groups.get(key) || {
      key,
      reportDay: m.reportDay,
      uhid: m.uhid,
      patientName: m.patientName,
      department: m.department,
      toNumber: m.toNumber,
      firstAt: m.createdAt,
      lastAt: m.createdAt,
      messages: [],
    };
    g.patientName = m.patientName || g.patientName;
    g.department = m.department || g.department;
    g.toNumber = m.toNumber || g.toNumber;
    const at = m.readAt || m.deliveredAt || m.acceptedAt || m.createdAt;
    if (new Date(at) > new Date(g.lastAt)) g.lastAt = at;
    g.messages.push(m);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    // One badge per order (a report sent twice shows its newest attempt); test sends apart.
    const byReport = new Map();
    for (const m of g.messages) {
      const key = m.document === "test" ? `test-${m.orderId}` : m.orderId || m.id;
      const entry = byReport.get(key) || { sends: 0 };
      entry.sends += 1;
      entry.latest = m;
      byReport.set(key, entry);
    }
    const reports = [...byReport.values()].map((r) => ({
      ...r.latest,
      sends: r.sends,
      documentLabel: r.latest.document === "test" ? `Test · #${r.latest.orderId}` : `Order #${r.latest.orderId}`,
    }));
    const real = reports.filter((r) => r.document !== "test");
    return {
      ...g,
      status: overallStatus(real.length ? real : reports),
      notOnWhatsApp: reports.some((r) => r.status === "failed" && r.notOnWhatsApp),
      reports,
      messages: [...g.messages].reverse(),
    };
  });
}

export async function monitorPatients(q = {}) {
  const range = cleanRange(q);
  const { items } = await loadRange(q, range);
  const rows = groupPatients(applyFilters(items, q)).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 5), 5000);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  return { total: rows.length, page, limit, items: rows.slice((page - 1) * limit, page * limit) };
}

export async function monitorMessage(id) {
  if (/^q-[a-f0-9]{24}$/i.test(id)) {
    const report = await Report.findById(id.slice(2)).lean();
    return report ? fromQueue(report) : null;
  }
  if (!/^[a-f0-9]{24}$/i.test(id)) return null;
  const log = await MessageLog.findById(id).select("-requestPayload -responsePayload").lean();
  if (!log) return null;
  const report = log.reportRef ? await Report.findById(log.reportRef).lean() : null;
  const latest = log.reportRef
    ? await MessageLog.findOne({ reportRef: log.reportRef, testSend: { $ne: true } }).sort({ sentAt: -1 }).select("_id").lean()
    : null;
  const latestMap = new Map(latest && report ? [[String(report._id), { id: String(latest._id) }]] : []);
  const message = fromLog(log, report, latestMap);
  if (report) {
    message.reportStatus = report.status;
    message.plannedSendAt = report.status === "PENDING" ? plannedSendAt(report, await getSettings()) : null;
  }
  return message;
}

/** Latest status changes across all messages, newest first — the live feed. */
export async function monitorActivity(limit = 20) {
  const [logs, pending] = await Promise.all([
    MessageLog.find({}).select("-requestPayload -responsePayload").sort({ updatedAt: -1 }).limit(400).lean(),
    Report.find({ status: { $in: ["QUEUED", "NEEDS_REVIEW"] }, opIpType: DELIVERY_OP_IP_TYPE }).lean(),
  ]);
  const events = [];
  for (const l of logs) {
    const base = {
      id: String(l._id),
      patientName: l.patientName || "",
      uhid: l.patientId || "",
      documentLabel: l.testSend ? "Test send" : "Lab report",
      toNumber: l.phone || "",
      notOnWhatsApp: l.status === "FAILED" && isNotOnWhatsApp(l.errorReason),
    };
    const failedAtSend = l.status === "FAILED" && !l.statusSource;
    if (!failedAtSend) events.push({ ...base, at: l.sentAt, status: "sent" });
    if (l.deliveredAt) events.push({ ...base, at: l.deliveredAt, status: "delivered" });
    if (l.readAt) events.push({ ...base, at: l.readAt, status: "read" });
    if (l.status === "FAILED") events.push({ ...base, at: l.failedAt || l.sentAt, status: "failed" });
  }
  for (const r of pending) {
    events.push({
      id: `q-${r._id}`,
      patientName: r.patientName || "",
      uhid: r.patientId || "",
      documentLabel: "Lab report",
      toNumber: r.phone || "",
      notOnWhatsApp: false,
      at: r.queuedAt || r.updatedAt,
      status: "pending",
    });
  }
  return events
    .filter((e) => e.at)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, Math.min(Math.max(limit, 1), 100));
}

// ---- insights ---------------------------------------------------------------

const TIME_BUCKETS = [
  { max: 60, label: "< 1 min" },
  { max: 300, label: "1–5 min" },
  { max: 900, label: "5–15 min" },
  { max: 3600, label: "15–60 min" },
  { max: 6 * 3600, label: "1–6 h" },
  { max: 24 * 3600, label: "6–24 h" },
  { max: Infinity, label: "> 1 day" },
];

function bucketTimes(seconds) {
  const counts = TIME_BUCKETS.map((b) => ({ label: b.label, value: 0 }));
  for (const s of seconds) {
    const i = TIME_BUCKETS.findIndex((b) => s < b.max);
    if (i >= 0) counts[i].value += 1;
  }
  return counts;
}

/** Why a message failed, in a handful of plain categories. */
function failureCategory(m) {
  const t = m.failedDetail || m.error || "";
  if (m.notOnWhatsApp || isNotOnWhatsApp(t)) return "Not on WhatsApp";
  if (/429|usage limit/i.test(t)) return "WATI usage limit";
  if (/phone missing|no phone/i.test(t)) return "No phone number";
  if (/timeout|timed out|aborted|network|fetch failed|ECONN|socket|50[234]|busy|rate limit/i.test(t)) return "Network / WATI busy";
  if (/template/i.test(t)) return "Template rejected";
  if (/pdf|procedure ids/i.test(t)) return "Report link not ready";
  if (/undeliverable|131026|131047|blocked|re-?engage|24 ?hours/i.test(t)) return "WhatsApp would not deliver";
  return "Other";
}

function previousRange(from, to) {
  const days = enumerateDays(from, to).length;
  return { from: addIstDays(from, -days), to: addIstDays(from, -1) };
}

/**
 * Did every ready OP patient get their lab report? One entry per OP order whose
 * results were all approved (by lab day) — Z patients excluded.
 */
async function coverage(range, settings) {
  const readiness = settings.readinessRule === "PARTIAL" ? ["READY", "PARTIAL"] : ["READY"];
  const [orders, reports, logs] = await Promise.all([
    HisLabOrder.find({
      labDay: { $in: range.days },
      opIpType: DELIVERY_OP_IP_TYPE,
      readiness: { $in: readiness },
      patientType: { $ne: "ZPATIENT" },
    })
      .select("labDay orderId patientId patientName department phone")
      .lean(),
    Report.find({ reportDay: { $in: range.days }, opIpType: DELIVERY_OP_IP_TYPE, patientType: { $ne: "ZPATIENT" } }).lean(),
    MessageLog.find({ reportDay: { $in: range.days }, testSend: { $ne: true } })
      .select("reportId status errorReason")
      .lean(),
  ]);
  const RANK = { READ: 5, DELIVERED: 4, SENT: 3, FAILED: 1 };
  const bestLog = new Map();
  for (const l of logs) {
    const prev = bestLog.get(l.reportId);
    if (!prev || (RANK[l.status] || 0) > (RANK[prev.status] || 0)) bestLog.set(l.reportId, l);
  }
  const reportByOrder = new Map(reports.map((r) => [r.reportId, r]));
  const entries = new Map();
  for (const o of orders) entries.set(o.orderId, { order: o, report: reportByOrder.get(o.orderId) });
  for (const r of reports) {
    if (!entries.has(r.reportId) && readiness.includes(r.readiness)) entries.set(r.reportId, { order: null, report: r });
  }

  const now = new Date();
  const counts = { read: 0, delivered: 0, sent: 0, pending: 0, scheduled: 0, failed: 0, nowa: 0, notSent: 0, noMobile: 0 };
  const notReached = [];
  for (const [orderId, { order, report }] of entries) {
    const log = bestLog.get(orderId);
    let state;
    if (log && log.status !== "FAILED") state = log.status.toLowerCase();
    else if (report?.status === "QUEUED" || report?.status === "NEEDS_REVIEW") state = "pending";
    else if (log?.status === "FAILED") state = isNotOnWhatsApp(log.errorReason) ? "nowa" : "failed";
    else if (!(report?.phone || order?.phone)) state = "noMobile";
    else if (report?.status === "PENDING") {
      const planned = plannedSendAt(report, settings);
      state = planned && planned > now && !isTooOldForAutoSend(report, settings, now) ? "scheduled" : "notSent";
    } else if (report?.status === "FAILED") state = report.failureKind === "NO_PHONE" ? "noMobile" : "failed";
    else state = "notSent";
    counts[state] += 1;
    if (!["read", "delivered", "sent"].includes(state)) {
      notReached.push({
        date: order?.labDay || report?.reportDay,
        orderId,
        uhid: order?.patientId || report?.patientId || "",
        name: report?.patientName || order?.patientName || "",
        department: order?.department || report?.department || "",
        state,
      });
    }
  }
  const total = entries.size;
  return {
    ready: total,
    reached: counts.read + counts.delivered + counts.sent,
    counts,
    notReached: notReached.slice(0, 200),
    notReachedTotal: notReached.length,
  };
}

export async function monitorInsights(q = {}) {
  const range = cleanRange(q);
  const { items, basis } = await loadRange(q, range);
  const filtered = applyFilters(items, q);
  const now = Date.now();
  const settings = await getSettings();

  // Same filters, previous period of equal length — for the ↑ / ↓ on the tiles.
  const prevRange = previousRange(range.from, range.to);
  const prevItems = applyFilters((await loadRange({ ...q, ...prevRange }, cleanRange({ ...q, ...prevRange }))).items, q);
  const prevSummary = summarize(prevItems, cleanRange(prevRange), basis);

  // Delivery & read rate per day (a one-day range shows the last 14 days).
  let trendItems = filtered;
  let trendRange = range;
  if (range.from === range.to) {
    trendRange = cleanRange({ from: addIstDays(range.to, -13), to: range.to });
    trendItems = applyFilters((await loadRange({ ...q, from: trendRange.from, to: trendRange.to, fromTime: null, toTime: null }, trendRange)).items, q);
  }
  const trendByDay = new Map(trendRange.days.map((d) => [d, { total: 0, accepted: 0, delivered: 0, read: 0 }]));
  for (const m of trendItems) {
    const row = trendByDay.get(dayOfMessage(m, basis));
    if (!row) continue;
    row.total += 1;
    if (["sent", "delivered", "read"].includes(m.status)) row.accepted += 1;
    if (["delivered", "read"].includes(m.status)) row.delivered += 1;
    if (m.status === "read") row.read += 1;
  }

  const triggers = new Map();
  for (const m of filtered) {
    if (!triggers.has(m.trigger)) triggers.set(m.trigger, { trigger: m.trigger, pending: 0, sent: 0, delivered: 0, read: 0, failed: 0, nowa: 0 });
    triggers.get(m.trigger)[m.status === "failed" && m.notOnWhatsApp ? "nowa" : m.status] += 1;
  }
  const reasons = new Map();
  for (const m of filtered.filter((x) => x.status === "failed")) {
    const label = failureCategory(m);
    reasons.set(label, (reasons.get(label) || 0) + 1);
  }
  const depts = new Map();
  for (const m of filtered.filter((x) => x.department && x.document === "lab")) {
    const d = depts.get(m.department) || { department: m.department, total: 0, delivered: 0, read: 0, failed: 0 };
    d.total += 1;
    if (["delivered", "read"].includes(m.status)) d.delivered += 1;
    if (m.status === "read") d.read += 1;
    if (m.status === "failed") d.failed += 1;
    depts.set(m.department, d);
  }
  const staff = new Map();
  for (const m of filtered.filter((x) => x.trigger === "manual")) {
    const s = staff.get(m.triggeredBy) || { user: m.triggeredBy, total: 0, failed: 0, manual: 0 };
    s.total += 1;
    s.manual += 1;
    if (m.status === "failed") s.failed += 1;
    staff.set(m.triggeredBy, s);
  }
  const hours = (dates) => {
    const h = Array(24).fill(0);
    for (const d of dates) h[hourIst(d)] += 1;
    return h;
  };

  return {
    previous: {
      from: prevRange.from,
      to: prevRange.to,
      total: prevSummary.total,
      delivered: prevSummary.funnel.delivered,
      read: prevSummary.counts.read,
      failed: prevSummary.counts.failed,
      rates: prevSummary.rates,
    },
    trendRange: { from: trendRange.from, to: trendRange.to },
    trend: [...trendByDay].map(([bucket, t]) => ({
      bucket,
      total: t.total,
      deliveredRate: t.accepted ? t.delivered / t.accepted : null,
      readRate: t.delivered ? t.read / t.delivered : null,
    })),
    readHours: hours(filtered.filter((m) => m.readAt).map((m) => m.readAt)),
    sendHours: hours(filtered.map((m) => m.createdAt)),
    timeToRead: bucketTimes(filtered.map((m) => secsBetween(m.acceptedAt, m.readAt)).filter((x) => x != null && x >= 0)),
    timeToDeliver: bucketTimes(filtered.map((m) => secsBetween(m.acceptedAt, m.deliveredAt)).filter((x) => x != null && x >= 0)),
    // From approval in the lab to the WhatsApp leaving (the 3-hour wait + night hold).
    approvalToSend: bucketTimes(
      filtered
        .filter((m) => m.document === "lab" && m.acceptedAt && m.approvedAt)
        .map((m) => secsBetween(m.approvedAt, m.acceptedAt))
        .filter((x) => x != null && x >= 0)
    ),
    byTrigger: [...triggers.values()],
    failureReasons: [...reasons].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    departments: [...depts.values()].sort((a, b) => b.total - a.total).slice(0, 12),
    staff: [...staff.values()].sort((a, b) => b.total - a.total).slice(0, 10),
    attention: {
      fixable: filtered.filter((m) => SPECIAL.fixable(m)).length,
      nowa: filtered.filter((m) => SPECIAL.nowa(m)).length,
      unread24: filtered.filter((m) => SPECIAL.unread24(m, now)).length,
      stuck6: filtered.filter((m) => SPECIAL.stuck6(m, now)).length,
      review: filtered.filter((m) => SPECIAL.review(m)).length,
      autoRetrying: filtered.filter((m) => m.status === "failed" && m.nextRetryAt).length,
    },
    coverage: await coverage(range, settings),
    liveEnabled: Boolean(settings.messageSendEnabled && config.wati.sendEnabled && !config.wati.testMode && !settings.watiTestSendMode),
    sendDelayHours: settings.sendDelayHours,
  };
}

// ---- WATI card, actions, export -----------------------------------------------

export async function monitorWati() {
  const settings = await getSettings();
  const start = istMidnight(reportDayKey());
  const [sendsToday, retriesToday, statusToday, usage, state] = await Promise.all([
    MessageLog.countDocuments({ sentAt: { $gte: start } }),
    MessageLog.countDocuments({ sentAt: { $gte: start }, triggerType: "AUTO_RETRY" }),
    checksUsedToday(),
    readWatiApiUsage(),
    deliveryCheckState(),
  ]);
  const base = config.publicBaseUrl;
  return {
    usage: {
      today: { total: sendsToday + statusToday, send: sendsToday, status: statusToday, retry: retriesToday },
      statusChecksPerDay: settings.statusChecksPerDay ?? 100,
      month: { total: usage.totalCalls || 0, limit: config.wati.basicPlanApiLimit || null },
    },
    poll: pollState(state),
    link: base
      ? { mode: "private", https: base.startsWith("https://"), baseUrl: base, days: config.reportLinkDays }
      : { mode: "emr", https: false, baseUrl: "", days: null },
    webhookPath: `/api/webhooks/wati/${watiWebhookKey()}`,
  };
}

export async function monitorRefresh() {
  const result = await runDeliveryChecks();
  return { poll: { checked: result.numbers || 0, updated: result.updated || 0, skipped: result.skipped || null, error: result.error || null } };
}

/** "Retry now" from the drawer — the report's latest failed send, or a send cut off mid-way. */
export async function monitorRetry(id, sentBy) {
  const message = await monitorMessage(id);
  if (!message?.reportRef) {
    const error = new Error("Message not found");
    error.status = 404;
    throw error;
  }
  if (!message.canRetry) {
    const error = new Error(
      message.document === "test" ? "Test sends are not retried — send a new test from the queue" : "This report has been sent again since — nothing to retry"
    );
    error.status = 409;
    throw error;
  }
  await sendReportById(message.reportRef, { triggerType: "MANUAL", force: message.review === true, sentBy });
  const latest = await MessageLog.findOne({ reportRef: message.reportRef }).sort({ sentAt: -1 }).select("_id").lean();
  return { message: latest ? await monitorMessage(String(latest._id)) : message };
}

const CSV_COLUMNS = [
  ["Status", (m) => (m.status === "failed" && m.notOnWhatsApp ? "not on WhatsApp" : m.status)],
  ["Patient", (m) => m.patientName],
  ["UHID", (m) => m.uhid],
  ["Order", (m) => m.orderId],
  ["Lab day", (m) => m.reportDay || ""],
  ["Department", (m) => m.department],
  ["Kind", (m) => m.documentLabel],
  ["To", (m) => m.toNumber],
  ["Trigger", (m) => m.trigger],
  ["By", (m) => m.triggeredBy],
  ["Approved", (m) => m.approvedAt],
  ["Sent", (m) => m.acceptedAt || m.createdAt],
  ["Delivered", (m) => m.deliveredAt],
  ["Read", (m) => m.readAt],
  ["Failed", (m) => m.failedAt],
  ["Error", (m) => m.error],
];

const istText = (v) =>
  v instanceof Date || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v))
    ? new Intl.DateTimeFormat("en-GB", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }).format(new Date(v))
    : v ?? "";

export async function monitorExport(q = {}) {
  const range = cleanRange(q);
  const { items } = await loadRange(q, range);
  const rows = applyFilters(items, q).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const name = `whatsapp-op-${range.from}${range.to !== range.from ? `_to_${range.to}` : ""}`;
  if (q.format === "json") {
    const data = q.view === "patients" ? groupPatients(rows) : rows;
    return { fileName: `${name}.json`, contentType: "application/json", body: JSON.stringify(data, null, 2) };
  }
  const esc = (v) => {
    const s = String(istText(v));
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CSV_COLUMNS.map(([h]) => h).join(","), ...rows.map((m) => CSV_COLUMNS.map(([, f]) => esc(f(m))).join(","))];
  // BOM so Excel opens the Tamil / special characters correctly
  return { fileName: `${name}.csv`, contentType: "text/csv; charset=utf-8", body: `﻿${lines.join("\r\n")}` };
}
