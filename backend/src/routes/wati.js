import express from "express";
import {
  createTemplate,
  deleteTemplate,
  getTemplateById,
  listTemplates,
  syncTemplatesFromWati,
  updateTemplate,
} from "../services/watiTemplates.js";
import { getWatiOverview } from "../services/watiStats.js";
import { listWatiContacts, refreshWatiContacts } from "../services/wati.js";
import { getSettings } from "../services/reports.js";
import { config } from "../config.js";
import { normalizePhone } from "../utils/phone.js";

const router = express.Router();

/**
 * WhatsApp delivery mode (WATI Settings → Delivery), as in the investigation
 * portal: Off (nothing is sent), Test (no automatic sends; a manual Send goes
 * to a test number only) or Live (reports go to patients automatically).
 * Stored as messageSendEnabled + watiTestSendMode on the automation settings.
 */
const MODES = ["off", "test", "live"];
const modeOf = (s) => (s.watiTestSendMode ? "test" : s.messageSendEnabled ? "live" : "off");

function deliveryView(s) {
  return {
    ok: true,
    mode: modeOf(s),
    testPhones: s.watiTestContactPhones || [],
    templateName: s.watiTemplateName || config.wati.templateName,
    schedule: {
      mode: s.mode,
      sendDelayHours: s.sendDelayHours,
      endOfDayTime: s.endOfDayTime,
      quietHoursEnabled: s.quietHoursEnabled,
      quietStart: s.quietStart,
      quietEnd: s.quietEnd,
    },
    // The server's own switches (.env) sit above the mode.
    server: {
      configured: Boolean(config.wati.token && config.wati.baseUrl),
      sendEnabled: config.wati.sendEnabled,
      testMode: config.wati.testMode,
      testPhone: config.wati.testPhoneOnly,
    },
    updatedAt: s.updatedAt || null,
    updatedBy: s.updatedBy || "",
  };
}

function cleanPhones(list) {
  if (!Array.isArray(list)) throw Object.assign(new Error("Test numbers must be a list"), { status: 400 });
  const phones = [...new Set(list.map((p) => normalizePhone(p)).filter(Boolean))];
  const bad = phones.find((p) => !/^\d{11,15}$/.test(p));
  if (bad) throw Object.assign(new Error(`${bad} isn't a mobile number — use 10 digits or the full number with country code`), { status: 400 });
  return phones.slice(0, 20);
}

router.get("/delivery", async (_req, res) => {
  res.json(deliveryView(await getSettings()));
});

router.put("/delivery", async (req, res) => {
  try {
    const s = await getSettings();
    const before = { mode: modeOf(s), phones: (s.watiTestContactPhones || []).join(",") };
    if (req.body?.testPhones !== undefined) s.watiTestContactPhones = cleanPhones(req.body.testPhones);
    if (req.body?.mode !== undefined) {
      if (!MODES.includes(req.body.mode)) return res.status(400).json({ ok: false, error: "Mode must be off, test or live" });
      s.messageSendEnabled = req.body.mode === "live";
      s.watiTestSendMode = req.body.mode === "test";
    }
    if (s.watiTestSendMode && !(s.watiTestContactPhones || []).length) {
      return res.status(400).json({ ok: false, error: "Add a test number first — in test mode every send goes to it" });
    }
    s.updatedBy = req.user?.email || "staff";
    await s.save();
    const changes = [];
    if (before.mode !== modeOf(s)) changes.push(`mode ${before.mode} → ${modeOf(s)}`);
    if (before.phones !== (s.watiTestContactPhones || []).join(",")) changes.push(`test numbers → ${(s.watiTestContactPhones || []).join(", ") || "none"}`);
    res.locals.auditChanges = changes; // middleware/audit.js
    res.json(deliveryView(s));
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.status ? error.message : "Couldn't save the delivery mode" });
  }
});

router.get("/overview", async (_req, res) => {
  try {
    res.json(await getWatiOverview());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/contacts", async (req, res) => {
  try {
    const force = req.query.refresh === "true" || req.query.force === "true";
    const result = force ? await refreshWatiContacts() : await listWatiContacts();
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/templates", async (_req, res) => {
  const templates = await listTemplates();
  res.json({ templates });
});

router.post("/templates/sync", async (_req, res) => {
  try {
    const result = await syncTemplatesFromWati();
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/templates", async (req, res) => {
  try {
    const template = await createTemplate(req.body || {});
    res.status(201).json({ template });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/templates/:id", async (req, res) => {
  try {
    res.json({ template: await getTemplateById(req.params.id) });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

router.put("/templates/:id", async (req, res) => {
  try {
    const template = await updateTemplate(req.params.id, req.body || {});
    res.json({ template });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete("/templates/:id", async (req, res) => {
  try {
    res.json(await deleteTemplate(req.params.id));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
