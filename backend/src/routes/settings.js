import express from "express";
import { config } from "../config.js";
import { getSettings } from "../services/reports.js";
import { testWatiConnection } from "../services/wati.js";
import { loginToEmr } from "../services/emrAuth.js";
import { fetchProcIdsFromLabResultHis } from "../services/emr.js";

const router = express.Router();

router.get("/automation", async (_req, res) => {
  res.json({ settings: await getSettings() });
});

router.put("/automation", async (req, res) => {
  const settings = await getSettings();
  const allowed = [
    "automationEnabled",
    "mode",
    "endOfDayTime",
    "scope",
    "readinessRule",
    "watiTemplateName",
    "watiTestSendMode",
    "watiTestContactPhones",
    "retryPolicy",
  ];
  for (const key of allowed) {
    if (req.body[key] !== undefined) settings[key] = req.body[key];
  }
  if (Array.isArray(settings.watiTestContactPhones)) {
    settings.watiTestContactPhones = settings.watiTestContactPhones
      .map((p) => String(p).replace(/\D/g, ""))
      .filter(Boolean)
      .map((digits) => (digits.length === 10 ? `91${digits}` : digits));
  }
  settings.updatedBy = req.user?.email || "staff";
  await settings.save();
  res.json({ settings });
});

router.get("/health", async (_req, res) => {
  const wati = await testWatiConnection();
  let emrAuth = { ok: false, method: "none" };
  if (config.emr.cookie) {
    emrAuth = { ok: true, method: "cookie" };
  } else if (config.emr.username && config.emr.password) {
    try {
      await loginToEmr();
      emrAuth = { ok: true, method: "credentials" };
    } catch (error) {
      emrAuth = { ok: false, method: "credentials", error: error.message };
    }
  }

  res.json({
    ok: true,
    wati,
    watiSendEnabled: config.wati.sendEnabled,
    emrPollEnabled: config.emr.pollEnabled,
    emrAuth,
    emrProcIdDiscovery: Boolean(emrAuth.ok),
  });
});

router.get("/health/emr-procids/:orderId", async (req, res) => {
  try {
    const procIds = await fetchProcIdsFromLabResultHis(req.params.orderId);
    res.json({ orderId: req.params.orderId, procIds, count: procIds.length });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
