import { MessageLog, Report } from "../models/index.js";
import { testWatiConnection } from "./wati.js";
import { config } from "../config.js";
import { reportDayKey, startOfToday, endOfToday } from "../utils/dates.js";
import { readWatiApiUsage } from "./watiCache.js";

export async function getWatiOverview() {
  const today = reportDayKey();
  const start = startOfToday();
  const end = endOfToday();

  const [
    connection,
    sentToday,
    failedToday,
    pendingAll,
    failedAll,
    sentAll,
    backlogDays,
    dailyRows,
    apiUsage,
  ] = await Promise.all([
    testWatiConnection(),
    MessageLog.countDocuments({ status: "SENT", sentAt: { $gte: start, $lte: end } }),
    MessageLog.countDocuments({ status: "FAILED", sentAt: { $gte: start, $lte: end } }),
    Report.countDocuments({ status: "PENDING" }),
    Report.countDocuments({ status: "FAILED" }),
    Report.countDocuments({ status: "SENT" }),
    Report.aggregate([
      { $match: { status: { $in: ["PENDING", "FAILED"] } } },
      { $group: { _id: "$reportDay", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    MessageLog.aggregate([
      {
        $group: {
          _id: {
            day: { $dateToString: { format: "%Y-%m-%d", date: "$sentAt" } },
            status: "$status",
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.day": -1 } },
      { $limit: 60 },
    ]),
    readWatiApiUsage(),
  ]);

  const dailyMap = new Map();
  for (const row of dailyRows) {
    const day = row._id.day;
    if (!dailyMap.has(day)) {
      dailyMap.set(day, { day, sent: 0, failed: 0, total: 0 });
    }
    const entry = dailyMap.get(day);
    if (row._id.status === "SENT" || row._id.status === "DELIVERED" || row._id.status === "READ") {
      entry.sent += row.count;
    } else if (row._id.status === "FAILED") {
      entry.failed += row.count;
    }
    entry.total += row.count;
  }

  const daily = [...dailyMap.values()]
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, 14);

  return {
    connection,
    config: {
      sendEnabled: config.wati.sendEnabled,
      testMode: config.wati.testMode,
      testPhone: config.wati.testPhoneOnly,
      templateName: config.wati.templateName,
    },
    today: {
      day: today,
      sent: sentToday,
      failed: failedToday,
      successRate:
        sentToday + failedToday > 0
          ? Math.round((sentToday / (sentToday + failedToday)) * 100)
          : null,
    },
    allTime: {
      sent: sentAll,
      failed: failedAll,
      pending: pendingAll,
    },
    apiUsage: {
      period: apiUsage.period,
      calls: apiUsage.totalCalls,
      limit: config.wati.basicPlanApiLimit || null,
      remaining:
        config.wati.basicPlanApiLimit > 0
          ? Math.max(config.wati.basicPlanApiLimit - apiUsage.totalCalls, 0)
          : null,
      percentUsed:
        config.wati.basicPlanApiLimit > 0
          ? Math.min(Math.round((apiUsage.totalCalls / config.wati.basicPlanApiLimit) * 100), 999)
          : null,
      lastCallAt: apiUsage.lastCallAt,
    },
    backlogByDay: backlogDays.map((r) => ({ day: r._id, count: r.count })),
    daily,
  };
}
