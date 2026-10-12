import crypto from "node:crypto";
import express from "express";
import { config } from "../config.js";
import { Report, Patient } from "../models/index.js";
import { buildLabReportUrl, isPlausibleProcIds, looksLikeEmrOrderId } from "../services/emr.js";
import { upsertOrderPdfMeta } from "../services/orderPdfMeta.js";
import { handleWatiStatusEvent, isWatiWebhookKey } from "../services/delivery.js";
import { reportDayKey } from "../utils/dates.js";
import { normalizePhone } from "../utils/phone.js";

const router = express.Router();

function safeEqual(a, b) {
  const x = crypto.createHash("sha256").update(String(a || "")).digest();
  const y = crypto.createHash("sha256").update(String(b || "")).digest();
  return crypto.timingSafeEqual(x, y);
}

/**
 * HIS "report ready" push. Off unless HIS_WEBHOOK_SECRET is set — without it
 * anyone who can reach the API could queue a WhatsApp message to any number.
 * The PDF link is always built from the order + procedure IDs, never taken
 * from the request.
 */
router.post("/his/report-ready", async (req, res) => {
  if (!config.webhooks.hisSecret) return res.status(404).json({ error: "Not found" });
  if (!safeEqual(req.headers["x-his-secret"], config.webhooks.hisSecret)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const orderId = String(req.body.reportId || req.body.orderId || "").trim();
  const patientId = String(req.body.patientId || "").trim();
  const patientName = String(req.body.patientName || "").trim();
  const phone = normalizePhone(req.body.phone);
  const procIds = Array.isArray(req.body.procIds)
    ? req.body.procIds.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  const opIp = String(req.body.opIpType || req.body.opIp || "OP").toUpperCase();

  if (!looksLikeEmrOrderId(orderId)) return res.status(400).json({ error: "A numeric reportId/orderId is required" });
  if (opIp !== "OP") return res.status(202).json({ ok: true, ignored: "whatsi delivers OP reports only" });
  if (!isPlausibleProcIds(procIds)) return res.status(400).json({ error: "procIds are required" });

  const hisReportUrl = buildLabReportUrl(orderId, procIds);
  res.json({ ok: true });

  setImmediate(async () => {
    try {
      const patient = await Patient.findOneAndUpdate(
        { patientId: patientId || orderId },
        { patientId: patientId || orderId, name: patientName, phone, opIpType: "OP", lastSyncedAt: new Date() },
        { upsert: true, new: true }
      );
      const now = new Date();
      await Report.findOneAndUpdate(
        { reportId: orderId, reportDay: reportDayKey() },
        {
          $set: {
            reportId: orderId,
            patientId: patient.patientId,
            patientRef: patient._id,
            patientName,
            phone: normalizePhone(patient.phoneOverride) || phone,
            opIpType: "OP",
            procIds,
            hisReportUrl,
            readiness: "READY",
            triggerType: "WEBHOOK",
            reportReadyAt: now,
            readySeenAt: now,
            reportDay: reportDayKey(),
          },
          $setOnInsert: { status: "PENDING" },
        },
        { upsert: true }
      );
      await upsertOrderPdfMeta(orderId, { patientId: patient.patientId, procIds, hisReportUrl, source: "WEBHOOK" });
    } catch (error) {
      console.error("[webhook] his/report-ready failed", error.message);
    }
  });
});

/**
 * WATI → Connectors → Webhooks: message sent / delivered / read / failed.
 * The secret key in the path is shown in Settings → WhatsApp ticks.
 */
router.post("/wati/:key", async (req, res) => {
  if (!isWatiWebhookKey(req.params.key)) return res.status(404).json({ ok: false });
  // Always 200 once the key is right, so WATI doesn't keep re-sending the event.
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    const results = [];
    for (const event of events) results.push(await handleWatiStatusEvent(event || {}));
    res.json({ ok: true, results });
  } catch (error) {
    console.warn("[webhook] WATI status event not processed:", error.message);
    res.json({ ok: true, error: error.message });
  }
});

export default router;
