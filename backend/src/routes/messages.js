import express from "express";
import { MessageLog } from "../models/index.js";
import { sendReportById } from "../services/reports.js";
import { deliveryCheckState, runDeliveryChecks } from "../services/delivery.js";
import { readWatiApiUsage } from "../services/watiCache.js";
import { config } from "../config.js";
import { parseQueryDate } from "../utils/dates.js";
import { escapeRegex } from "../utils/text.js";

const router = express.Router();
const STATUSES = ["SENT", "DELIVERED", "READ", "FAILED"];

function buildQuery(req) {
  const query = {};
  const status = String(req.query.status || "").toUpperCase();
  if (STATUSES.includes(status)) query.status = status;
  if (req.query.kind === "test") query.testSend = true;
  else if (req.query.kind === "real") query.testSend = { $ne: true };
  const from = parseQueryDate(String(req.query.from || ""), false);
  const to = parseQueryDate(String(req.query.to || ""), true);
  if (from || to) {
    query.sentAt = {};
    if (from) query.sentAt.$gte = from;
    if (to) query.sentAt.$lte = to;
  }
  const q = String(req.query.q || "").trim();
  if (q) {
    const re = new RegExp(escapeRegex(q), "i");
    const digits = q.replace(/\D/g, "");
    query.$or = [
      { patientName: re },
      { patientId: re },
      { reportId: re },
      { errorReason: re },
      ...(digits.length >= 3 ? [{ phone: new RegExp(digits) }] : []),
    ];
  }
  return query;
}

router.get("/", async (req, res) => {
  const query = buildQuery(req);
  const pageSize = req.query.pageSize ? Math.min(Math.max(Number(req.query.pageSize) || 50, 10), 500) : 500;
  const { status: _ignored, ...withoutStatus } = query;
  const [total, messages, statusRows] = await Promise.all([
    MessageLog.countDocuments(query),
    MessageLog.find(query)
      .sort({ sentAt: -1 })
      .skip((Math.max(Number(req.query.page) || 1, 1) - 1) * pageSize)
      .limit(pageSize)
      .select("-responsePayload")
      .lean(),
    MessageLog.aggregate([{ $match: withoutStatus }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
  ]);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const row of statusRows) counts[row._id] = row.n;
  counts.all = Object.values(counts).reduce((a, b) => a + b, 0);
  res.json({
    messages,
    total,
    page: Math.max(Number(req.query.page) || 1, 1),
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    counts,
  });
});

router.get("/delivery-state", async (_req, res) => {
  res.json({
    ...(await deliveryCheckState()),
    watiUsage: await readWatiApiUsage(),
    watiMonthlyLimit: config.wati.basicPlanApiLimit || null,
  });
});

/** Staff "Check ticks now" — still within today's status-check cap. */
router.post("/check-now", async (_req, res) => {
  res.json(await runDeliveryChecks());
});

router.post("/:id/retry", async (req, res) => {
  if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.status(400).json({ error: "Invalid message id" });
  const log = await MessageLog.findById(req.params.id);
  if (!log?.reportRef) return res.status(404).json({ error: "Message log not found" });
  try {
    // Retrying a failed message must not resend a report that has since gone out —
    // that needs an explicit "resend".
    const result = await sendReportById(log.reportRef, {
      triggerType: "MANUAL",
      force: req.body?.resend === true,
      sentBy: req.user?.email || "",
    });
    res.json({ sentPhones: result.sentPhones, status: result.report.status });
  } catch (error) {
    res.status(error.code === "ALREADY_SENT" ? 409 : 400).json({ error: error.message, code: error.code });
  }
});

export default router;
