import express from "express";
import { Report, MessageLog } from "../models/index.js";
import {
  getDashboardStats,
  getHisDayStats,
  getSettings,
  runEmrPoll,
  sendPendingReports,
  sendReportById,
  resolveOrderPdfUrl,
  getOrderPdfMetaMap,
  upsertOrderPdfMeta,
  syncOrderToQueue,
} from "../services/reports.js";
import { parseLabReportUrl } from "../utils/labReportUrl.js";
import {
  buildLabReportUrl,
  isEmrReportUrl,
  isPlausibleProcIds,
  looksLikeEmrOrderId,
} from "../services/emr.js";
import { escapeRegex } from "../utils/text.js";
import { plannedSendAt, scheduleNote } from "../utils/schedule.js";
import { sendFlags } from "../services/opBoard.js";
import { reportDayKey, startOfToday, endOfToday, parseQueryDate } from "../utils/dates.js";
import { deriveWhatsappDisplay } from "../utils/whatsappDisplay.js";
import {
  getStoredBoard,
  getLabBoardMeta,
  refreshBoardFromEmr,
  refreshOrderFromEmr,
  applyBoardFilter,
  summarizeBoardOrders,
  startBoardRefresh,
  getBoardRefreshStatus,
  getActiveBoardRefreshes,
  searchLabBoardRange,
} from "../services/hisBoardStore.js";

const router = express.Router();

function latestSyncAt(meta) {
  if (!meta) return null;
  const full = meta.lastFullSyncAt ? new Date(meta.lastFullSyncAt).getTime() : 0;
  const incremental = meta.lastIncrementalSyncAt
    ? new Date(meta.lastIncrementalSyncAt).getTime()
    : 0;
  const ts = Math.max(full, incremental);
  return ts ? new Date(ts) : null;
}

router.get("/stats", async (req, res) => {
  const scope = String(req.query.scope || "today").toLowerCase();
  const date = req.query.date ? String(req.query.date) : undefined;
  res.json(await getDashboardStats({ scope, date }));
});

router.get("/stats/his", async (req, res) => {
  try {
    const date = req.query.date ? String(req.query.date) : reportDayKey();
    res.json(await getHisDayStats(date));
  } catch (error) {
    const status = error.code === "EMR_SQL_TIMEOUT" ? 503 : 500;
    res.status(status).json({
      error: error.message,
      code: error.code || "EMR_ERROR",
    });
  }
});

router.get("/his/lab-today", async (req, res) => {
  try {
    const filter = String(req.query.filter || "all").toLowerCase();
    const from = req.query.from ? parseQueryDate(req.query.from, false) : startOfToday();
    const to = req.query.to ? parseQueryDate(req.query.to, true) : endOfToday();
    const day = reportDayKey(from);
    const refresh = req.query.refresh === "true";

    if (refresh) {
      startBoardRefresh(day);
    }

    let orders = await getStoredBoard(day, "all");
    const meta = await getLabBoardMeta(day);
    const refreshStatus = await getBoardRefreshStatus(day);

    if (!orders.length && !refresh && refreshStatus.refreshStatus !== "running") {
      return res.json({
        date: day,
        filter,
        summary: summarizeBoardOrders([]),
        orders: [],
        source: "mongodb",
        needsRefresh: true,
        lastSyncAt: null,
        refreshStatus: refreshStatus.refreshStatus,
        refreshProgress: refreshStatus.refreshProgress,
      });
    }

    orders = applyBoardFilter(orders, filter);
    const enriched = await enrichHisOrders(orders);
    const summary = buildHisSummary(enriched);

    res.json({
      date: day,
      filter,
      summary,
      orders: enriched,
      source: refreshStatus.refreshStatus === "running" ? "emr" : "mongodb",
      needsRefresh: false,
      lastSyncAt: latestSyncAt(meta),
      refreshStatus: refreshStatus.refreshStatus,
      refreshProgress: refreshStatus.refreshProgress,
      refreshError: refreshStatus.refreshError || "",
    });
  } catch (error) {
    const status = error.code === "EMR_SQL_TIMEOUT" ? 503 : 500;
    res.status(status).json({
      error: error.message,
      code: error.code || "EMR_ERROR",
    });
  }
});

router.post("/his/lab-today/refresh", async (req, res) => {
  try {
    const day = req.body?.date
      ? reportDayKey(parseQueryDate(req.body.date, false))
      : reportDayKey();
    const result = startBoardRefresh(day);
    const status = await getBoardRefreshStatus(day);
    res.json({ ...result, ...status });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/** Quiet HIS pull — picks up new/changed rows without progressive UI. */
router.post("/his/lab-today/soft-refresh", async (req, res) => {
  try {
    const day = req.body?.date
      ? reportDayKey(parseQueryDate(req.body.date, false))
      : reportDayKey();
    const status = await getBoardRefreshStatus(day);
    if (status.refreshStatus === "running") {
      return res.json({
        skipped: true,
        reason: "full refresh already running",
        ...status,
      });
    }
    const result = await refreshBoardFromEmr(day, { mode: "incremental" });
    res.json(result);
  } catch (error) {
    const statusCode = error.code === "EMR_SQL_TIMEOUT" ? 503 : 400;
    res.status(statusCode).json({ error: error.message, code: error.code || "EMR_ERROR" });
  }
});

router.get("/his/lab-today/refresh-status", async (req, res) => {
  const day = req.query.date
    ? reportDayKey(parseQueryDate(req.query.date, false))
    : reportDayKey();
  res.json(await getBoardRefreshStatus(day));
});

router.get("/his/lab-today/active-refreshes", async (_req, res) => {
  res.json({ refreshes: await getActiveBoardRefreshes() });
});

router.post("/his/lab-today/:orderId/refresh", async (req, res) => {
  try {
    const orderId = String(req.params.orderId || "").trim();
    const day = req.body?.date
      ? reportDayKey(parseQueryDate(req.body.date, false))
      : reportDayKey();
    const result = await refreshOrderFromEmr(day, orderId);
    const doc = await getStoredBoard(day, "all");
    const order = doc.find((o) => String(o.orderId) === orderId);
    const enriched = order ? (await enrichHisOrders([order]))[0] : null;
    res.json({ ...result, labDay: day, order: enriched });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/his/lab-search", async (req, res) => {
  try {
    const filter = String(req.query.filter || "ready").toLowerCase();
    const fromRaw = String(req.query.from || "").trim();
    const toRaw = String(req.query.to || "").trim();
    if (!fromRaw || !toRaw) {
      return res.status(400).json({ error: "from and to dates are required (YYYY-MM-DD)" });
    }

    const q = String(req.query.q || "").trim();
    const result = await searchLabBoardRange({ fromRaw, toRaw, filter, q });
    const filtered = filterOrdersSearch(result.orders, q);
    const enriched = await enrichHisOrders(filtered);
    const summary = buildHisSummary(enriched);

    res.json({
      from: fromRaw,
      to: toRaw,
      daysLoaded: result.daysLoaded,
      cachedDays: result.cachedDays,
      missingDays: result.missingDays,
      emrDaysLoaded: result.emrDaysLoaded,
      source: result.source,
      filter,
      summary,
      orders: enriched,
    });
  } catch (error) {
    const status = error.code === "EMR_SQL_TIMEOUT" ? 503 : 500;
    res.status(status).json({
      error: error.message,
      code: error.code || "EMR_ERROR",
    });
  }
});

router.post("/reports/sync-order", async (req, res) => {
  try {
    const { orderId, from, to, reportDay } = req.body || {};
    const result = await syncOrderToQueue(orderId, { from, to, reportDay });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

function filterOrdersSearch(orders, query = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return orders || [];
  const digits = q.replace(/\D/g, "");
  return (orders || []).filter((order) => {
    const patientId = String(order.patientId || "").toLowerCase();
    const orderId = String(order.orderId || "").toLowerCase();
    const patientName = String(order.patientName || "").toLowerCase();
    const phone = String(order.phone || "").replace(/\D/g, "");
    if (patientId.includes(q) || orderId.includes(q) || patientName.includes(q)) return true;
    if (digits && (patientId.includes(digits) || orderId.includes(digits) || phone.includes(digits))) {
      return true;
    }
    return false;
  });
}

function buildHisSummary(enriched) {
  return {
    totalOrders: enriched.length,
    ready: enriched.filter((o) => o.readiness === "READY").length,
    partial: enriched.filter((o) => o.readiness === "PARTIAL").length,
    approved: enriched.filter((o) => o.hisStatus === "RESULT APPROVED").length,
    inProcess: enriched.filter((o) => o.statusCounts["IN PROCESS"]).length,
    sent: enriched.filter((o) => o.whatsappTone === "sent").length,
    pendingWhatsApp: enriched.filter(
      (o) => o.whatsappTone === "pending" || o.whatsappTone === "idle"
    ).length,
    testSent: enriched.filter((o) => o.whatsappTone === "test").length,
  };
}

async function enrichHisOrders(orders) {
  const orderIds = orders.map((o) => o.orderId);
  const settings = await getSettings();
  const flags = sendFlags(settings);
  const [whatsappReports, pdfMetaMap, lastLogs] = await Promise.all([
    Report.find({ reportId: { $in: orderIds } }),
    getOrderPdfMetaMap(orderIds),
    orderIds.length
      ? MessageLog.aggregate([
          { $match: { reportId: { $in: orderIds } } },
          { $sort: { sentAt: -1 } },
          {
            $group: {
              _id: "$reportId",
              status: { $first: "$status" },
              testSend: { $first: "$requestPayload.testSend" },
            },
          },
        ])
      : [],
  ]);
  const waMap = new Map();
  for (const r of whatsappReports) {
    const prev = waMap.get(r.reportId);
    if (!prev || (r.updatedAt && (!prev.updatedAt || r.updatedAt > prev.updatedAt))) {
      waMap.set(r.reportId, r);
    }
  }
  const logMap = new Map(lastLogs.map((l) => [l._id, l]));

  return orders.map((order) => {
    const wa = waMap.get(order.orderId);
    const lastLog = logMap.get(order.orderId);
    const waDisplay = deriveWhatsappDisplay(wa, lastLog, { settings, flags });
    const meta = pdfMetaMap.get(order.orderId);
    const procIds = isPlausibleProcIds(wa?.procIds)
      ? wa.procIds
      : isPlausibleProcIds(meta?.procIds)
        ? meta.procIds
        : isPlausibleProcIds(order.procIds)
          ? order.procIds
          : [];
    const hisReportUrl =
      (wa?.hisReportUrl && isPlausibleProcIds(wa?.procIds) && wa.hisReportUrl) ||
      (meta?.hisReportUrl && isPlausibleProcIds(meta?.procIds) && meta.hisReportUrl) ||
      (isPlausibleProcIds(order.procIds)
        ? buildLabReportUrl(order.orderId, order.procIds)
        : null);

    return {
      ...order,
      requestDate: order.requestDate?.toISOString?.() || order.requestDate || null,
      completedAt: order.completedAt?.toISOString?.() || order.completedAt || null,
      procedures: (order.procedures || []).map((p) => ({
        ...p,
        completedAt: p.completedAt?.toISOString?.() || p.completedAt || null,
      })),
      whatsappStatus: wa?.status || null,
      whatsappReadiness: wa?.readiness || null,
      whatsappLabel: waDisplay.label,
      whatsappTone: waDisplay.tone,
      synced: Boolean(wa),
      queueReportId: wa?._id?.toString() || null,
      procIds,
      hisReportUrl,
      hasPdfLink: Boolean(hisReportUrl),
      canPreview: order.readiness === "READY" || order.readiness === "PARTIAL",
      canQueue:
        (order.readiness === "READY" || order.readiness === "PARTIAL") &&
        waDisplay.tone !== "sent" &&
        waDisplay.tone !== "pending",
    };
  });
}

function parseProcIdsQuery(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

// Order IDs reach SQL text sent to the EMR — only plain numeric IDs get past here.
router.param("orderId", (req, res, next, value) => {
  if (!looksLikeEmrOrderId(value)) return res.status(400).json({ error: "Invalid order ID" });
  next();
});

router.get("/his/pdf-url/:orderId", async (req, res) => {
  try {
    res.json(
      await resolveOrderPdfUrl(req.params.orderId, {
        procIds: parseProcIdsQuery(req.query.procIds),
      })
    );
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/his/pdf/:orderId", async (req, res) => {
  try {
    const { pdfUrl, procIds, source } = await resolveOrderPdfUrl(req.params.orderId, {
      procIds: parseProcIdsQuery(req.query.procIds),
    });
    if (!pdfUrl) {
      return res.status(404).json({
        error: "PDF not available for this order (procedure IDs not resolved from EMR)",
        orderId: req.params.orderId,
        procIds,
        source,
      });
    }

    if (!isEmrReportUrl(pdfUrl)) {
      return res.status(400).json({ error: "Stored report link is not an EMR report URL" });
    }
    const upstream = await fetch(pdfUrl, { signal: AbortSignal.timeout(60_000) });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `EMR PDF fetch failed (${upstream.status})` });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get("content-type") || "";
    const looksLikePdf =
      buffer.slice(0, 5).toString() === "%PDF-" || contentType.toLowerCase().includes("pdf");
    if (!looksLikePdf) {
      return res.status(502).json({
        error:
          "EMR returned HTML instead of a PDF. Procedure IDs for this order are not available yet.",
        orderId: req.params.orderId,
        procIds,
        source,
      });
    }

    res.setHeader("Content-Type", contentType.includes("pdf") ? contentType : "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="lab-${req.params.orderId}.pdf"`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/his/orders/:orderId/pdf-meta", async (req, res) => {
  try {
    const meta = await upsertOrderPdfMeta(req.params.orderId, {
      patientId: req.body?.patientId,
      procIds: req.body?.procIds,
      hisReportUrl: req.body?.hisReportUrl,
      labReportUrl: req.body?.labReportUrl,
      source: "MANUAL",
    });
    res.json({ meta });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/his/pdf-meta/parse", async (req, res) => {
  try {
    res.json(parseLabReportUrl(req.body?.url || req.body?.labReportUrl));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/reports", async (req, res) => {
  const query = {};
  if (req.query.status) query.status = String(req.query.status).toUpperCase();
  if (req.query.opIp) query.opIpType = String(req.query.opIp).toUpperCase();
  if (req.query.readiness) query.readiness = String(req.query.readiness).toUpperCase();
  if (req.query.reportDay) query.reportDay = String(req.query.reportDay);
  if (req.query.q) {
    const q = escapeRegex(String(req.query.q).trim());
    const digits = String(req.query.q).replace(/\D/g, "");
    query.$or = [
      { patientName: new RegExp(q, "i") },
      { patientId: new RegExp(q, "i") },
      { reportId: new RegExp(q, "i") },
      ...(digits ? [{ phone: new RegExp(digits) }] : []),
    ];
  }

  const reports = await Report.find(query).sort({ reportReadyAt: -1, createdAt: -1 }).limit(500);
  const reportIds = reports.map((r) => r.reportId);
  const lastAttempts = reportIds.length
    ? await MessageLog.aggregate([
        { $match: { reportId: { $in: reportIds } } },
        { $sort: { sentAt: -1 } },
        {
          $group: {
            _id: "$reportId",
            status: { $first: "$status" },
            sentTo: { $first: "$phone" },
            patientPhone: { $first: "$requestPayload.patientPhone" },
            testSend: { $first: "$requestPayload.testSend" },
            errorReason: { $first: "$errorReason" },
            sentAt: { $first: "$sentAt" },
          },
        },
      ])
    : [];
  const attemptMap = new Map(lastAttempts.map((d) => [d._id, d]));
  const settings = await getSettings();
  const flags = sendFlags(settings);
  const now = new Date();

  res.json({
    reports: reports.map((r) => {
      const attempt = attemptMap.get(r.reportId);
      const json = r.toObject();
      // When it goes out (or why not) — shown under the status badge.
      json.scheduleNote = scheduleNote(json, settings, flags, now);
      const planned = json.status === "PENDING" ? plannedSendAt(json, settings) : null;
      json.plannedSendAt = planned ? planned.toISOString() : null;
      if (attempt) {
        json.lastAttempt = {
          status: attempt.status || "",
          sentTo: attempt.sentTo || "",
          patientPhone: attempt.patientPhone || json.phone,
          testSend: Boolean(attempt.testSend),
          errorReason: attempt.errorReason || "",
          sentAt: attempt.sentAt,
        };
        if (attempt.status === "SENT") {
          json.lastDelivery = {
            sentTo: attempt.sentTo || "",
            patientPhone: attempt.patientPhone || json.phone,
            testSend: Boolean(attempt.testSend),
            sentAt: attempt.sentAt,
          };
        }
      }
      return json;
    }),
  });
});

router.get("/reports/:id", async (req, res) => {
  const report = await Report.findById(req.params.id);
  if (!report) return res.status(404).json({ error: "Not found" });
  res.json({ report });
});

router.post("/reports/poll", async (req, res) => {
  const from = req.body?.from ? parseQueryDate(req.body.from, false) : undefined;
  const to = req.body?.to ? parseQueryDate(req.body.to, true) : undefined;
  const result = await runEmrPoll({ from, to, manual: true });
  res.json(result);
});

router.post("/reports/:id/send", async (req, res) => {
  try {
    const result = await sendReportById(req.params.id, {
      triggerType: "MANUAL",
      force: req.body?.force === true,
      testContactPhones: req.body?.testContactPhones,
      sentBy: req.user?.email || "",
    });
    res.json(result);
  } catch (error) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "ALREADY_SENT" ? 409 : 400;
    res.status(status).json({ error: error.message, code: error.code || "SEND_FAILED" });
  }
});

router.post("/reports/bulk-send", async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((id) => /^[a-f0-9]{24}$/i.test(String(id)));
  if (!ids.length) return res.status(400).json({ error: "Select at least one report" });
  const result = await sendPendingReports({
    triggerType: "MANUAL",
    reportIds: ids,
    testContactPhones: req.body?.testContactPhones,
    sentBy: req.user?.email || "",
  });
  res.json(result);
});

router.post("/reports/send-all-pending", async (req, res) => {
  const settings = await getSettings();
  if (!settings.messageSendEnabled) {
    return res.status(400).json({
      error: "Message sending is disabled — enable it in Settings",
    });
  }
  if (settings.watiTestSendMode) {
    return res.status(400).json({
      error: "Test send mode: send reports one at a time from the queue and pick a contact",
    });
  }
  const result = await sendPendingReports({ triggerType: "MANUAL", sentBy: req.user?.email || "" });
  res.json(result);
});

export default router;
