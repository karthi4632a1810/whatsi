import express from "express";
import { config } from "../config.js";
import { getSettings } from "../services/reports.js";
import { testWatiConnection } from "../services/wati.js";
import { loginToEmr } from "../services/emrAuth.js";
import { fetchProcIdsFromLabResultHis, looksLikeEmrOrderId } from "../services/emr.js";
import { deliveryCheckState, watiWebhookKey } from "../services/delivery.js";
import { getJobState } from "../jobs/scheduler.js";
import { readWatiApiUsage } from "../services/watiCache.js";
import { parseClock } from "../utils/schedule.js";
import { settingsScreen, updateSettings } from "../services/appSettings.js";
import { listUsers } from "../services/users.js";
import { pdfCacheUsage } from "../services/reportPdf.js";

const router = express.Router();

class ValidationError extends Error {}

const bool = (value, name) => {
  if (typeof value !== "boolean") throw new ValidationError(`${name} must be true or false`);
  return value;
};
const clock = (value, name) => {
  if (!parseClock(value)) throw new ValidationError(`${name} must be a time like 07:00`);
  return String(value).padStart(5, "0");
};
const number = (value, name, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new ValidationError(`${name} must be between ${min} and ${max}`);
  return n;
};
const oneOf = (value, name, options) => {
  if (!options.includes(value)) throw new ValidationError(`${name} must be one of ${options.join(", ")}`);
  return value;
};

/** Each editable setting and how to check it. Anything else in the body is ignored. */
const FIELDS = {
  automationEnabled: (v) => bool(v, "Automatic mode"),
  messageSendEnabled: (v) => bool(v, "WhatsApp sending"),
  mode: (v) => oneOf(v, "Send schedule", ["AFTER_READY", "END_OF_DAY"]),
  sendDelayHours: (v) => number(v, "Send delay", 0, 48),
  endOfDayTime: (v) => clock(v, "Daily send time"),
  quietHoursEnabled: (v) => bool(v, "Quiet hours"),
  quietStart: (v) => clock(v, "Quiet hours start"),
  quietEnd: (v) => clock(v, "Quiet hours end"),
  maxAutoSendAgeHours: (v) => number(v, "Automatic send age limit", 1, 168),
  readinessRule: (v) => oneOf(v, "Readiness rule", ["STRICT", "PARTIAL"]),
  watiTemplateName: (v) => {
    const name = String(v || "").trim();
    if (!/^[a-z0-9_]{1,100}$/.test(name)) throw new ValidationError("Template name may only use a-z, 0-9 and _");
    return name;
  },
  watiTestSendMode: (v) => bool(v, "Test send mode"),
  watiTestContactPhones: (v) => {
    if (!Array.isArray(v)) throw new ValidationError("Test numbers must be a list");
    return [
      ...new Set(
        v
          .map((p) => String(p).replace(/\D/g, ""))
          .filter(Boolean)
          .map((digits) => (digits.length === 10 ? `91${digits}` : digits))
          .filter((digits) => /^\d{11,15}$/.test(digits))
      ),
    ].slice(0, 20);
  },
  retryPolicy: (v) => ({
    maxAttempts: number(v?.maxAttempts, "Send attempts", 1, 10),
    retryIntervalMinutes: number(v?.retryIntervalMinutes, "Retry interval", 5, 360),
  }),
  statusChecksEnabled: (v) => bool(v, "Status checks"),
  statusChecksPerDay: (v) => number(v, "Status checks per day", 0, 2000),
};

router.get("/automation", async (_req, res) => {
  res.json({ settings: await getSettings() });
});

router.put("/automation", async (req, res) => {
  const settings = await getSettings();
  const changed = [];
  try {
    for (const [key, check] of Object.entries(FIELDS)) {
      if (req.body?.[key] === undefined) continue;
      const value = check(req.body[key]);
      if (JSON.stringify(value) !== JSON.stringify(settings[key])) changed.push(key);
      settings[key] = value;
    }
  } catch (error) {
    if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
    throw error;
  }
  if (settings.quietHoursEnabled && settings.quietStart === settings.quietEnd) {
    return res.status(400).json({ error: "Quiet hours start and end must be different" });
  }
  settings.scope = "OP_ONLY";
  settings.updatedBy = req.user?.email || "staff";
  await settings.save();
  res.locals.auditChanges = changed; // middleware/audit.js
  res.json({ settings });
});

/**
 * Master Settings (super admin): portal switches, sign-in rules, audit,
 * announcement (services/appSettings.js), with live numbers for context.
 */
// How many active staff accounts have each feature in their own access — who a global switch turns it off for.
const FEATURE_HOLDERS = {
  "features.labSearch": (p) => p.screens.search !== "none",
  "features.labFinder": (p) => p.screens.labFinder !== "none",
  "features.exports": (p) => ["labFinder", "monitor", "audit"].some((id) => p.screens[id] !== "none"),
};
async function settingsLive() {
  const users = await listUsers().catch(() => []);
  const staff = users.filter((u) => !u.isSuperAdmin && u.active !== false);
  const automation = await getSettings().catch(() => null);
  return {
    pdfCache: await pdfCacheUsage().catch(() => null),
    staffCount: staff.length,
    superAdmins: users.filter((u) => u.isSuperAdmin).length,
    sendingOn: automation ? Boolean(automation.messageSendEnabled) : null,
    deliveryMode: automation ? (automation.watiTestSendMode ? "test" : automation.messageSendEnabled ? "live" : "off") : null,
    featureHolders: Object.fromEntries(Object.entries(FEATURE_HOLDERS).map(([key, has]) => [key, staff.filter((u) => has(u.permissions)).length])),
  };
}

router.get("/", async (_req, res) => {
  res.json({ ok: true, ...(await settingsScreen()), live: await settingsLive() });
});

router.put("/", async (req, res) => {
  const values = req.body?.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return res.status(400).json({ ok: false, error: "Nothing to save" });
  }
  try {
    const saved = await updateSettings(values, req.user?.username || req.user?.email || "");
    res.json({ ok: true, ...saved, live: await settingsLive() });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.expose ? error.message : "Couldn't save the settings" });
  }
});

/** Everything the Settings page shows about the server side: switches, jobs, WATI. */
router.get("/health", async (req, res) => {
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

  const settings = await getSettings();
  const origin = `${req.headers["x-forwarded-proto"] || req.protocol}://${req.headers["x-forwarded-host"] || req.headers.host}`;
  res.json({
    ok: true,
    wati,
    watiSendEnabled: config.wati.sendEnabled,
    watiTestMode: config.wati.testMode,
    watiTestPhone: config.wati.testPhoneOnly,
    messageSendEnabled: settings.messageSendEnabled,
    emrPollEnabled: config.emr.pollEnabled,
    emrPollCron: config.emr.pollCron,
    emrAuth,
    emrProcIdDiscovery: Boolean(emrAuth.ok),
    jobs: getJobState(),
    delivery: await deliveryCheckState(),
    watiWebhookUrl: `${config.publicBaseUrl || origin}/api/webhooks/wati/${watiWebhookKey()}`,
    reportLinks: config.publicBaseUrl
      ? { mode: "private", base: config.publicBaseUrl, days: config.reportLinkDays }
      : { mode: "emr" },
    watiUsage: await readWatiApiUsage(),
    watiMonthlyLimit: config.wati.basicPlanApiLimit || null,
  });
});

router.get("/health/emr-procids/:orderId", async (req, res) => {
  if (!looksLikeEmrOrderId(req.params.orderId)) return res.status(400).json({ error: "Invalid order ID" });
  try {
    const procIds = await fetchProcIdsFromLabResultHis(req.params.orderId);
    res.json({ orderId: req.params.orderId, procIds, count: procIds.length });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
