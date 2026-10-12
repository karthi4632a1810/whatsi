/**
 * The OP Reports screen: every OP lab order for a date range, joined with its
 * WhatsApp queue row and latest message, with one status ("stage") per order.
 */
import { HisLabOrder, LabBoardDay, MessageLog, Patient, Report } from "../models/index.js";
import { DELIVERY_OP_IP_TYPE } from "./emr.js";
import { getSettings } from "./reports.js";
import { boardRefreshJob, startBoardRefresh } from "./hisBoardStore.js";
import { config } from "../config.js";
import { enumerateDays, reportDayKey } from "../utils/dates.js";
import { STAGE_ORDER, deriveStage, plannedSendAt } from "../utils/schedule.js";
import { groupTests } from "../utils/emrParse.js";

export const MAX_RANGE_DAYS = 31;

export function sendFlags(settings) {
  return {
    sendingOn: Boolean(settings.messageSendEnabled) && config.wati.sendEnabled && !config.wati.testMode,
    automationOn: Boolean(settings.automationEnabled),
    testMode: Boolean(settings.watiTestSendMode),
  };
}

export function rangeDays(fromRaw, toRaw) {
  const today = reportDayKey();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw || "") ? fromRaw : today;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(toRaw || "") ? toRaw : from;
  const days = enumerateDays(from <= to ? from : to, from <= to ? to : from);
  if (days.length > MAX_RANGE_DAYS) {
    const error = new Error(`Pick a range of up to ${MAX_RANGE_DAYS} days`);
    error.status = 400;
    throw error;
  }
  return days;
}

/** Latest real send and whether a test send happened, per order ID. */
async function latestLogs(orderIds) {
  if (!orderIds.length) return new Map();
  const rows = await MessageLog.aggregate([
    { $match: { reportId: { $in: orderIds } } },
    { $sort: { sentAt: -1 } },
    {
      $group: {
        _id: "$reportId",
        lastStatus: { $first: "$status" },
        lastPhone: { $first: "$phone" },
        lastAt: { $first: "$sentAt" },
        lastTest: { $first: "$testSend" },
        testSent: { $max: { $cond: [{ $and: [{ $eq: ["$testSend", true] }, { $ne: ["$status", "FAILED"] }] }, 1, 0] } },
        messages: { $sum: 1 },
      },
    },
  ]);
  return new Map(rows.map((row) => [row._id, row]));
}

function toRow({ order, report, log, settings, flags, now }) {
  const base = order || {};
  const stage = deriveStage({ order, report, settings, flags, now });
  const planned = report && report.status === "PENDING" ? plannedSendAt(report, settings) : null;
  const tests = groupTests(base.procedures || []);
  return {
    orderId: String(base.orderId || report?.reportId),
    labDay: base.labDay || report?.reportDay,
    patientId: base.patientId || report?.patientId || "",
    patientName: report?.patientName || base.patientName || "",
    phone: report?.phone || base.phone || "",
    department: base.department || report?.department || "",
    patientType: base.patientType || report?.patientType || "",
    readiness: base.readiness || report?.readiness || "WAITING",
    approvedCount: base.approvedCount ?? report?.approvedCount ?? 0,
    procedureTotal: base.procedureTotal ?? report?.procedureTotal ?? 0,
    tests: tests.map((t) => t.name).slice(0, 12),
    testsTotal: tests.length,
    testsApproved: tests.filter((t) => t.approved === t.total).length,
    requestDate: base.requestDate || null,
    approvedAt: report?.reportReadyAt || base.completedAt || null,
    stage,
    plannedSendAt: planned ? planned.toISOString() : null,
    queueId: report?._id ? String(report._id) : null,
    queueStatus: report?.status || null,
    sentAt: report?.sentAt || null,
    deliveredAt: report?.deliveredAt || null,
    readAt: report?.readAt || null,
    attempts: report?.attempts || 0,
    lastError: report?.lastError || "",
    failureKind: report?.failureKind || "",
    nextRetryAt: report?.nextRetryAt || null,
    sentBy: report?.sentBy || "",
    triggerType: report?.status === "SENT" ? report.triggerType : null,
    testSent: Boolean(log?.testSent),
    messages: log?.messages || 0,
    hasPdf: Boolean(report?.hisReportUrl || (base.procIds || []).length),
    procIds: report?.procIds?.length ? report.procIds : base.procIds || [],
  };
}

function matchesSearch(row, q) {
  if (!q) return true;
  const term = q.toLowerCase();
  const digits = q.replace(/\D/g, "");
  if (row.patientName.toLowerCase().includes(term)) return true;
  if (String(row.patientId).toLowerCase().includes(term)) return true;
  if (String(row.orderId).includes(term)) return true;
  if (row.department.toLowerCase().includes(term)) return true;
  if (digits.length >= 3 && String(row.phone).includes(digits)) return true;
  return row.tests.some((t) => t.toLowerCase().includes(term));
}

const SORTS = {
  recent: (a, b) => new Date(b.approvedAt || b.requestDate || 0) - new Date(a.approvedAt || a.requestDate || 0),
  oldest: (a, b) => new Date(a.approvedAt || a.requestDate || 0) - new Date(b.approvedAt || b.requestDate || 0),
  sendTime: (a, b) =>
    new Date(a.plannedSendAt || a.sentAt || 8.64e15) - new Date(b.plannedSendAt || b.sentAt || 8.64e15),
  name: (a, b) => a.patientName.localeCompare(b.patientName),
};

/** All rows for the days (before search / filters). */
export async function loadOpRows(days, { now = new Date() } = {}) {
  const [orders, reports, settings] = await Promise.all([
    HisLabOrder.find({ labDay: { $in: days }, opIpType: DELIVERY_OP_IP_TYPE }).lean(),
    Report.find({ reportDay: { $in: days }, opIpType: DELIVERY_OP_IP_TYPE }).lean(),
    getSettings(),
  ]);
  const reportByOrder = new Map();
  for (const report of reports) {
    const prev = reportByOrder.get(report.reportId);
    if (!prev || new Date(report.updatedAt) > new Date(prev.updatedAt)) reportByOrder.set(report.reportId, report);
  }
  const orderIds = [...new Set([...orders.map((o) => String(o.orderId)), ...reportByOrder.keys()])];
  const [logs, overrides] = await Promise.all([
    latestLogs(orderIds),
    Patient.find({ patientId: { $in: [...new Set(orders.map((o) => o.patientId).filter(Boolean))] }, phoneOverride: { $nin: ["", null] } })
      .select("patientId phoneOverride")
      .lean(),
  ]);
  const overrideByUhid = new Map(overrides.map((p) => [p.patientId, p.phoneOverride]));
  for (const order of orders) {
    if (overrideByUhid.has(order.patientId)) order.phone = overrideByUhid.get(order.patientId);
  }
  const flags = sendFlags(settings);

  const rows = [];
  const seen = new Set();
  for (const order of orders) {
    const id = String(order.orderId);
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push(toRow({ order, report: reportByOrder.get(id), log: logs.get(id), settings, flags, now }));
  }
  for (const [id, report] of reportByOrder) {
    if (seen.has(id)) continue;
    rows.push(toRow({ order: null, report, log: logs.get(id), settings, flags, now }));
  }
  return { rows, settings, flags };
}

export async function listOpReports({ from, to, q = "", stage = "", dept = "", sort = "recent", page = 1, pageSize = 50 }) {
  const days = rangeDays(from, to);
  const now = new Date();
  const [{ rows, settings, flags }, boardDays] = await Promise.all([
    loadOpRows(days, { now }),
    LabBoardDay.find({ labDay: { $in: days } }).lean(),
  ]);

  const term = String(q || "").trim();
  const searched = rows.filter((row) => matchesSearch(row, term));
  const departments = new Map();
  for (const row of searched) {
    const name = row.department || "—";
    departments.set(name, (departments.get(name) || 0) + 1);
  }
  const inDept = dept ? searched.filter((row) => (row.department || "—") === dept) : searched;

  const counts = Object.fromEntries(STAGE_ORDER.map((key) => [key, 0]));
  for (const row of inDept) counts[row.stage.key] = (counts[row.stage.key] || 0) + 1;
  counts.all = inDept.length;

  const stages = String(stage || "").split(",").filter(Boolean);
  const filtered = stages.length ? inDept.filter((row) => stages.includes(row.stage.key)) : inDept;
  filtered.sort(SORTS[sort] || SORTS.recent);

  const size = Math.min(Math.max(Number(pageSize) || 50, 10), 200);
  const totalPages = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.min(Math.max(Number(page) || 1, 1), totalPages);

  const dayMeta = new Map(boardDays.map((d) => [d.labDay, d]));
  return {
    from: days[0],
    to: days[days.length - 1],
    total: filtered.length,
    page: current,
    pageSize: size,
    totalPages,
    rows: filtered.slice((current - 1) * size, current * size),
    counts,
    departments: [...departments].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    days: days.map((day) => {
      const meta = dayMeta.get(day);
      const lastSync = [meta?.lastFullSyncAt, meta?.lastIncrementalSyncAt].filter(Boolean).map((d) => new Date(d));
      return {
        day,
        loaded: Boolean(meta?.lastFullSyncAt || meta?.orderCount),
        refreshStatus: meta?.refreshStatus || "idle",
        refreshProgress: meta?.refreshProgress || null,
        refreshError: meta?.refreshError || "",
        lastSyncAt: lastSync.length ? new Date(Math.max(...lastSync)) : null,
      };
    }),
    switches: {
      ...flags,
      mode: settings.mode,
      sendDelayHours: settings.sendDelayHours,
      quietHoursEnabled: settings.quietHoursEnabled,
      quietStart: settings.quietStart,
      quietEnd: settings.quietEnd,
      watiTestContactPhones: settings.watiTestContactPhones || [],
    },
    generatedAt: now,
  };
}

/**
 * Loads days from HIS one after another (each day is fetched in 2-hour slices),
 * so a week-long range doesn't hit the EMR with seven big queries at once.
 */
let refreshChain = Promise.resolve();
const queuedDays = new Set();

export function refreshDays(days) {
  const started = [];
  for (const day of days) {
    if (queuedDays.has(day)) continue;
    queuedDays.add(day);
    started.push(day);
    refreshChain = refreshChain
      .then(async () => {
        startBoardRefresh(day);
        // wait for that day to finish before starting the next
        await boardRefreshJob(day);
      })
      .catch((error) => console.error("[op] refresh failed", day, error.message))
      .finally(() => queuedDays.delete(day));
  }
  return { queued: started, alreadyQueued: days.filter((d) => !started.includes(d)) };
}
