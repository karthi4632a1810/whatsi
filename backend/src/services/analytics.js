/**
 * Numbers for the Dashboard: how many OP reports were ready, sent, delivered and
 * read, how fast they went out, why some failed, and what is about to go out.
 * Real sends only — test sends are counted separately.
 */
import { HisLabOrder, MessageLog, Report } from "../models/index.js";
import { DELIVERY_OP_IP_TYPE } from "./emr.js";
import { getSettings } from "./reports.js";
import { loadOpRows } from "./opBoard.js";
import { addIstDays, enumerateDays, parseQueryDate, reportDayKey } from "../utils/dates.js";
import { STAGE_ORDER, classifyFailure, plannedSendAt } from "../utils/schedule.js";

const TZ = "Asia/Kolkata";
const MAX_DAYS = 92;

const FAILURE_LABELS = {
  NO_PHONE: "No phone number",
  NOT_ON_WHATSAPP: "Not on WhatsApp",
  WATI_REJECTED: "WATI rejected",
  TEMPORARY: "Temporary (network / limit)",
  BLOCKED: "Blocked by settings",
};

function range(fromRaw, toRaw) {
  const today = reportDayKey();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(toRaw || "") ? toRaw : today;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw || "") ? fromRaw : addIstDays(to, -13);
  const days = enumerateDays(from <= to ? from : to, from <= to ? to : from);
  if (days.length > MAX_DAYS) {
    const error = new Error(`Pick a range of up to ${MAX_DAYS} days`);
    error.status = 400;
    throw error;
  }
  return days;
}

function bounds(days) {
  return { start: parseQueryDate(days[0], false), end: parseQueryDate(days[days.length - 1], true) };
}

/** Sent / delivered / read / failed totals for real sends in [start, end]. */
async function messageTotals(start, end) {
  const rows = await MessageLog.aggregate([
    { $match: { sentAt: { $gte: start, $lte: end }, testSend: { $ne: true } } },
    { $group: { _id: "$status", n: { $sum: 1 } } },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const read = by.READ || 0;
  const delivered = (by.DELIVERED || 0) + read;
  const sent = (by.SENT || 0) + delivered;
  return { sent, delivered, read, failed: by.FAILED || 0 };
}

async function boardTotals(days) {
  const [row] = await HisLabOrder.aggregate([
    { $match: { labDay: { $in: days }, opIpType: DELIVERY_OP_IP_TYPE } },
    {
      $group: {
        _id: null,
        orders: { $sum: 1 },
        ready: { $sum: { $cond: [{ $eq: ["$readiness", "READY"] }, 1, 0] } },
        partial: { $sum: { $cond: [{ $eq: ["$readiness", "PARTIAL"] }, 1, 0] } },
        waiting: { $sum: { $cond: [{ $eq: ["$readiness", "WAITING"] }, 1, 0] } },
        excluded: { $sum: { $cond: [{ $eq: ["$patientType", "ZPATIENT"] }, 1, 0] } },
      },
    },
  ]);
  return row || { orders: 0, ready: 0, partial: 0, waiting: 0, excluded: 0 };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function getAnalytics({ from, to } = {}) {
  const days = range(from, to);
  const { start, end } = bounds(days);
  const prevDays = enumerateDays(addIstDays(days[0], -days.length), addIstDays(days[0], -1));
  const prev = bounds(prevDays);
  const settings = await getSettings();
  const now = new Date();
  const today = reportDayKey(now);

  const [
    totals,
    prevTotals,
    board,
    prevBoard,
    dailyMessages,
    dailyBoard,
    sentReports,
    failedLogs,
    deptOrders,
    deptSent,
    hourly,
    testSends,
    pending,
    todayRows,
  ] = await Promise.all([
    messageTotals(start, end),
    messageTotals(prev.start, prev.end),
    boardTotals(days),
    boardTotals(prevDays),
    MessageLog.aggregate([
      { $match: { sentAt: { $gte: start, $lte: end }, testSend: { $ne: true } } },
      { $group: { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$sentAt", timezone: TZ } }, status: "$status" }, n: { $sum: 1 } } },
    ]),
    HisLabOrder.aggregate([
      { $match: { labDay: { $in: days }, opIpType: DELIVERY_OP_IP_TYPE } },
      {
        $group: {
          _id: "$labDay",
          orders: { $sum: 1 },
          ready: { $sum: { $cond: [{ $eq: ["$readiness", "READY"] }, 1, 0] } },
        },
      },
    ]),
    Report.find({ opIpType: DELIVERY_OP_IP_TYPE, status: "SENT", sentAt: { $gte: start, $lte: end } })
      .select("sentAt reportReadyAt readySeenAt triggerType reportDay")
      .lean(),
    MessageLog.find({ sentAt: { $gte: start, $lte: end }, testSend: { $ne: true }, status: "FAILED" })
      .select("errorReason")
      .lean(),
    HisLabOrder.aggregate([
      { $match: { labDay: { $in: days }, opIpType: DELIVERY_OP_IP_TYPE } },
      { $group: { _id: "$department", orders: { $sum: 1 } } },
      { $sort: { orders: -1 } },
      { $limit: 12 },
    ]),
    Report.aggregate([
      { $match: { opIpType: DELIVERY_OP_IP_TYPE, status: "SENT", sentAt: { $gte: start, $lte: end } } },
      { $group: { _id: "$department", sent: { $sum: 1 } } },
    ]),
    MessageLog.aggregate([
      { $match: { sentAt: { $gte: start, $lte: end }, testSend: { $ne: true }, status: { $ne: "FAILED" } } },
      { $group: { _id: { $hour: { date: "$sentAt", timezone: TZ } }, n: { $sum: 1 } } },
    ]),
    MessageLog.countDocuments({ sentAt: { $gte: start, $lte: end }, testSend: true, status: { $ne: "FAILED" } }),
    Report.find({
      opIpType: DELIVERY_OP_IP_TYPE,
      status: "PENDING",
      readiness: "READY",
      phone: { $nin: ["", null] },
      patientType: { $ne: "ZPATIENT" },
    })
      .select("reportId patientName department reportReadyAt readySeenAt readiness")
      .lean(),
    loadOpRows([today], { now }),
  ]);

  // ---- per day series
  const msgByDay = new Map();
  for (const row of dailyMessages) {
    const entry = msgByDay.get(row._id.day) || { SENT: 0, DELIVERED: 0, READ: 0, FAILED: 0 };
    entry[row._id.status] = (entry[row._id.status] || 0) + row.n;
    msgByDay.set(row._id.day, entry);
  }
  const boardByDay = new Map(dailyBoard.map((row) => [row._id, row]));
  const series = days.map((day) => {
    const m = msgByDay.get(day) || {};
    const b = boardByDay.get(day) || {};
    return {
      day,
      orders: b.orders || 0,
      ready: b.ready || 0,
      sent: m.SENT || 0,
      delivered: m.DELIVERED || 0,
      read: m.READ || 0,
      failed: m.FAILED || 0,
    };
  });

  // ---- approval → WhatsApp timing
  const minutes = sentReports
    .map((r) => {
      const base = r.reportReadyAt || r.readySeenAt;
      return base ? (new Date(r.sentAt) - new Date(base)) / 60000 : null;
    })
    .filter((m) => m != null && m >= 0);
  const delay = Number(settings.sendDelayHours ?? 3) * 60;
  const onTime = minutes.filter((m) => m <= delay + 60).length;

  // ---- failures by kind
  const failureKinds = new Map();
  for (const log of failedLogs) {
    const { kind } = classifyFailure(log.errorReason);
    failureKinds.set(kind, (failureKinds.get(kind) || 0) + 1);
  }

  // ---- departments
  const sentByDept = new Map(deptSent.map((d) => [d._id || "—", d.sent]));
  const departments = deptOrders.map((d) => ({
    name: d._id || "—",
    orders: d.orders,
    sent: sentByDept.get(d._id || "—") || 0,
  }));

  // ---- upcoming sends (next 24 h)
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const upcoming = pending
    .map((r) => ({ ...r, plannedAt: plannedSendAt(r, settings) }))
    .filter((r) => r.plannedAt && r.plannedAt > now && r.plannedAt <= horizon)
    .sort((a, b) => a.plannedAt - b.plannedAt);
  const upcomingByHour = new Map();
  for (const r of upcoming) {
    const key = new Date(Math.floor(r.plannedAt.getTime() / 3600000) * 3600000).toISOString();
    upcomingByHour.set(key, (upcomingByHour.get(key) || 0) + 1);
  }

  // ---- today's live status mix
  const todayStages = Object.fromEntries(STAGE_ORDER.map((key) => [key, 0]));
  for (const row of todayRows.rows) todayStages[row.stage.key] = (todayStages[row.stage.key] || 0) + 1;

  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, sent: 0 }));
  for (const row of hourly) hours[row._id].sent = row.n;

  return {
    from: days[0],
    to: days[days.length - 1],
    days: days.length,
    previous: { from: prevDays[0], to: prevDays[prevDays.length - 1] },
    kpis: {
      opOrders: board.orders,
      ready: board.ready,
      sent: totals.sent,
      delivered: totals.delivered,
      read: totals.read,
      failed: totals.failed,
      testSends,
      deliveryRate: totals.sent ? totals.delivered / totals.sent : null,
      readRate: totals.sent ? totals.read / totals.sent : null,
      medianMinutesToSend: median(minutes),
      onTimeRate: minutes.length ? onTime / minutes.length : null,
    },
    previousKpis: {
      opOrders: prevBoard.orders,
      ready: prevBoard.ready,
      sent: prevTotals.sent,
      delivered: prevTotals.delivered,
      read: prevTotals.read,
      failed: prevTotals.failed,
    },
    board,
    series,
    funnel: [
      { key: "orders", label: "OP lab orders", value: board.orders },
      { key: "ready", label: "All results approved", value: board.ready },
      { key: "sent", label: "Sent on WhatsApp", value: totals.sent },
      { key: "delivered", label: "Delivered", value: totals.delivered },
      { key: "read", label: "Read", value: totals.read },
    ],
    failures: [...failureKinds]
      .map(([kind, count]) => ({ kind, label: FAILURE_LABELS[kind] || kind, count }))
      .sort((a, b) => b.count - a.count),
    departments,
    hours,
    upcoming: {
      total: upcoming.length,
      next: upcoming.slice(0, 6).map((r) => ({
        orderId: r.reportId,
        patientName: r.patientName,
        department: r.department,
        plannedAt: r.plannedAt,
      })),
      byHour: [...upcomingByHour].map(([hour, count]) => ({ hour, count })),
    },
    today: { day: today, stages: todayStages, total: todayRows.rows.length },
    switches: {
      ...todayRows.flags,
      mode: settings.mode,
      sendDelayHours: settings.sendDelayHours,
      quietHoursEnabled: settings.quietHoursEnabled,
      quietStart: settings.quietStart,
      quietEnd: settings.quietEnd,
    },
    sendDelayHours: Number(settings.sendDelayHours ?? 3),
  };
}
