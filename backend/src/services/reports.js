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
  isEmrReportUrl,
  DELIVERY_OP_IP_TYPE,
} from "./emr.js";
import { canSendToPhone, sendLabReportMessage } from "./wati.js";
import { reportLinkFor } from "./reportLinks.js";
import {
  autoSendDecision,
  classifyFailure,
  effectiveMode,
  isQuietTime,
  maxAgeHours,
  nextRetryTime,
  parseClock,
} from "../utils/schedule.js";
import { isExcludedPatientType } from "../utils/emrParse.js";
import { getOrderPdfMeta, upsertOrderPdfMeta } from "./orderPdfMeta.js";
import { normalizePhone } from "../utils/phone.js";
import {
  partsInIst,
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

/**
 * One-time move of settings saved by older versions (no schemaVersion) to the
 * OP-only, "N hours after approval" model. Runs once; later choices are kept.
 */
export async function migrateSettings() {
  const raw = await AutomationSettings.collection.findOne({});
  if (!raw || raw.schemaVersion >= 2) return getSettings();
  const set = { schemaVersion: 2, scope: "OP_ONLY" };
  if (raw.mode === "IMMEDIATE") {
    Object.assign(set, { mode: "AFTER_READY", sendDelayHours: 0 });
  } else {
    // The old 6 PM daily batch becomes "3 hours after approval".
    Object.assign(set, { mode: "AFTER_READY", sendDelayHours: raw.sendDelayHours ?? 3 });
  }
  await AutomationSettings.collection.updateOne({ _id: raw._id }, { $set: set });
  console.log("[startup] settings moved to OP-only, send", set.sendDelayHours, "h after approval");
  return getSettings();
}

function effectivePhone(patient, snapshotPhone) {
  return normalizePhone(patient?.phoneOverride || patient?.phone || snapshotPhone);
}

// whatsi delivers OP reports only; IP discharges go through the investigation-chart portal.
function scopeMatches(_settings, opIpType) {
  return opIpType === DELIVERY_OP_IP_TYPE;
}

function orderHasNewTests(existing, snapshot) {
  if (!existing) return false;
  const prevTotal = Number(existing.procedureTotal) || 0;
  const newTotal = Number(snapshot.procedureTotal) || 0;
  return prevTotal > 0 && newTotal > prevTotal;
}

function shouldSyncSnapshot(settings, snapshot, existing, { manual = false } = {}) {
  if (isExcludedPatientType(snapshot.patientType)) return false;
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
        patientType: snapshot.patientType || "",
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
    // Never touch a report that is being sent right now or waits for a manual check.
    const keepStatus = existing?.status === "QUEUED" || existing?.status === "NEEDS_REVIEW";
    const phone = effectivePhone(patient, snapshot.phone);
    // A report that failed only for lack of a phone number goes back in the queue once there is one.
    const phoneArrived = existing?.status === "FAILED" && existing.failureKind === "NO_PHONE" && phone;
    if (phoneArrived) nextStatus = "PENDING";

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
      phone,
      opIpType: snapshot.opIpType,
      patientType: snapshot.patientType || "",
      department: snapshot.department,
      procIds: snapshot.procIds,
      procedureNames: snapshot.procedureNames,
      procedureTotal: snapshot.procedureTotal || 0,
      approvedCount: snapshot.approvedCount || 0,
      readiness: snapshot.readiness,
      emrStatus: "RESULT APPROVED",
      hisReportUrl: snapshot.hisReportUrl,
      reportReadyAt: snapshot.reportReadyAt || existing?.reportReadyAt || null,
      reportDay: day,
      lastError,
    };
    if (!keepStatus) payload.status = nextStatus;

    // Fallback clock for the send delay when the EMR gives no completion time.
    if (snapshot.readiness === "READY") {
      payload.readySeenAt =
        existing?.readySeenAt && existing.readiness === "READY" ? existing.readySeenAt : new Date();
    }

    if (expanded || phoneArrived) {
      Object.assign(payload, {
        failureKind: "",
        retryable: false,
        nextRetryAt: null,
        attempts: 0,
      });
    }
    if (expanded) {
      Object.assign(payload, {
        sentAt: null,
        watiMessageId: "",
        deliveryStatus: "",
        deliveredAt: null,
        readAt: null,
      });
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
      { upsert: true, new: true, includeResultMetadata: true }
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
    patientType: order.patientType || "",
    department: order.department || "",
    readiness: order.readiness,
    procIds,
    procedureNames: (order.procedures || []).map((p) => p.name).filter(Boolean),
    procedureTotal: order.procedureTotal || 0,
    approvedCount: order.approvedCount || 0,
    reportReadyAt: order.completedAt || null,
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
  const held = await holdReportsNoLongerReady(board, labDay);
  return {
    ...sync,
    held,
    labDay,
    boardTotal: board.length,
    candidates: candidates.length,
  };
}

/**
 * A queued (not yet sent) report whose order went back from READY — a result
 * amended or a test added — must not go out until the board says READY again.
 */
async function holdReportsNoLongerReady(board, labDay) {
  const byId = new Map(board.map((order) => [String(order.orderId), order]));
  const waiting = await Report.find({
    reportDay: labDay,
    status: { $in: ["PENDING", "FAILED"] },
    readiness: "READY",
  }).select("reportId");
  let held = 0;
  for (const report of waiting) {
    const order = byId.get(String(report.reportId));
    if (!order || order.readiness === "READY") continue;
    await Report.updateOne(
      { _id: report._id, status: { $in: ["PENDING", "FAILED"] } },
      {
        $set: {
          readiness: order.readiness,
          procedureTotal: order.procedureTotal || 0,
          approvedCount: order.approvedCount || 0,
          lastError: `Results changed in HIS (${order.approvedCount || 0}/${order.procedureTotal || 0} approved) — waiting for full approval`,
        },
      }
    );
    held += 1;
  }
  return held;
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
  if (snapshot.opIpType !== DELIVERY_OP_IP_TYPE) {
    throw new Error("This is not an OP order — whatsi sends OP lab reports only (IP reports go through the investigation-chart portal)");
  }
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

export async function runEmrPoll({ from, to, manual = false } = {}) {
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
  // Sending is not done here: the send worker (jobs/scheduler.js) picks up
  // each report when its delay has passed.
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

class SendBlockedError extends Error {
  constructor(message, code = "BLOCKED") {
    super(message);
    this.code = code;
    this.blocked = true;
  }
}

const STALE_QUEUED_MS = 15 * 60 * 1000;

/**
 * Sends one queued OP report on WhatsApp.
 *
 * Checks that only depend on settings or the report (sending switched off,
 * not OP, not ready, no phone, test-mode allowlist) throw SendBlockedError and
 * change nothing. Otherwise the report is claimed atomically (PENDING/FAILED →
 * QUEUED) so two workers, or a worker and a staff click, can never send it twice.
 */
export async function sendReportById(
  reportId,
  { triggerType = "MANUAL", force = false, testContactPhones = null, sentBy = "" } = {}
) {
  const settings = await getSettings();
  const automatic = triggerType !== "MANUAL";
  const useTestSend = Boolean(settings.watiTestSendMode);

  if (automatic && useTestSend) {
    throw new SendBlockedError("Test send mode: automatic sends are paused");
  }
  if (!settings.messageSendEnabled && !(useTestSend && !automatic)) {
    throw new SendBlockedError("WhatsApp sending is switched off — turn it on in Settings");
  }
  if (!config.wati.sendEnabled) {
    throw new SendBlockedError("Send blocked: set WATI_SEND_ENABLED=true in the server .env and restart the API");
  }

  const report = await Report.findById(reportId).populate("patientRef");
  if (!report) throw new SendBlockedError("Report not found", "NOT_FOUND");
  if (report.opIpType !== DELIVERY_OP_IP_TYPE) {
    throw new SendBlockedError("whatsi sends OP lab reports only");
  }
  if (isExcludedPatientType(report.patientType)) {
    throw new SendBlockedError("Send blocked: patient type ZPATIENT is excluded from WhatsApp delivery");
  }
  if (!force && report.readiness === "WAITING") {
    throw new SendBlockedError("Report is not ready (no approved results)");
  }
  if (!force && report.readiness === "PARTIAL" && settings.readinessRule === "STRICT") {
    throw new SendBlockedError("Report is partial — not all tests are approved yet");
  }
  if (!force && ["SENT", "NEEDS_REVIEW"].includes(report.status)) {
    throw new SendBlockedError(
      report.status === "SENT" ? "Already sent — use Resend to send it again" : "Check WhatsApp Monitor, then use Resend",
      "ALREADY_SENT"
    );
  }

  const testPhones = (settings.watiTestContactPhones || []).map(normalizePhone).filter(Boolean);
  let deliveryPhones;
  if (useTestSend) {
    const overridePhones = (Array.isArray(testContactPhones) ? testContactPhones : [])
      .map(normalizePhone)
      .filter(Boolean);
    if (!testPhones.length) throw new SendBlockedError("Test send mode: add test numbers in Settings");
    if (!overridePhones.length) throw new SendBlockedError("Pick a test number for this test send");
    const notAllowed = overridePhones.find((phone) => !testPhones.includes(phone));
    if (notAllowed) throw new SendBlockedError(`${notAllowed} is not in the test number list`);
    deliveryPhones = overridePhones;
  } else {
    const phone = effectivePhone(report.patientRef, report.phone);
    if (!phone) throw new SendBlockedError("Patient phone missing — add a number in Contacts", "NO_PHONE");
    if (!canSendToPhone(phone)) {
      throw new SendBlockedError(
        config.wati.testMode
          ? `Send blocked: the server is in WATI test mode (WATI_TEST_MODE) and only allows ${config.wati.testPhoneOnly}`
          : "Send blocked by WATI safety settings"
      );
    }
    deliveryPhones = [phone];
  }

  // Claim: only one sender wins. A forced resend may also take SENT / NEEDS_REVIEW rows.
  const claimable = force ? ["PENDING", "FAILED", "SENT", "NEEDS_REVIEW"] : ["PENDING", "FAILED"];
  const claimed = await Report.findOneAndUpdate(
    { _id: report._id, status: { $in: claimable } },
    { $set: { status: "QUEUED", queuedAt: new Date(), triggerType } },
    { new: true }
  ).populate("patientRef");
  if (!claimed) {
    throw new SendBlockedError("This report is already being sent or was just sent", "ALREADY_SENT");
  }

  const defaultTpl = await WatiTemplate.findOne({ isDefault: true, status: "ACTIVE" });
  const templateName = defaultTpl?.name || settings.watiTemplateName;
  const now = new Date();
  const sentPhones = [];
  let lastResponse = null;

  try {
    // Same resolution path as the PDF preview — queue rows often lack the URL until first resolve.
    if (!claimed.hisReportUrl || !isPlausibleProcIds(claimed.procIds) || !isEmrReportUrl(claimed.hisReportUrl)) {
      const resolved = await resolveOrderPdfUrl(claimed.reportId, { procIds: claimed.procIds || [] });
      if (!resolved.pdfUrl) {
        throw new Error("Missing PDF URL — procedure IDs not resolved from EMR yet. Try again shortly.");
      }
      claimed.hisReportUrl = resolved.pdfUrl;
      if (resolved.procIds?.length) claimed.procIds = resolved.procIds;
      await upsertOrderPdfMeta(claimed.reportId, {
        patientId: claimed.patientId,
        procIds: claimed.procIds,
        hisReportUrl: claimed.hisReportUrl,
        source: resolved.source || "SEND",
      }).catch(() => {});
    }

    // A private expiring whatsi link when PUBLIC_BASE_URL is set, else the EMR URL.
    const attachmentUrl = reportLinkFor(claimed) || claimed.hisReportUrl;
    for (const phone of deliveryPhones) {
      lastResponse = await sendLabReportMessage({
        phone,
        patientName: claimed.patientName,
        attachmentUrl,
        templateName,
        testSendAllowlist: useTestSend ? testPhones : null,
      });
      sentPhones.push(phone);
      await MessageLog.create({
        reportRef: claimed._id,
        reportId: claimed.reportId,
        patientId: claimed.patientId,
        patientName: claimed.patientName,
        phone,
        watiLocalMessageId: lastResponse?.local_message_id || "",
        templateName,
        reportDay: claimed.reportDay,
        status: "SENT",
        triggerType,
        sentBy,
        testSend: useTestSend,
        requestPayload: {
          template: templateName,
          phone,
          patientPhone: claimed.phone,
          testSend: useTestSend,
          attachmentUrl,
          emrReportUrl: claimed.hisReportUrl,
        },
        responsePayload: lastResponse,
        sentAt: new Date(),
        nextCheckAt: new Date(Date.now() + 30 * 60 * 1000),
      });
    }

    if (useTestSend) {
      // A test send never counts as delivery to the patient — back to how it was.
      claimed.status = report.status;
    } else {
      Object.assign(claimed, {
        status: "SENT",
        sentAt: now,
        watiMessageId: lastResponse?.local_message_id || "",
        deliveryStatus: "sent",
        deliveredAt: null,
        readAt: null,
        lastError: "",
        failureKind: "",
        retryable: false,
        nextRetryAt: null,
        sentBy,
      });
      claimed.attempts += 1;
    }
    claimed.lastAttemptAt = now;
    await claimed.save();

    return { report: claimed, response: lastResponse, sentPhones, testSend: useTestSend };
  } catch (error) {
    const maxAttempts = settings.retryPolicy?.maxAttempts ?? 3;
    const { kind, retryable } = classifyFailure(error.message);
    claimed.lastError = error.message;
    claimed.lastAttemptAt = now;
    if (useTestSend) {
      claimed.status = report.status;
    } else if (error.outcomeUnknown) {
      // WATI may have sent it — a person checks before anything is resent.
      claimed.status = "NEEDS_REVIEW";
      claimed.attempts += 1;
    } else {
      claimed.attempts += 1;
      const canRetry = retryable && claimed.attempts < maxAttempts;
      Object.assign(claimed, {
        status: "FAILED",
        failureKind: kind,
        retryable: canRetry,
        nextRetryAt: canRetry ? nextRetryTime(claimed.attempts, settings, now) : null,
      });
    }
    await claimed.save();

    await MessageLog.create({
      reportRef: claimed._id,
      reportId: claimed.reportId,
      patientId: claimed.patientId,
      patientName: claimed.patientName,
      phone: deliveryPhones[sentPhones.length] || deliveryPhones[0] || claimed.phone,
      templateName,
      reportDay: claimed.reportDay,
      status: "FAILED",
      errorReason: error.message,
      triggerType,
      sentBy,
      testSend: useTestSend,
      failedAt: now,
      requestPayload: {
        template: templateName,
        phone: deliveryPhones[sentPhones.length] || deliveryPhones[0] || claimed.phone,
        patientPhone: claimed.phone,
        testSend: useTestSend,
        attachmentUrl: claimed.hisReportUrl,
      },
      sentAt: now,
    });

    throw error;
  }
}

// One batch at a time — the scheduler, "Send all" and bulk sends share this lock.
let batchRunning = null;

async function runExclusive(job) {
  if (batchRunning) {
    return { sent: 0, failed: 0, skipped: 0, errors: [], busy: true, reason: "Another send batch is running" };
  }
  batchRunning = job().finally(() => {
    batchRunning = null;
  });
  return batchRunning;
}

async function sendEach(reports, options) {
  const results = { sent: 0, failed: 0, skipped: 0, errors: [] };
  for (const report of reports) {
    try {
      await sendReportById(report._id, options);
      results.sent += 1;
    } catch (error) {
      if (error.blocked) results.skipped += 1;
      else results.failed += 1;
      results.errors.push({ reportId: report.reportId, error: error.message });
    }
  }
  return results;
}

/** Staff "Send selected" / "Send all due" — and the once-a-day run. */
export async function sendPendingReports({
  triggerType = "MANUAL",
  reportIds = null,
  testContactPhones = null,
  statuses = null,
  sentBy = "",
} = {}) {
  return runExclusive(async () => {
    const statusList = Array.isArray(statuses) && statuses.length ? statuses : ["PENDING", "FAILED"];
    const query = { status: { $in: statusList }, opIpType: DELIVERY_OP_IP_TYPE, phone: { $nin: ["", null] } };
    if (reportIds?.length) query._id = { $in: reportIds };
    const settings = await getSettings();
    const maxAttempts = settings.retryPolicy?.maxAttempts ?? 3;
    const reports = (await Report.find(query).sort({ reportReadyAt: 1 })).filter((report) => {
      if (report.status !== "FAILED") return true;
      // Staff picking rows by hand may retry anything; batch runs skip permanent failures.
      return Boolean(reportIds?.length) || (report.retryable && report.attempts < maxAttempts);
    });
    return sendEach(reports, { triggerType, testContactPhones, sentBy });
  });
}

/**
 * The send worker, every minute: OP reports whose delay since approval has
 * passed (outside quiet hours, within the age limit), plus temporary failures
 * whose retry time has come. In END_OF_DAY mode, everything due once a day.
 */
export async function dispatchDueReports({ now = new Date() } = {}) {
  const settings = await getSettings();
  // "Message sending enabled" alone controls scheduled sends; "Automation" only
  // syncs HIS into the queue (same meaning as the Settings screen).
  if (!settings.messageSendEnabled) return { skipped: "sending off" };
  if (settings.watiTestSendMode) return { skipped: "test send mode" };
  if (!config.wati.sendEnabled) return { skipped: "WATI_SEND_ENABLED is false" };
  if (config.wati.testMode) return { skipped: "server WATI test mode" };
  if (isQuietTime(now, settings)) return { skipped: "quiet hours" };

  const mode = effectiveMode(settings);
  const today = reportDayKey(now);
  // Once-a-day mode: new reports only at the first run after the set time;
  // temporary failures are retried any time after that.
  let includePending = true;
  if (mode === "END_OF_DAY") {
    const clock = parseClock(settings.endOfDayTime) || parseClock("18:00");
    const p = partsInIst(now);
    if (p.hour * 60 + p.minute < clock.minutes) return { skipped: "before today's send time" };
    includePending = settings.lastEodRunDay !== today;
  }

  const maxAttempts = settings.retryPolicy?.maxAttempts ?? 3;
  const oldest = new Date(now.getTime() - maxAgeHours(settings) * 60 * 60 * 1000);
  const base = {
    opIpType: DELIVERY_OP_IP_TYPE,
    phone: { $nin: ["", null] },
    patientType: { $ne: "ZPATIENT" },
    readiness: settings.readinessRule === "PARTIAL" ? { $in: ["READY", "PARTIAL"] } : "READY",
    $or: [{ reportReadyAt: { $gte: oldest } }, { reportReadyAt: null, readySeenAt: { $gte: oldest } }],
  };
  const candidates = await Report.find({
    $and: [
      base,
      {
        $or: [
          ...(includePending ? [{ status: "PENDING" }] : []),
          { status: "FAILED", retryable: true, attempts: { $lt: maxAttempts }, nextRetryAt: { $lte: now } },
        ],
      },
    ],
  })
    .sort({ reportReadyAt: 1 })
    .limit(200);

  const due = candidates.filter(
    (report) => report.status === "FAILED" || mode === "END_OF_DAY" || autoSendDecision(report, settings, now).due
  );
  if (!due.length) {
    if (mode === "END_OF_DAY" && includePending) {
      await AutomationSettings.updateOne({}, { $set: { lastEodRunDay: today } });
    }
    return { due: 0 };
  }

  const result = await runExclusive(async () => {
    const pending = due.filter((r) => r.status === "PENDING");
    const retries = due.filter((r) => r.status === "FAILED");
    const first = await sendEach(pending, { triggerType: mode === "END_OF_DAY" ? "AUTO_EOD" : "AUTO_DELAYED" });
    const second = await sendEach(retries, { triggerType: "AUTO_RETRY" });
    return {
      sent: first.sent + second.sent,
      failed: first.failed + second.failed,
      skipped: first.skipped + second.skipped,
      errors: [...first.errors, ...second.errors],
    };
  });
  if (mode === "END_OF_DAY" && includePending && !result.busy) {
    await AutomationSettings.updateOne({}, { $set: { lastEodRunDay: today } });
  }
  return { due: due.length, ...result };
}

/**
 * A report left QUEUED by a crash or restart can't be retried blindly — WATI
 * may already have delivered it — so it waits for a person ("Check needed").
 */
export async function recoverStaleSends({ olderThanMs = STALE_QUEUED_MS } = {}) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const result = await Report.updateMany(
    { status: "QUEUED", $or: [{ queuedAt: { $lte: cutoff } }, { queuedAt: null }] },
    {
      $set: {
        status: "NEEDS_REVIEW",
        lastError: "The app stopped while sending — check WhatsApp Monitor before resending",
      },
    }
  );
  return result.modifiedCount || 0;
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
    sendDelayHours: settings.sendDelayHours,
    quietHoursEnabled: settings.quietHoursEnabled,
    quietStart: settings.quietStart,
    quietEnd: settings.quietEnd,
    watiSendEnabled: config.wati.sendEnabled,
    watiTestMode: config.wati.testMode,
    watiTestSendMode: settings.watiTestSendMode,
    watiTestContactPhones: settings.watiTestContactPhones || [],
  };
}
