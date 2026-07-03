import express from "express";
import { Patient } from "../models/index.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const query = {};
  if (req.query.q) {
    const q = String(req.query.q).trim();
    query.$or = [
      { name: new RegExp(q, "i") },
      { patientId: new RegExp(q, "i") },
      { phone: new RegExp(q.replace(/\D/g, ""), "i") },
      { phoneOverride: new RegExp(q.replace(/\D/g, ""), "i") },
    ];
  }
  if (req.query.opIp) query.opIpType = String(req.query.opIp).toUpperCase();

  const patients = await Patient.find(query).sort({ updatedAt: -1 }).limit(500);
  res.json({ patients });
});

router.patch("/:id", async (req, res) => {
  const patient = await Patient.findById(req.params.id);
  if (!patient) return res.status(404).json({ error: "Not found" });

  if (req.body.phoneOverride !== undefined) {
    patient.phoneOverride = String(req.body.phoneOverride || "").trim();
  }
  if (req.body.name) patient.name = String(req.body.name).trim();
  await patient.save();
  res.json({ patient });
});

export default router;
