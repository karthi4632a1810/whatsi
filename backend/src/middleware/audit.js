/**
 * Records audit events for API calls as they finish (services/audit.js) — so a
 * sign-in, report sent, retry, PDF opened, export, setting or user change is
 * logged by the server no matter what the browser does. Each rule: method,
 * path, action, and what to note (null = don't log, e.g. a 404).
 */
import { HisLabOrder, Report } from "../models/index.js";
import { logAudit } from "../services/audit.js";
import { resolveSessionUser } from "../services/users.js";
import { readClaims } from "./auth.js";

const ID = "([^/]+)";
const re = (path) => new RegExp(`^${path}$`);
const short = (v, n = 120) => String(v ?? "").slice(0, n);
const errorOf = (body, ok) => (ok ? undefined : short(body?.error, 200) || "error");

/** "test: glucose · min: 7 · from: 2026-09-01" from a query object. */
function summarise(q = {}) {
  return Object.entries(q || {})
    .filter(([k, v]) => v !== undefined && v !== null && String(v) !== "" && !["page", "limit", "format", "view"].includes(k))
    .slice(0, 10)
    .map(([k, v]) => `${k}: ${short(Array.isArray(v) ? v.join(",") : typeof v === "object" ? JSON.stringify(v) : v, 40)}`)
    .join(" · ");
}

const auditViewSeen = new Map();

const RULES = [
  ["POST", re("/api/auth/login"), "login", ({ req, body, ok }) =>
    ok ? { user: body.user } : { action: "login_failed", details: { username: short(req.body?.username ?? req.body?.email, 60), reason: short(body.error, 120) } }],
  ["POST", re("/api/auth/logout"), "logout", ({ res, claims }) => (claims ? { details: { sessionMs: res.locals.sessionMs || null } } : null)],
  ["POST", re("/api/me/password"), "password_changed", ({ ok }) => (ok ? {} : null)],

  ["GET", re("/api/his/lab-search"), "search", ({ req, ok }) => (ok ? { screen: "search", details: { query: summarise(req.query) } } : null)],
  ["POST", re("/api/lab-results/search"), "search", ({ req, ok }) => (ok ? { screen: "labFinder", details: { query: summarise(req.body) } } : null)],
  ["POST", re("/api/lab-results/export"), "export", ({ req, ok }) =>
    ok ? { screen: "labFinder", details: { what: "Lab Finder results", format: "csv", query: summarise(req.body?.query) } } : null],
  ["GET", re(`/api/his/pdf/${ID}`), "pdf_open", ({ m, ok }) => (ok ? { screen: "reports", target: { orderId: short(m[1], 30) } } : null)],

  ["POST", re("/api/his/lab-today/refresh"), "his_refresh", ({ req, ok }) => (ok ? { screen: "reports", details: { date: short(req.body?.date, 10) } } : null)],
  ["POST", re("/api/op/refresh"), "his_refresh", ({ req, ok }) => (ok ? { screen: "reports", details: { date: short(req.body?.from || req.body?.date, 10) } } : null)],
  ["POST", re("/api/reports/poll"), "queue_sync", ({ req, ok }) => (ok ? { screen: "reports", details: { date: short(req.body?.from, 10) } } : null)],
  ["POST", re(`/api/op/orders/${ID}/queue`), "report_queue", ({ m, body, ok }) => ({ screen: "reports", target: { orderId: short(m[1], 30) }, details: { ok, error: errorOf(body, ok) } })],
  ["POST", re(`/api/op/orders/${ID}/send`), "whatsapp_send", ({ m, body, ok }) => ({ screen: "reports", target: { orderId: short(m[1], 30) }, details: { ok, error: errorOf(body, ok) } })],
  ["POST", re(`/api/reports/${ID}/send`), "whatsapp_send", ({ m, body, ok }) => ({ screen: "reports", target: { reportRef: short(m[1], 30) }, details: { ok, error: errorOf(body, ok) } })],
  ["POST", re("/api/reports/bulk-send"), "whatsapp_send", ({ req, body, ok }) => ({
    screen: "reports",
    details: { ok, count: Array.isArray(req.body?.ids) ? req.body.ids.length : undefined, error: errorOf(body, ok) },
  })],
  ["POST", re("/api/reports/send-all-pending"), "whatsapp_send", ({ body, ok }) => ({ screen: "reports", details: { ok, count: body?.sent ?? undefined, error: errorOf(body, ok) } })],

  ["POST", re(`/api/messages/${ID}/retry`), "whatsapp_retry", ({ body, ok }) => ({ screen: "monitor", details: { ok, error: errorOf(body, ok) } })],
  ["POST", re(`/api/monitor/messages/${ID}/retry`), "whatsapp_retry", ({ body, ok }) => ({ screen: "monitor", details: { ok, error: errorOf(body, ok) } })],
  ["POST", re("/api/messages/check-now"), "whatsapp_check", ({ ok }) => (ok ? { screen: "monitor" } : null)],
  ["POST", re("/api/monitor/refresh"), "whatsapp_check", ({ ok }) => (ok ? { screen: "monitor" } : null)],
  ["GET", re("/api/monitor/export"), "export", ({ req, ok }) =>
    ok ? { screen: "monitor", details: { what: `WhatsApp ${req.query.view === "patients" ? "patient-wise" : "message-wise"} report`, format: short(req.query.format, 6), query: summarise(req.query) } } : null],

  ["PUT", re(`/api/patients/by-uhid/${ID}`), "contact_change", ({ m, req, ok }) =>
    ok ? { screen: "wati", target: { uhid: short(decodeURIComponent(m[1]), 30) }, details: { to: short(req.body?.phoneOverride ?? req.body?.phone, 20) } } : null],
  ["PATCH", re(`/api/patients/${ID}`), "contact_change", ({ req, body, ok }) =>
    ok ? { screen: "wati", target: { uhid: short(body?.patient?.patientId || body?.patientId, 30), patientName: short(body?.patient?.name, 60) || undefined }, details: { to: short(req.body?.phoneOverride ?? req.body?.phone, 20) } } : null],
  ["POST", re("/api/wati/templates/sync"), "template_change", ({ ok }) => (ok ? { screen: "wati", details: { how: "Synced" } } : null)],
  ["POST", re("/api/wati/templates"), "template_change", ({ req, ok }) => (ok ? { screen: "wati", details: { how: "Added", name: short(req.body?.name, 60) } } : null)],
  ["PUT", re(`/api/wati/templates/${ID}`), "template_change", ({ req, ok }) => (ok ? { screen: "wati", details: { how: "Changed", name: short(req.body?.name, 60) } } : null)],
  ["DELETE", re(`/api/wati/templates/${ID}`), "template_change", ({ ok }) => (ok ? { screen: "wati", details: { how: "Deleted" } } : null)],

  ["PUT", re("/api/wati/delivery"), "settings_change", ({ res, ok }) =>
    ok && res.locals.auditChanges?.length ? { screen: "wati", details: { where: "WhatsApp delivery", changes: short(res.locals.auditChanges.join(", "), 500) } } : null],
  ["PUT", re("/api/settings/automation"), "settings_change", ({ res, ok }) =>
    ok && res.locals.auditChanges?.length ? { screen: "settings", details: { where: "the sending schedule", changes: short(res.locals.auditChanges.join(", "), 500) } } : null],
  ["PUT", re("/api/settings"), "settings_change", ({ body, ok }) =>
    ok && body.changes?.length
      ? { screen: "settings", details: { where: "Master Settings", changes: short(body.changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).join(", "), 1500) } }
      : null],

  ["POST", re("/api/users"), "user_create", ({ req, ok }) => (ok ? { screen: "users", details: { username: short(req.body?.username, 40) } } : null)],
  ["PUT", re(`/api/users/${ID}`), "user_update", ({ m, req, ok }) =>
    ok ? { screen: "users", details: { username: short(decodeURIComponent(m[1]), 40), changes: Object.keys(req.body || {}).join(", ") } } : null],
  ["POST", re(`/api/users/${ID}/password`), "user_password_reset", ({ m, ok }) => (ok ? { screen: "users", details: { username: short(decodeURIComponent(m[1]), 40) } } : null)],
  ["POST", re(`/api/users/${ID}/sign-out`), "user_sign_out", ({ m, ok }) => (ok ? { screen: "users", details: { username: short(decodeURIComponent(m[1]), 40) } } : null)],
  ["DELETE", re(`/api/users/${ID}`), "user_delete", ({ m, ok }) => (ok ? { screen: "users", details: { username: short(decodeURIComponent(m[1]), 40) } } : null)],

  // Viewing the audit log is itself logged — once per 10 minutes per user.
  ["GET", re("/api/audit/summary"), "audit_view", ({ req, ok }) => {
    const key = req.user?.username;
    if (!ok || !key || Date.now() - (auditViewSeen.get(key) || 0) < 10 * 60_000) return null;
    auditViewSeen.set(key, Date.now());
    return { screen: "audit" };
  }],
  ["GET", re("/api/audit/export"), "audit_export", ({ req, ok }) => (ok ? { screen: "audit", details: { format: "csv", query: summarise(req.query) } } : null)],
];

/** Fills in the patient's name and UHID for a target given by order ID (board) or queue id. */
async function withPatient(target) {
  if (!target || target.patientName) return target;
  if (target.reportRef) {
    const { reportRef, ...rest } = target;
    const r = /^[a-f0-9]{24}$/i.test(reportRef) ? await Report.findById(reportRef).select("reportId patientId patientName").lean() : null;
    return r ? { ...rest, orderId: r.reportId, uhid: r.patientId, patientName: r.patientName } : rest;
  }
  if (target.orderId) {
    const o = await HisLabOrder.findOne({ orderId: target.orderId }).sort({ labDay: -1 }).select("patientId patientName").lean();
    return o ? { ...target, uhid: o.patientId, patientName: o.patientName } : target;
  }
  return target;
}

export function auditMiddleware(req, res, next) {
  if (!req.path.startsWith("/api/")) return next();
  const method = req.method === "HEAD" ? "GET" : req.method;
  const path = req.path.replace(/\/+$/, "");
  const rule = RULES.find(([m, pattern]) => m === method && pattern.test(path));
  if (!rule) return next();

  const claims = readClaims(req);
  const json = res.json.bind(res);
  res.json = (body) => {
    res.locals.auditBody = body;
    return json(body);
  };
  res.on("finish", () => {
    const [, pattern, action, extract] = rule;
    const ok = res.statusCode < 400;
    Promise.resolve()
      .then(() => extract({ req, res, m: pattern.exec(path), body: res.locals.auditBody || {}, ok, claims }))
      .then(async (out) => {
        if (!out) return;
        const { user: outUser, action: outAction, ...event } = out;
        const user = outUser || req.user || (claims ? await resolveSessionUser(claims.sub, claims.v) : null);
        const sessionId = req.sessionId || claims?.sid || null;
        if (event.details) for (const k of Object.keys(event.details)) if (event.details[k] === undefined) delete event.details[k];
        event.target = await withPatient(event.target);
        await logAudit({ user, sessionId, req }, { action: outAction || action, ...event });
      })
      .catch((error) => console.warn(`[audit] ${action}: ${error.message}`));
  });
  next();
}
