import express from "express";
import { HisLabOrder, MessageLog, Patient, Report } from "../models/index.js";
import { DELIVERY_OP_IP_TYPE, looksLikeEmrOrderId } from "../services/emr.js";
import {
  boardOrderToSnapshot,
  getSettings,
  sendReportById,
  syncPatientsAndReports,
} from "../services/reports.js";
import { listOpReports, rangeDays, refreshDays, sendFlags } from "../services/opBoard.js";
import { getAnalytics } from "../services/analytics.js";
import { refreshOrderFromEmr } from "../services/hisBoardStore.js";
import { reportDayKey } from "../utils/dates.js";
import { deriveStage, plannedSendAt } from "../utils/schedule.js";
import { groupTests, splitTestName } from "../utils/emrParse.js";
import { checkMessageNow } from "../services/delivery.js";

const router = express.Router();
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

router.param("orderId", (req, res, next, value) => {
  if (!looksLikeEmrOrderId(value)) return res.status(400).json({ error: "Invalid order ID" });
  next();
});

const wrap = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    const status = error.status || (error.code === "NOT_FOUND" ? 404 : error.code === "ALREADY_SENT" ? 409 : error.blocked ? 400 : 500);
    res.status(status).json({ error: error.message, code: error.code || undefined });
  }
};

/** The OP Reports list: search, status chips, department, sort, paging. */
router.get(
  "/op/reports",
  wrap(async (req, res) => {
    res.json(
      await listOpReports({
        from: String(req.query.from || ""),
        to: String(req.query.to || ""),
        q: String(req.query.q || "").slice(0, 100),
        stage: String(req.query.stage || ""),
        dept: String(req.query.dept || ""),
        sort: String(req.query.sort || "recent"),
        page: req.query.page,
        pageSize: req.query.pageSize,
      })
    );
  })
);

/** Load (or reload) days from HIS, one day after another. */
router.post(
  "/op/refresh",
  wrap(async (req, res) => {
    const days = rangeDays(String(req.body?.from || ""), String(req.body?.to || ""));
    res.json(refreshDays(days));
  })
);

async function findOrder(orderId, day) {
  const query = { orderId: String(orderId), opIpType: DELIVERY_OP_IP_TYPE };
  if (DAY_RE.test(day || "")) query.labDay = day;
  return HisLabOrder.findOne(query).sort({ labDay: -1 }).lean();
}

/** One order: tests, schedule, every WhatsApp attempt and its ticks. */
router.get(
  "/op/orders/:orderId",
  wrap(async (req, res) => {
    const orderId = req.params.orderId;
    const day = String(req.query.day || "");
    const [order, report, messages, settings] = await Promise.all([
      findOrder(orderId, day),
      Report.findOne({ reportId: orderId, opIpType: DELIVERY_OP_IP_TYPE }).sort({ updatedAt: -1 }).lean(),
      MessageLog.find({ reportId: orderId }).sort({ sentAt: -1 }).limit(50).lean(),
      getSettings(),
    ]);
    if (!order && !report) return res.status(404).json({ error: "OP order not found" });
    const uhid = order?.patientId || report?.patientId || "";
    const contact = uhid ? await Patient.findOne({ patientId: uhid }).lean() : null;
    const override = contact?.phoneOverride || "";

    const stage = deriveStage({ order, report, settings, flags: sendFlags(settings) });
    const planned = report?.status === "PENDING" ? plannedSendAt(report, settings) : null;
    const timeline = [
      order?.requestDate && { at: order.requestDate, label: "Tests ordered" },
      (report?.reportReadyAt || order?.completedAt) && {
        at: report?.reportReadyAt || order?.completedAt,
        label: order?.readiness === "READY" || report?.readiness === "READY" ? "All results approved" : "Latest result approved",
      },
      report?.createdAt && { at: report.createdAt, label: "Joined the WhatsApp queue" },
      planned && { at: planned, label: "Planned WhatsApp send", future: planned > new Date() },
      ...messages
        .slice()
        .reverse()
        .flatMap((m) => [
          {
            at: m.sentAt,
            label: m.status === "FAILED" && !m.deliveredAt ? (m.testSend ? "Test send failed" : "Send failed") : m.testSend ? `Test sent to ${m.phone}` : `Sent to ${m.phone}`,
            detail: m.status === "FAILED" ? m.errorReason : m.sentBy ? `by ${m.sentBy}` : m.triggerType === "AUTO_DELAYED" ? "automatic" : "",
            tone: m.status === "FAILED" && !m.deliveredAt ? "bad" : m.testSend ? "test" : "ok",
          },
          m.deliveredAt && { at: m.deliveredAt, label: "Delivered", tone: "ok" },
          m.readAt && { at: m.readAt, label: "Read by patient", tone: "ok" },
          m.failedAt && m.status === "FAILED" && m.deliveredAt == null && m.statusSource && { at: m.failedAt, label: "WhatsApp could not deliver", detail: m.errorReason, tone: "bad" },
        ]),
    ]
      .filter(Boolean)
      .sort((a, b) => new Date(a.at) - new Date(b.at));

    res.json({
      orderId,
      labDay: order?.labDay || report?.reportDay,
      patient: {
        name: report?.patientName || order?.patientName || "",
        patientId: order?.patientId || report?.patientId || "",
        phone: override || report?.phone || order?.phone || "",
        emrPhone: contact?.phone || order?.phone || "",
        phoneOverride: override,
        patientRef: report?.patientRef || contact?._id || null,
        department: order?.department || report?.department || "",
        patientType: order?.patientType || report?.patientType || "",
      },
      readiness: order?.readiness || report?.readiness,
      hisStatus: order?.hisStatus || "",
      requestDate: order?.requestDate || null,
      completedAt: order?.completedAt || report?.reportReadyAt || null,
      age: order?.age || "",
      gender: order?.gender || "",
      doctor: order?.doctor || "",
      lines: (order?.procedures || []).map((p) => ({
        ...splitTestName(p.name),
        status: p.status,
        result: p.result || "",
        completedAt: p.completedAt || null,
      })),
      approvedCount: order?.approvedCount ?? report?.approvedCount ?? 0,
      procedureTotal: order?.procedureTotal ?? report?.procedureTotal ?? 0,
      tests: groupTests(order?.procedures || []),
      stage,
      plannedSendAt: planned,
      queue: report
        ? {
            id: String(report._id),
            status: report.status,
            attempts: report.attempts,
            lastError: report.lastError,
            failureKind: report.failureKind,
            nextRetryAt: report.nextRetryAt,
            sentAt: report.sentAt,
            deliveryStatus: report.deliveryStatus,
            hasPdf: Boolean(report.hisReportUrl),
          }
        : null,
      procIds: report?.procIds?.length ? report.procIds : order?.procIds || [],
      messages: messages.map((m) => ({
        id: String(m._id),
        status: m.status,
        phone: m.phone,
        testSend: Boolean(m.testSend),
        sentAt: m.sentAt,
        deliveredAt: m.deliveredAt,
        readAt: m.readAt,
        errorReason: m.errorReason,
        triggerType: m.triggerType,
        sentBy: m.sentBy,
        template: m.templateName,
        lastCheckedAt: m.lastCheckedAt || null,
      })),
      timeline,
    });
  })
);

/** Makes sure an approved OP order has a WhatsApp queue row (staff action). */
async function ensureQueued(orderId, day, { allowPartial = false } = {}) {
  const existing = await Report.findOne({ reportId: orderId, opIpType: DELIVERY_OP_IP_TYPE }).sort({ updatedAt: -1 });
  if (existing) return existing;
  const order = await findOrder(orderId, day);
  if (!order) {
    const error = new Error("This order isn't on the OP board — load the day from HIS first");
    error.status = 404;
    throw error;
  }
  const settings = await getSettings();
  // A partly approved order only when the rule allows it, or the person sending confirmed it.
  const allowed = order.readiness === "READY" || ((settings.readinessRule === "PARTIAL" || allowPartial) && order.readiness === "PARTIAL");
  if (!allowed) {
    const error = new Error(order.readiness === "WAITING" ? "No results are approved yet" : "Not all tests are approved yet");
    error.status = 400;
    throw error;
  }
  const snapshot = boardOrderToSnapshot(
    { ...order, procedures: order.procedures || [], completedAt: order.completedAt },
    order.labDay
  );
  await syncPatientsAndReports([snapshot], { manual: true, allowPartial });
  const report = await Report.findOne({ reportId: orderId, reportDay: order.labDay });
  if (!report) {
    const error = new Error("Could not queue this order (check that it's an OP order with a patient type other than Z)");
    error.status = 400;
    throw error;
  }
  return report;
}

router.post(
  "/op/orders/:orderId/queue",
  wrap(async (req, res) => {
    const report = await ensureQueued(req.params.orderId, String(req.body?.day || ""));
    res.json({ queueId: String(report._id), status: report.status });
  })
);

/** Staff "Send now" / "Resend" / test send for one OP order. */
router.post(
  "/op/orders/:orderId/send",
  wrap(async (req, res) => {
    const report = await ensureQueued(req.params.orderId, String(req.body?.day || ""), { allowPartial: req.body?.force === true });
    const result = await sendReportById(report._id, {
      triggerType: "MANUAL",
      force: req.body?.force === true,
      testContactPhones: Array.isArray(req.body?.testContactPhones) ? req.body.testContactPhones : null,
      toPhone: typeof req.body?.toPhone === "string" ? req.body.toPhone : null,
      sentBy: req.user?.email || "",
    });
    res.json({
      sentPhones: result.sentPhones,
      messageIds: result.messageIds,
      testSend: result.testSend,
      status: result.report.status,
    });
  })
);

/** Ticks for one sent message, asked from WATI now (the send popup and the info panel). */
router.post(
  "/op/messages/:messageId/check",
  wrap(async (req, res) => {
    const id = String(req.params.messageId);
    if (!/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ error: "Invalid message id" });
    const result = await checkMessageNow(id);
    const m = await MessageLog.findById(id).lean();
    res.json({
      result,
      message: m && {
        id: String(m._id),
        status: m.status,
        phone: m.phone,
        testSend: Boolean(m.testSend),
        sentAt: m.sentAt,
        deliveredAt: m.deliveredAt,
        readAt: m.readAt,
        errorReason: m.errorReason,
        lastCheckedAt: m.lastCheckedAt,
      },
    });
  })
);

/** Re-read one order from HIS now (e.g. after a correction in the lab). */
router.post(
  "/op/orders/:orderId/refresh",
  wrap(async (req, res) => {
    const order = await findOrder(req.params.orderId, String(req.body?.day || ""));
    const day = order?.labDay || (DAY_RE.test(req.body?.day || "") ? req.body.day : reportDayKey());
    res.json(await refreshOrderFromEmr(day, req.params.orderId));
  })
);

router.get(
  "/analytics",
  wrap(async (req, res) => {
    res.json(await getAnalytics({ from: String(req.query.from || ""), to: String(req.query.to || "") }));
  })
);

export default router;
