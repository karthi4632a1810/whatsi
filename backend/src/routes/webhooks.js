import express from "express";
import { config } from "../config.js";
import { Report, Patient } from "../models/index.js";
import { buildLabReportUrl } from "../services/emr.js";
import { upsertOrderPdfMeta } from "../services/orderPdfMeta.js";
import { reportDayKey } from "../utils/dates.js";
import { normalizePhone } from "../utils/phone.js";

const router = express.Router();

function verifyHisSecret(req) {
  if (!config.webhooks.hisSecret) return true;
  return req.headers["x-his-secret"] === config.webhooks.hisSecret;
}

router.post("/his/report-ready", async (req, res) => {
  if (!verifyHisSecret(req)) return res.status(401).json({ error: "Unauthorized" });

  const orderId = String(req.body.reportId || req.body.orderId || "").trim();
  const patientId = String(req.body.patientId || "").trim();
  const patientName = String(req.body.patientName || "").trim();
  const phone = normalizePhone(req.body.phone);
  const procIds = Array.isArray(req.body.procIds) ? req.body.procIds.map(Number) : [];
  const hisReportUrl =
    req.body.hisReportUrl || (orderId ? buildLabReportUrl(orderId, procIds) : "");

  if (!orderId) return res.status(400).json({ error: "reportId/orderId required" });

  res.json({ ok: true });

  setImmediate(async () => {
    try {
      const patient = await Patient.findOneAndUpdate(
        { patientId: patientId || orderId },
        {
          patientId: patientId || orderId,
          name: patientName,
          phone,
          lastSyncedAt: new Date(),
        },
        { upsert: true, new: true }
      );

      await Report.findOneAndUpdate(
        { reportId: orderId, reportDay: reportDayKey() },
        {
          reportId: orderId,
          patientId: patient.patientId,
          patientRef: patient._id,
          patientName,
          phone,
          procIds,
          hisReportUrl,
          readiness: "READY",
          status: "PENDING",
          triggerType: "WEBHOOK",
          reportReadyAt: new Date(),
          reportDay: reportDayKey(),
        },
        { upsert: true }
      );

      if (procIds.length || hisReportUrl) {
        await upsertOrderPdfMeta(orderId, {
          patientId: patient.patientId,
          procIds,
          hisReportUrl,
          source: "WEBHOOK",
        });
      }
    } catch (error) {
      console.error("[webhook] his/report-ready failed", error.message);
    }
  });
});

router.post("/wati/status", async (req, res) => {
  res.json({ ok: true });
});

export default router;
