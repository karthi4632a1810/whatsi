import {
  AutomationSettings,
  MessageLog,
  Patient,
  Report,
  WatiTemplate,
} from "../models/index.js";
import {
  buildLabReportUrl,
  resolveProcIds,
  fetchOrderStatusRows,
  fetchProcIdsFromLabResultHis,
  isPlausibleProcIds,
  buildOrderSnapshot,
  fetchTodayLabBoard,
} from "./emr.js";
import { canSendToPhone, sendLabReportMessage } from "./wati.js";
import { getOrderPdfMeta, upsertOrderPdfMeta } from "./orderPdfMeta.js";
import { normalizePhone } from "../utils/phone.js";
import {
  reportDayKey,
  startOfToday,
  endOfToday,
  parseQueryDate,
  recentLabDays,
} from "../utils/dates.js";
import { config } from "../config.js";
import {
  getStoredBoard,
  refreshBoardFromEmr,
  refreshOrderFromEmr,
  getHisDaySummary,
} from "./hisBoardStore.js";

export { upsertOrderPdfMeta, getOrderPdfMeta, getOrderPdfMetaMap } from "./orderPdfMeta.js";

export async function getSettings() {
  let settings = await AutomationSettings.findOne();
  if (!settings) settings = await AutomationSettings.create({});
  return settings;
}

function effectivePhone(patient, snapshotPhone) {
  return normalizePhone(patient?.phoneOverride || patient?.phone || snapshotPhone);
}

function scopeMatches(settings, opIpType) {
  if (settings.scope === "OP_ONLY") return opIpType === "OP";
  if (settings.scope === "IP_ONLY") return opIpType === "IP";
  return true;
}

function orderHasNewTests(existing, snapshot) {
  if (!existing) return false;
  const prevTotal = Number(existing.procedureTotal) || 0;
  const newTotal = Number(snapshot.procedureTotal) || 0;
  return prevTotal > 0 && newTotal > prevTotal;
}

function shouldSyncSnapshot(settings, snapshot, existing, { manual = false } = {}) {
  if (!scopeMatches(settings, snapshot.opIpType)) return false;
  if (snapshot.readiness === "WAITING") return false;

  const expanded = orderHasNewTests(existing, snapshot);
  if (expanded) return true;

  if (manual) {
    if (settings.readinessRule === "STRICT") return snapshot.readiness === "READY";
    return snapshot.readiness === "READY" || snapshot.readiness === "PARTIAL";
  }

  if (settings.readinessRule === "STRICT" && snapshot.readiness !== "READY") return false;
  return true;
}

export async function syncPatientsAndReports(snapshots, { manual = false } = {}) {
  const settings = await getSettings();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let carriedForward = 0;
  let requeued = 0;

  for (const snapshot of snapshots) {
    const day =
      snapshot.labDay ||
      reportDayKey(snapshot.reportReadyAt || snapshot.requestDate || new Date());

    const existingSameDay = await Report.findOne({
      reportId: snapshot.orderId,
      reportDay: day,
    });
    const existingLatest = await Report.findOne({ reportId: snapshot.orderId }).sort({
      updatedAt: -1,
    });
    const existing = existingSameDay || existingLatest;

    if (!shouldSyncSnapshot(settings, snapshot, existing, { manual })) {
      skipped += 1;
      continue;
    }

    const expanded = orderHasNewTests(existing, snapshot);
    if (existing?.status === "SENT" && !expanded) {
      skipped += 1;
      continue;
    }

    const patient = await Patient.findOneAndUpdate(
      { patientId: snapshot.patientId },
      {
        patientId: snapshot.patientId,
        name: snapshot.patientName,
        phone: snapshot.phone,
        opIpType: snapshot.opIpType,
        department: snapshot.department,
        lastSyncedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    if (existing && day < reportDayKey()) {
      carriedForward += 1;
    }

    let nextStatus = "PENDING";
    if (expanded || existing?.status === "SENT") {
      nextStatus = "PENDING";
      if (expanded) requeued += 1;
    } else if (existing?.status === "FAILED" || existing?.status === "PENDING") {
      nextStatus = existing.status;
    }

    let lastError = existing?.lastError || "";
    if (expanded && snapshot.readiness === "PARTIAL") {
      lastError = `New test(s) added (${snapshot.approvedCount}/${snapshot.procedureTotal} approved) — waiting for full approval`;
    } else if (expanded && snapshot.readiness === "READY") {
      lastError = "";
    }

    const payload = {
      reportId: snapshot.orderId,
      patientId: snapshot.patientId,
      patientRef: patient._id,
      patientName: snapshot.patientName,
      phone: effectivePhone(patient, snapshot.phone),
      opIpType: snapshot.opIpType,
      department: snapshot.department,
      procIds: snapshot.procIds,
      procedureNames: snapshot.procedureNames,
      procedureTotal: snapshot.procedureTotal || 0,
      approvedCount: snapshot.approvedCount || 0,
      readiness: snapshot.readiness,
      emrStatus: "RESULT APPROVED",
      hisReportUrl: snapshot.hisReportUrl,
      reportReadyAt: snapshot.reportReadyAt,
      reportDay: day,
      status: nextStatus,
      lastError,
    };

    if (expanded) {
      payload.sentAt = null;
      payload.watiMessageId = "";
    }

    if (!isPlausibleProcIds(payload.procIds)) {
      const meta = await getOrderPdfMeta(snapshot.orderId);
      if (meta && isPlausibleProcIds(meta.procIds) && !expanded) {
        payload.procIds = meta.procIds;
        payload.hisReportUrl = meta.hisReportUrl;
      } else if (expanded) {
        const freshProcIds = await fetchProcIdsFromLabResultHis(snapshot.orderId);
        if (freshProcIds.length) {
          payload.procIds = freshProcIds;
          payload.hisReportUrl = buildLabReportUrl(snapshot.orderId, freshProcIds);
          upsertOrderPdfMeta(snapshot.orderId, {
            patientId: snapshot.patientId,
            procIds: freshProcIds,
            hisReportUrl: payload.hisReportUrl,
            source: "EMR",
          }).catch(() => {});
        }
      }
    } else if (expanded && isPlausibleProcIds(payload.procIds)) {
      upsertOrderPdfMeta(snapshot.orderId, {
        patientId: snapshot.patientId,
        procIds: payload.procIds,
        hisReportUrl: payload.hisReportUrl,
        source: "SYNC",
      }).catch(() => {});
    }

    const result = await Report.findOneAndUpdate(
      { reportId: snapshot.orderId, reportDay: day },
      { $set: payload },
      { upsert: true, new: true, rawResult: true }
    );

    if (result.lastErrorObject?.updatedExisting) updated += 1;
    else created += 1;
  }

  return { created, updated, skipped, carriedForward, requeued, total: snapshots.length };
}

export function boardOrderToSnapshot(order, labDay) {
  const procIds = order.procIds || [];
  return {
    orderId: String(order.orderId),
    patientId: order.patientId || "",
    patientName: order.patientName || "",
    phone: order.phone || "",
    opIpType: order.opIpType || "UNKNOWN",
    department: order.department || "",
    readiness: order.readiness,
    procIds,
    procedureNames: (order.procedures || []).map((p) => p.name).filter(Boolean),
    procedureTotal: order.procedureTotal || 0,
    approvedCount: order.approvedCount || 0,
    reportReadyAt: order.completedAt || order.requestDate || new Date(),
    hisReportUrl: procIds.length ? buildLabReportUrl(order.orderId, procIds) : "",
    labDay,
  };
}

/** Sync using the HIS lab board — reads MongoDB store when available. */
export async function syncLabBoardToQueue({ from, to, manual = false, useStore = true } = {}) {
  const settings = await getSettings();
  const rangeFrom = from || startOfToday();
  const rangeTo = to || endOfToday();
  const labDay = reportDayKey(rangeFrom);

  let board = [];
  if (useStore) {
    board = await getStoredBoard(labDay, "all");
  }
  if (!board.length) {
    await refreshBoardFromEmr(labDay, { mode: "full" });
    board = await getStoredBoard(labDay, "all");
  }
  if (!board.length) {
    board = await fetchTodayLabBoard({ from: rangeFrom, to: rangeTo, filter: "all" });
  }
  const candidates = board.filter((order) => {
    if (order.readiness === "WAITING") return false;
    if (settings.readinessRule === "STRICT") return order.readiness === "READY";
    return order.readiness === "READY" || order.readiness === "PARTIAL";
  });

  const snapshots = candidates.map((order) => boardOrderToSnapshot(order, labDay));
  const sync = await syncPatientsAndReports(snapshots, { manual });
  return {
    ...sync,
    labDay,
    boardTotal: board.length,
    candidates: candidates.length,
  };
}

export async function syncOrderToQueue(orderId, { from, to, reportDay } = {}) {
  const settings = await getSettings();
  const rangeFrom = from ? parseQueryDate(from, false) : startOfToday();
  const rangeTo = to ? parseQueryDate(to, true) : endOfToday();
  const id = String(orderId || "").trim();
  if (!id) throw new Error("Order ID is required");

  const rows = await fetchOrderStatusRows(id, rangeFrom, rangeTo);
  const approvedRows = rows.filter((row) => row.status === "RESULT APPROVED");
  if (!approvedRows.length) {
    throw new Error("No approved lab results for this order in the selected date range");
  }

  const snapshot = await buildOrderSnapshot(id, approvedRows, settings.readinessRule);
  if (snapshot.readiness === "WAITING") {
    throw new Error("Order is not ready — no approved results yet");
  }
  snapshot.labDay = reportDay || reportDayKey(rangeFrom);

  const sync = await syncPatientsAndReports([snapshot], { manual: true });
  const day = snapshot.labDay;
  await refreshOrderFromEmr(day, id).catch(() => {});
  const report = await Report.findOne({ reportId: id, reportDay: day }).sort({ updatedAt: -1 });

  if (sync.skipped && !report) {
    throw new Error("Order could not be queued — check OP/IP scope in Settings or readiness");
  }

  return {
    orderId: id,
    reportDay: day,
    report,
    sync,
  };
}

export async function runEmrPoll({ from, to, autoSend = false, manual = false } = {}) {
  const settings = await getSettings();
  const rangeFrom = from || startOfToday();
  const rangeTo = to || endOfToday();
  const labDay = reportDayKey(rangeFrom);

  const boardRefresh = await refreshBoardFromEmr(labDay, {
    mode: manual ? "full" : "incremental",
  });
  const sync = await syncLabBoardToQueue({
    from: rangeFrom,
    to: rangeTo,
    manual,
    useStore: true,
  });

  if (
    autoSend &&
    settings.messageSendEnabled &&
    settings.mode === "IMMEDIATE" &&
    !settings.watiTestSendMode
  ) {
    const sendResult = await sendPendingReports({ triggerType: "AUTO_IMMEDIATE" });
    return { ...sync, boardRefresh, sendResult };
  }

  return { ...sync, boardRefresh };
}

/**
 * Catch late completions for recent past days.
 * Example: order dated 15 Jul that becomes READY on 17 Jul gets board-updated + queued.
 * Does not send — EOD / Immediate schedule still controls WhatsApp.
 */
export async function runBacklogCatchUp({
  lookbackDays = config.emr.backlogLookbackDays,
} = {}) {
  const days = recentLabDays(lookbackDays, { includeToday: false });
  const results = [];

  for (const labDay of days) {
    try {
      const from = parseQueryDate(labDay, false);
      const to = parseQueryDate(labDay, true);
      const boardRefresh = await refreshBoardFromEmr(labDay, { mode: "incremental" });
      // Skip queue sync if this day never had a full board yet (chunked refresh just started)
      if (boardRefresh?.mode === "chunked-started") {
        results.push({ labDay, boardRefresh, skipped: true, reason: "full refresh started" });
        continue;
      }
      const sync = await syncLabBoardToQueue({
        from,
        to,
        manual: false,
        useStore: true,
      });
      results.push({
        labDay,
        boardRefresh,
        created: sync.created ?? 0,
        updated: sync.updated ?? 0,
        skipped: sync.skipped ?? 0,
        candidates: sync.candidates ?? 0,
      });
    } catch (error) {
      results.push({ labDay, error: error.message });
    }
  }

  return {
    lookbackDays,
    days,
    results,
    created: results.reduce((n, r) => n + (r.created || 0), 0),
    updated: results.reduce((n, r) => n + (r.updated || 0), 0),
  };
}

export async function resolveOrderPdfUrl(orderId, { procIds: hintProcIds = [] } = {}) {
  const id = String(orderId);
  const hintIds = (Array.isArray(hintProcIds) ? hintProcIds : [])
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);

  const meta = await getOrderPdfMeta(id);
  if (meta?.hisReportUrl && isPlausibleProcIds(meta.procIds)) {
    return {
      orderId: id,
      procIds: meta.procIds,
      pdfUrl: meta.hisReportUrl,
      proxyUrl: `/api/his/pdf/${id}`,
      source: "order-meta",
    };
  }

  const report = await Report.findOne({ reportId: id }).sort({ updatedAt: -1 });
  if (report?.hisReportUrl && isPlausibleProcIds(report.procIds)) {
    return {
      orderId: id,
      procIds: report.procIds || hintIds,
      pdfUrl: report.hisReportUrl,
      proxyUrl: `/api/his/pdf/${id}`,
      source: "mongodb",
    };
  }
  if (report?.procIds?.length && isPlausibleProcIds(report.procIds)) {
    const pdfUrl = buildLabReportUrl(id, report.procIds);
    return { orderId: id, procIds: report.procIds, pdfUrl, proxyUrl: `/api/his/pdf/${id}`, source: "mongodb" };
  }
  if (hintIds.length) {
    const pdfUrl = buildLabReportUrl(id, hintIds);
    return { orderId: id, procIds: hintIds, pdfUrl, proxyUrl: `/api/his/pdf/${id}`, source: "hint" };
  }

  const fromLabResultHis = await fetchProcIdsFromLabResultHis(id);
  if (fromLabResultHis.length) {
    const pdfUrl = buildLabReportUrl(id, fromLabResultHis);
    upsertOrderPdfMeta(id, { procIds: fromLabResultHis, hisReportUrl: pdfUrl, source: "EMR" }).catch(
      () => {}
    );
    return {
      orderId: id,
      procIds: fromLabResultHis,
      pdfUrl,
      proxyUrl: `/api/his/pdf/${id}`,
      source: "lab-result-his",
    };
  }

  const from = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
  const to = new Date();
  const orderRows = await fetchOrderStatusRows(id, from, to);
  const approvedRows = orderRows.filter((row) => row.status === "RESULT APPROVED" || row.procId);
  const procIds = await resolveProcIds(id, approvedRows);
  if (!procIds.length) {
    return { orderId: id, procIds: [], pdfUrl: "", proxyUrl: "", source: "none" };
  }
  const pdfUrl = buildLabReportUrl(id, procIds);
  upsertOrderPdfMeta(id, { procIds, hisReportUrl: pdfUrl, source: "EMR" }).catch(() => {});
  return {
    orderId: id,
    procIds,
    pdfUrl,
    proxyUrl: `/api/his/pdf/${id}`,
    source: "emr",
  };
}

export async function sendReportById(
  reportId,
  { triggerType = "MANUAL", force = false, testContactPhones = null } = {}
) {
  const report = await Report.findById(reportId).populate("patientRef");
  if (!report) throw new Error("Report not found");

  if (!force && report.readiness === "WAITING") {
    throw new Error("Report is not ready (no approved procedures)");
  }
  if (!force && report.readiness === "PARTIAL") {
    const settings = await getSettings();
    if (settings.readinessRule === "STRICT") {
      throw new Error("Report is partial — not all procedures approved");
    }
  }

  // Same resolution path as PDF preview — queue rows often lack hisReportUrl until first resolve
  if (!report.hisReportUrl || !isPlausibleProcIds(report.procIds)) {
    const resolved = await resolveOrderPdfUrl(report.reportId, {
      procIds: report.procIds || [],
    });
    if (!resolved.pdfUrl) {
      throw new Error(
        "Missing PDF URL — procedure IDs not resolved from EMR yet. Open Preview once, or try again shortly."
      );
    }
    report.hisReportUrl = resolved.pdfUrl;
    if (resolved.procIds?.length) {
      report.procIds = resolved.procIds;
    }
    await report.save();
    await upsertOrderPdfMeta(report.reportId, {
      patientId: report.patientId,
      procIds: report.procIds,
      hisReportUrl: report.hisReportUrl,
      source: resolved.source || "SEND",
    }).catch(() => {});
  }

  const settings = await getSettings();
  const useTestSend = Boolean(settings.watiTestSendMode);
  if (triggerType !== "MANUAL") {
    if (!settings.messageSendEnabled) {
      throw new Error("Message sending is disabled — enable it in Settings");
    }
    if (useTestSend) {
      throw new Error("Test send mode: automatic sends are disabled — use Test send on each report");
    }
  } else if (!useTestSend && !settings.messageSendEnabled) {
    throw new Error("Message sending is disabled — enable it in Settings");
  }

  const defaultTpl = await WatiTemplate.findOne({ isDefault: true, status: "ACTIVE" });
  const templateName = defaultTpl?.name || settings.watiTemplateName;

  const testPhones = (settings.watiTestContactPhones || []).map(normalizePhone).filter(Boolean);
  const overridePhones = Array.isArray(testContactPhones)
    ? testContactPhones.map(normalizePhone).filter(Boolean)
    : [];

  let deliveryPhones;
  if (useTestSend) {
    if (!overridePhones.length) {
      throw new Error("Select a WATI contact for test send");
    }
    deliveryPhones = overridePhones;
    if (!testPhones.length) {
      throw new Error("Test send mode: select WATI contacts in Settings");
    }
    for (const phone of deliveryPhones) {
      if (!testPhones.includes(phone)) {
        throw new Error(`Contact ${phone} is not in the test allowlist`);
      }
    }
  } else {
    deliveryPhones = [effectivePhone(report.patientRef, report.phone)];
  }
  if (!useTestSend && !deliveryPhones[0]) {
    throw new Error("Patient phone missing");
  }
  if (!useTestSend && !canSendToPhone(deliveryPhones[0])) {
    if (!config.wati.sendEnabled) {
      throw new Error("Send blocked: set WATI_SEND_ENABLED=true in server .env and restart the API");
    }
    if (config.wati.testMode) {
      throw new Error(
        `Send blocked: WATI test mode only allows ${config.wati.testPhoneOnly} (patient is ${deliveryPhones[0]}). ` +
          "Use Settings → Test send mode to send to a WATI contact, or set WATI_TEST_MODE=false for live delivery."
      );
    }
    throw new Error("Send blocked by WATI safety settings");
  }

  report.status = "QUEUED";
  report.triggerType = triggerType;
  if (!useTestSend) {
    report.attempts += 1;
  }
  await report.save();

  const testAllowlist = useTestSend ? testPhones : null;
  let lastResponse = null;
  const sentPhones = [];

  try {
    for (const phone of deliveryPhones) {
      if (!canSendToPhone(phone, { testSendMode: useTestSend, allowedTestPhones: testPhones })) {
        throw new Error(`Send blocked for ${phone}`);
      }
      lastResponse = await sendLabReportMessage({
        phone,
        patientName: report.patientName,
        attachmentUrl: report.hisReportUrl,
        templateName,
        testSendAllowlist: testAllowlist,
      });
      sentPhones.push(phone);
    }

    if (useTestSend) {
      report.status = "PENDING";
      report.lastError = "";
    } else {
      report.status = "SENT";
      report.sentAt = new Date();
      report.watiMessageId = lastResponse?.local_message_id || "";
      report.lastError = "";
    }
    await report.save();

    for (const phone of sentPhones) {
      await MessageLog.create({
        reportRef: report._id,
        reportId: report.reportId,
        patientId: report.patientId,
        patientName: report.patientName,
        phone,
        watiMessageId: report.watiMessageId,
        templateName,
        reportDay: report.reportDay,
        status: "SENT",
        requestPayload: {
          template: templateName,
          phone,
          patientPhone: report.phone,
          testSend: useTestSend,
          attachmentUrl: report.hisReportUrl,
        },
        responsePayload: lastResponse,
        sentAt: new Date(),
      });
    }

    return { report, response: lastResponse, sentPhones, testSend: useTestSend };
  } catch (error) {
    if (useTestSend) {
      report.status = "PENDING";
    } else {
      report.status = "FAILED";
    }
    report.lastError = error.message;
    await report.save();

    await MessageLog.create({
      reportRef: report._id,
      reportId: report.reportId,
      patientId: report.patientId,
      patientName: report.patientName,
      phone: sentPhones[0] || deliveryPhones[0] || report.phone,
      templateName,
      reportDay: report.reportDay,
      status: "FAILED",
      errorReason: error.message,
      requestPayload: {
        template: templateName,
        phone: sentPhones[0] || deliveryPhones[0] || report.phone,
        patientPhone: report.phone,
        testSend: useTestSend,
        attachmentUrl: report.hisReportUrl,
      },
      sentAt: new Date(),
    });

    throw error;
  }
}

export async function sendPendingReports({
  triggerType = "AUTO_EOD",
  reportIds = null,
  testContactPhones = null,
  statuses = null,
} = {}) {
  const statusList = Array.isArray(statuses) && statuses.length
    ? statuses
    : ["PENDING", "FAILED"];
  const query = { status: { $in: statusList } };
  if (reportIds?.length) query._id = { $in: reportIds };

  const reports = await Report.find(query).sort({ reportReadyAt: 1 });
  const settings = await getSettings();
  const maxAttempts = settings.retryPolicy?.maxAttempts ?? 3;

  if (triggerType !== "MANUAL") {
    if (!settings.messageSendEnabled) {
      return {
        sent: 0,
        failed: 0,
        skipped: reports.length,
        errors: [],
        blocked: true,
        reason: "Message sending is disabled — enable it in Settings",
      };
    }

    if (settings.watiTestSendMode) {
      return {
        sent: 0,
        failed: 0,
        skipped: reports.length,
        errors: [],
        blocked: true,
        reason: "Test send mode: automatic sends are disabled",
      };
    }
  }

  const results = { sent: 0, failed: 0, skipped: 0, errors: [] };

  for (const report of reports) {
    if (report.attempts >= maxAttempts && report.status === "FAILED") {
      results.skipped += 1;
      continue;
    }
    try {
      await sendReportById(report._id, { triggerType, testContactPhones });
      results.sent += 1;
    } catch (error) {
      results.failed += 1;
      results.errors.push({ reportId: report.reportId, error: error.message });
    }
  }

  return results;
}

export async function aggregateQueueStats(match = {}) {
  const pipeline = [];
  if (Object.keys(match).length) pipeline.push({ $match: match });
  pipeline.push({
    $group: {
      _id: null,
      total: { $sum: 1 },
      ready: { $sum: { $cond: [{ $eq: ["$readiness", "READY"] }, 1, 0] } },
      partial: { $sum: { $cond: [{ $eq: ["$readiness", "PARTIAL"] }, 1, 0] } },
      pending: {
        $sum: { $cond: [{ $in: ["$status", ["PENDING", "QUEUED"]] }, 1, 0] },
      },
      sent: { $sum: { $cond: [{ $eq: ["$status", "SENT"] }, 1, 0] } },
      failed: { $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] } },
    },
  });

  const [result] = await Report.aggregate(pipeline);
  return result
    ? {
        total: result.total,
        ready: result.ready,
        partial: result.partial,
        pending: result.pending,
        sent: result.sent,
        failed: result.failed,
      }
    : { total: 0, ready: 0, partial: 0, pending: 0, sent: 0, failed: 0 };
}

export async function getHisDayStats(date) {
  const day = date || reportDayKey();
  const stored = await getHisDaySummary(day);
  if (stored) {
    return {
      date: day,
      total: stored.total,
      ready: stored.ready,
      partial: stored.partial,
      approved: stored.approved,
      inProcess: stored.inProcess,
      source: "mongodb",
      lastSyncAt: stored.lastSyncAt,
    };
  }

  const from = parseQueryDate(day, false);
  const to = parseQueryDate(day, true);
  const board = await fetchTodayLabBoard({ from, to, filter: "all" });
  return {
    date: day,
    total: board.length,
    ready: board.filter((o) => o.readiness === "READY").length,
    partial: board.filter((o) => o.readiness === "PARTIAL").length,
    approved: board.filter((o) => o.hisStatus === "RESULT APPROVED").length,
    inProcess: board.filter((o) => o.hisStatus === "IN PROCESS").length,
    source: "emr",
  };
}

export async function getDashboardStats({ scope = "today", date } = {}) {
  const today = reportDayKey();
  const targetDay =
    date && parseQueryDate(date, false) ? reportDayKey(parseQueryDate(date, false)) : today;

  const [queueOverall, queueDay, byDayRows, messagesFailed, testSentOverall, testSentDay, testByDayRows] = await Promise.all([
    aggregateQueueStats({}),
    aggregateQueueStats({ reportDay: targetDay }),
    Report.aggregate([
      { $match: { reportDay: { $exists: true, $nin: [null, ""] } } },
      {
        $group: {
          _id: "$reportDay",
          total: { $sum: 1 },
          ready: { $sum: { $cond: [{ $eq: ["$readiness", "READY"] }, 1, 0] } },
          partial: { $sum: { $cond: [{ $eq: ["$readiness", "PARTIAL"] }, 1, 0] } },
          pending: {
            $sum: { $cond: [{ $in: ["$status", ["PENDING", "QUEUED"]] }, 1, 0] },
          },
          sent: { $sum: { $cond: [{ $eq: ["$status", "SENT"] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] } },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: 21 },
    ]),
    MessageLog.countDocuments({ status: "FAILED" }),
    MessageLog.countDocuments({ status: "SENT", "requestPayload.testSend": true }),
    MessageLog.countDocuments({
      status: "SENT",
      "requestPayload.testSend": true,
      reportDay: targetDay,
    }),
    MessageLog.aggregate([
      {
        $match: {
          status: "SENT",
          "requestPayload.testSend": true,
          reportDay: { $exists: true, $nin: [null, ""] },
        },
      },
      { $group: { _id: "$reportDay", testSent: { $sum: 1 } } },
      { $sort: { _id: -1 } },
      { $limit: 21 },
    ]),
  ]);

  const settings = await getSettings();
  const queueOverallWithTest = { ...queueOverall, testSent: testSentOverall };
  const queueDayWithTest = { ...queueDay, testSent: testSentDay };
  const queue = scope === "overall" ? queueOverallWithTest : queueDayWithTest;
  const testByDay = new Map(testByDayRows.map((row) => [row._id, row.testSent || 0]));

  return {
    scope,
    date: scope === "overall" ? null : targetDay,
    today,
    his: null,
    queue,
    queueOverall: queueOverallWithTest,
    queueDay: queueDayWithTest,
    byDay: byDayRows.map((row) => ({
      date: row._id,
      total: row.total,
      ready: row.ready,
      partial: row.partial,
      pending: row.pending,
      sent: row.sent,
      testSent: testByDay.get(row._id) || 0,
      failed: row.failed,
    })),
    pending: queueDay.pending,
    queued: queueOverall.pending,
    sentToday: queueDay.sent,
    failed: queueOverall.failed,
    messagesFailed,
    automationEnabled: settings.automationEnabled,
    messageSendEnabled: settings.messageSendEnabled,
    mode: settings.mode,
    endOfDayTime: settings.endOfDayTime,
    watiSendEnabled: config.wati.sendEnabled,
    watiTestMode: config.wati.testMode,
    watiTestSendMode: settings.watiTestSendMode,
    watiTestContactPhones: settings.watiTestContactPhones || [],
  };
}
