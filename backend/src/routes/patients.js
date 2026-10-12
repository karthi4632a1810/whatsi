import express from "express";
import { Patient, Report } from "../models/index.js";
import { escapeRegex } from "../utils/text.js";
import { normalizePhone } from "../utils/phone.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const query = {};
  if (req.query.q) {
    const q = escapeRegex(String(req.query.q).trim());
    const digits = String(req.query.q).replace(/\D/g, "");
    query.$or = [
      { name: new RegExp(q, "i") },
      { patientId: new RegExp(q, "i") },
      ...(digits ? [{ phone: new RegExp(digits) }, { phoneOverride: new RegExp(digits) }] : []),
    ];
  }
  if (req.query.opIp) query.opIpType = String(req.query.opIp).toUpperCase();

  const patients = await Patient.find(query).sort({ updatedAt: -1 }).limit(500);
  res.json({ patients });
});

/**
 * Sets the WhatsApp number for an OP patient by UHID — also before any report
 * of theirs has joined the queue (the contact is created then).
 */
router.put("/by-uhid/:patientId", async (req, res) => {
  const patientId = String(req.params.patientId || "").trim();
  if (!/^[A-Za-z0-9-]{1,30}$/.test(patientId)) return res.status(400).json({ error: "Invalid UHID" });
  const raw = String(req.body?.phoneOverride || "").trim();
  const phone = normalizePhone(raw);
  if (raw && !/^\d{11,15}$/.test(phone)) {
    return res.status(400).json({ error: "Enter a 10-digit mobile number (or a full number with country code)" });
  }
  const patient = await Patient.findOneAndUpdate(
    { patientId },
    {
      $set: { phoneOverride: phone },
      $setOnInsert: { patientId, name: String(req.body?.name || "").trim(), opIpType: "OP" },
    },
    { upsert: true, new: true }
  );
  const effective = phone || normalizePhone(patient.phone);
  if (effective) {
    await Report.updateMany(
      { patientId, status: { $in: ["PENDING", "FAILED"] } },
      { $set: { phone: effective, patientRef: patient._id } }
    );
  }
  const result = effective
    ? await Report.updateMany(
        { patientId, status: "FAILED", failureKind: { $in: ["NO_PHONE", "NOT_ON_WHATSAPP"] } },
        { $set: { status: "PENDING", failureKind: "", lastError: "", retryable: false, nextRetryAt: null, attempts: 0 } }
      )
    : { modifiedCount: 0 };
  res.json({ patient, requeued: result.modifiedCount || 0 });
});

router.patch("/:id", async (req, res) => {
  const patient = await Patient.findById(req.params.id);
  if (!patient) return res.status(404).json({ error: "Not found" });

  if (req.body.phoneOverride !== undefined) {
    const raw = String(req.body.phoneOverride || "").trim();
    const phone = normalizePhone(raw);
    if (raw && !/^\d{11,15}$/.test(phone)) {
      return res.status(400).json({ error: "Enter a 10-digit mobile number (or a full number with country code)" });
    }
    patient.phoneOverride = phone;
  }
  if (req.body.name) patient.name = String(req.body.name).trim();
  await patient.save();

  // Unsent reports pick up the new number; ones that failed only for lack of a number go back in the queue.
  const phone = normalizePhone(patient.phoneOverride) || normalizePhone(patient.phone);
  let requeued = 0;
  if (phone) {
    await Report.updateMany(
      { patientRef: patient._id, status: { $in: ["PENDING", "FAILED"] } },
      { $set: { phone } }
    );
    const result = await Report.updateMany(
      { patientRef: patient._id, status: "FAILED", failureKind: { $in: ["NO_PHONE", "NOT_ON_WHATSAPP"] } },
      { $set: { status: "PENDING", failureKind: "", lastError: "", retryable: false, nextRetryAt: null, attempts: 0 } }
    );
    requeued = result.modifiedCount || 0;
  }
  res.json({ patient, requeued });
});

export default router;
