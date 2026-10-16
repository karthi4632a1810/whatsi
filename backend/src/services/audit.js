/**
 * Audit log: who did what, when — every sign-in and sign-out, screen opened,
 * report sent / retried / queued, PDF opened, export, setting or user change;
 * plus each session's active, idle and hidden-tab time.
 *
 * Most events are recorded by the server as the API is called
 * (middleware/audit.js), so they can't be skipped. The browser adds what only
 * it can see — screen changes, the tab hidden, idle time — through
 * POST /api/audit/events (frontend: lib/audit.js).
 *
 * Kept "Keep audit records for" days (Master Settings), then removed by Mongo (TTL).
 */
import crypto from "node:crypto";
import mongoose from "mongoose";
import { onSettingsChange, setting } from "./appSettings.js";
import { isSuperAdmin } from "./users.js";

const EVENTS = "audit_events";
const SESSIONS = "audit_sessions";
const retentionSeconds = () => setting("audit.retentionDays") * 86400;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TZ = "Asia/Kolkata";

/** Every action, its category (for filters) and whether the browser may report it. */
export const ACTIONS = {
  login: { cat: "auth" },
  login_failed: { cat: "auth" },
  logout: { cat: "auth" },
  password_changed: { cat: "auth" },
  screen_open: { cat: "screen", client: true },
  tab_hidden: { cat: "presence", client: true },
  tab_visible: { cat: "presence", client: true },
  idle_start: { cat: "presence", client: true },
  idle_end: { cat: "presence", client: true },
  tab_closed: { cat: "presence", client: true },
  search: { cat: "report" },
  date_change: { cat: "report", client: true },
  filter_change: { cat: "report", client: true },
  copy: { cat: "report", client: true },
  pdf_open: { cat: "report" },
  his_refresh: { cat: "report" },
  queue_sync: { cat: "report" },
  report_queue: { cat: "whatsapp" },
  whatsapp_click: { cat: "whatsapp", client: true },
  order_open: { cat: "report", client: true },
  whatsapp_popup_cancel: { cat: "whatsapp", client: true },
  whatsapp_send: { cat: "whatsapp" },
  whatsapp_retry: { cat: "whatsapp" },
  whatsapp_check: { cat: "whatsapp" },
  contact_change: { cat: "whatsapp" },
  template_change: { cat: "settings" },
  export: { cat: "export" },
  settings_change: { cat: "settings" },
  user_create: { cat: "users" },
  user_update: { cat: "users" },
  user_password_reset: { cat: "users" },
  user_sign_out: { cat: "users" },
  user_delete: { cat: "users" },
  audit_view: { cat: "audit" },
  audit_export: { cat: "audit" },
};
export const CATEGORIES = ["auth", "screen", "presence", "report", "whatsapp", "export", "settings", "users", "audit"];

export const SCREEN_NAMES = {
  reports: "OP Lab Reports",
  search: "Lab Search",
  labFinder: "Lab Finder",
  wati: "WATI Settings",
  monitor: "WhatsApp Monitor",
  users: "Users",
  audit: "Audit Log",
  settings: "Settings",
};

const db = () => mongoose.connection;
let ready = null;
async function events() {
  const c = db().collection(EVENTS);
  ready ||= Promise.all([
    c.createIndex({ at: 1 }, { expireAfterSeconds: retentionSeconds() }).catch(() => applyRetention()),
    c.createIndex({ user: 1, at: -1 }),
    c.createIndex({ department: 1, at: -1 }),
    c.createIndex({ sessionId: 1, at: 1 }),
    c.createIndex({ category: 1, at: -1 }),
    db().collection(SESSIONS).createIndex({ startedAt: 1 }, { expireAfterSeconds: retentionSeconds() }).catch(() => {}),
  ]).catch(() => {});
  await ready;
  return c;
}
const sessions = () => db().collection(SESSIONS);

/** Points the audit TTL indexes at the current "keep for" setting (no rebuild needed). */
export async function applyRetention() {
  const seconds = retentionSeconds();
  for (const name of [EVENTS, SESSIONS]) {
    const c = db().collection(name);
    const idx = (await c.indexes().catch(() => [])).find((i) => i.expireAfterSeconds !== undefined);
    if (!idx || idx.expireAfterSeconds === seconds) continue;
    await db().db.command({ collMod: name, index: { keyPattern: idx.key, expireAfterSeconds: seconds } });
  }
}
onSettingsChange((changes) => (changes.some((c) => c.key === "audit.retentionDays") ? applyRetention() : null));

// ---- Who / where ------------------------------------------------------------------

/** "Chrome · Windows" from a user-agent. */
export function device(ua = "") {
  const s = String(ua);
  const browser = /Edg\//.test(s) ? "Edge" : /OPR\//.test(s) ? "Opera" : /Chrome\//.test(s) ? "Chrome" : /Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : "Browser";
  const os = /Windows/.test(s) ? "Windows" : /Android/.test(s) ? "Android" : /iPhone|iPad/.test(s) ? "iOS" : /Mac OS X/.test(s) ? "Mac" : /Linux/.test(s) ? "Linux" : "";
  return [browser, os].filter(Boolean).join(" · ");
}

// The whole forwarded chain when there is one ("person, proxy").
export const clientIp = (req) =>
  String(req?.headers?.["x-forwarded-for"] || req?.headers?.["x-real-ip"] || req?.ip || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .join(", ")
    .slice(0, 100);

function who(user) {
  if (!user) return { user: null, userName: "", department: "", designation: "" };
  const admin = isSuperAdmin(user);
  return {
    user: String(user.username || user.email || "").toLowerCase(),
    userName: user.name || user.username || user.email || "",
    department: admin ? "Administration" : user.department || "—",
    designation: admin ? user.designation || "Super admin" : user.designation || "",
  };
}

// ---- Describing an event in a sentence -------------------------------------------

const dmy = (iso) => String(iso || "").split("-").reverse().join("-");
const mins = (ms) => {
  const m = Math.round((ms || 0) / 60000);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
};
const patient = (t = {}) => {
  if (!t) return "a patient";
  const id = [t.orderId && `order ${t.orderId}`, t.uhid && `UHID ${t.uhid}`].filter(Boolean).join(", ");
  const name = t.patientName || (t.orderId ? `order ${t.orderId}` : "") || (t.uhid ? `UHID ${t.uhid}` : "") || "a patient";
  return `${name}${id && t.patientName ? ` (${id})` : ""}`;
};

export function describe(e) {
  const d = e.details || {};
  const t = e.target || {};
  switch (e.action) {
    case "login":
      return `Signed in${e.device ? ` · ${e.device}` : ""}`;
    case "login_failed":
      return `Sign-in failed as “${d.username || "?"}” — ${d.reason || "wrong password"}`;
    case "logout":
      return `Signed out${d.sessionMs ? ` after ${mins(d.sessionMs)}` : ""}`;
    case "password_changed":
      return "Changed their own password";
    case "screen_open":
      return `Opened ${SCREEN_NAMES[e.screen] || e.screen}${d.from ? ` (was on ${SCREEN_NAMES[d.from] || d.from} for ${mins(d.prevMs)})` : ""}`;
    case "tab_hidden":
      return "Switched away from the portal tab";
    case "tab_visible":
      return `Came back to the tab after ${mins(e.durationMs)}`;
    case "idle_start":
      return "Went idle (no mouse or keyboard for 5 min)";
    case "idle_end":
      return `Active again after ${mins(e.durationMs)} idle`;
    case "tab_closed":
      return "Closed the tab / browser";
    case "search":
      return `Searched ${SCREEN_NAMES[e.screen] || ""}${d.query ? `: ${d.query}` : ""}`.trim();
    case "date_change":
      return `Viewed ${SCREEN_NAMES[e.screen] || "OP lab reports"} for ${dmy(d.date)}`;
    case "filter_change":
      return `Changed filters on ${SCREEN_NAMES[e.screen] || e.screen}${d.summary ? ` — ${d.summary}` : ""}`;
    case "copy":
      return `Copied ${d.label || "a value"} ${d.value || ""}`.trim();
    case "pdf_open":
      return `Opened the lab report of ${patient(t)}`;
    case "his_refresh":
      return `Refreshed the OP board from HIS${d.date ? ` for ${dmy(d.date)}` : ""}`;
    case "queue_sync":
      return `Synced ready reports to the WhatsApp queue${d.date ? ` for ${dmy(d.date)}` : ""}`;
    case "report_queue":
      return d.ok ? `Queued the report of ${patient(t)} for WhatsApp` : `Couldn't queue ${patient(t)}: ${d.error || "error"}`;
    case "order_open":
      return `Opened the full status of ${patient(t)}`;
    case "whatsapp_click":
      return `Clicked WhatsApp for ${patient(t)}${d.mode ? ` (${d.mode} mode)` : ""}`;
    case "whatsapp_popup_cancel":
      return `Cancelled the WhatsApp popup for ${patient(t)}${d.numberEdited ? " (after changing the number)" : ""}`;
    case "whatsapp_send":
      return d.ok
        ? `${d.test ? "Test-sent" : "Sent"} ${d.count > 1 ? `${d.count} reports` : `the report of ${patient(t)}`} on WhatsApp${d.to ? ` to ${d.to}` : ""}${d.numberEdited ? " (number typed by hand)" : ""}`
        : `WhatsApp send failed${t.orderId || t.patientName ? ` for ${patient(t)}` : ""}: ${d.error || "error"}`;
    case "whatsapp_retry":
      return d.ok ? `Retried a failed WhatsApp message${t.orderId || t.patientName ? ` of ${patient(t)}` : ""}` : `Retry failed: ${d.error || "error"}`;
    case "whatsapp_check":
      return "Asked WATI for the latest delivery ticks";
    case "contact_change":
      return `Changed the WhatsApp number of ${patient(t)}${d.to ? ` to ${d.to}` : ""}`;
    case "template_change":
      return `${d.how || "Changed"} a WATI message template${d.name ? ` (${d.name})` : ""}`;
    case "export":
      return `Downloaded ${d.what || "an export"}${d.format ? ` as ${String(d.format).toUpperCase()}` : ""}`;
    case "settings_change":
      return `Changed ${d.where || "settings"}: ${d.changes || ""}`;
    case "user_create":
      return `Created user ${d.username || ""}`;
    case "user_update":
      return `Changed user ${d.username || ""}${d.changes ? ` — ${d.changes}` : ""}`;
    case "user_password_reset":
      return `Reset the password of ${d.username || ""}`;
    case "user_sign_out":
      return `Signed ${d.username || ""} out everywhere`;
    case "user_delete":
      return `Deleted user ${d.username || ""}`;
    case "audit_view":
      return "Viewed the audit log";
    case "audit_export":
      return `Downloaded the audit log as ${String(d.format || "").toUpperCase()}`;
    default:
      return e.action;
  }
}

// ---- Writing ------------------------------------------------------------------------

/** Records one event. `ctx`: { user, sessionId, req } — omit user for failed sign-ins. */
export async function logAudit(ctx, { action, screen, target, details, at, durationMs, tabId } = {}) {
  if (!ACTIONS[action]) return;
  const c = await events();
  const doc = {
    at: at instanceof Date && !Number.isNaN(at.getTime()) ? at : new Date(),
    action,
    category: ACTIONS[action].cat,
    ...who(ctx.user),
    sessionId: ctx.sessionId || null,
    tabId: tabId || null,
    screen: screen || null,
    target: target && Object.keys(target).length ? target : null,
    details: details && Object.keys(details).length ? details : null,
    durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : null,
    ip: clientIp(ctx.req),
    device: device(ctx.req?.headers?.["user-agent"]),
  };
  doc.text = describe(doc);
  await c.insertOne(doc);
}

/** A new session at sign-in; its id rides in the login token. */
export async function startSession(user, req) {
  const id = crypto.randomBytes(12).toString("hex");
  const now = new Date();
  await events();
  await sessions().insertOne({
    _id: id,
    ...who(user),
    startedAt: now,
    lastSeenAt: now,
    endedAt: null,
    endReason: null,
    ip: clientIp(req),
    device: device(req.headers["user-agent"]),
    tabs: {},
  });
  return id;
}

export async function endSession(id, reason) {
  if (!id) return null;
  const s = await sessions().findOne({ _id: id });
  if (!s || s.endedAt) return s;
  const now = new Date();
  await sessions().updateOne({ _id: id }, { $set: { endedAt: now, endReason: reason, lastSeenAt: now } });
  return { ...s, endedAt: now };
}

const lastTouch = new Map();
/** Any signed-in request keeps the session's "last seen" fresh (once a minute at most). */
export function touchSession(id) {
  if (!id || Date.now() - (lastTouch.get(id) || 0) < 60_000) return;
  lastTouch.set(id, Date.now());
  if (lastTouch.size > 5000) lastTouch.clear();
  sessions()
    .updateOne({ _id: id, endedAt: null }, { $set: { lastSeenAt: new Date() } })
    .catch(() => {});
}

/** Keeps short strings / numbers / booleans from the browser — nothing nested or huge. */
function clean(obj) {
  if (!obj || typeof obj !== "object") return null;
  const out = {};
  for (const [k, v] of Object.entries(obj).slice(0, 15)) {
    if (!/^[a-zA-Z0-9_]{1,30}$/.test(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, 300);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** The browser's events and its per-tab active / idle / hidden time. */
export async function recordClientEvents(req, body = {}) {
  const ctx = { user: req.user, sessionId: req.sessionId, req };
  const list = Array.isArray(body.events) ? body.events.slice(0, 50) : [];
  for (const e of list) {
    if (!ACTIONS[e?.action]?.client) continue;
    if (ACTIONS[e.action].cat === "presence" && !setting("audit.trackPresence")) continue;
    const at = new Date(e.at);
    await logAudit(ctx, {
      action: e.action,
      screen: typeof e.screen === "string" ? e.screen.slice(0, 30) : null,
      target: clean(e.target),
      details: clean(e.details),
      at: Math.abs(at - Date.now()) < 3600_000 ? at : new Date(),
      durationMs: Number(e.durationMs),
      tabId: String(e.tabId || "").slice(0, 20),
    });
  }
  const hb = body.heartbeat;
  if (req.sessionId && hb && !setting("audit.trackPresence")) {
    touchSession(req.sessionId);
  } else if (req.sessionId && hb && /^[a-z0-9]{4,20}$/i.test(String(hb.tabId || ""))) {
    const num = (v) => Math.max(0, Math.min(Number(v) || 0, 30 * 86400_000));
    await sessions().updateOne(
      { _id: req.sessionId },
      {
        $set: {
          lastSeenAt: new Date(),
          [`tabs.${hb.tabId}`]: { activeMs: num(hb.activeMs), idleMs: num(hb.idleMs), hiddenMs: num(hb.hiddenMs), screen: String(hb.screen || "").slice(0, 30), at: new Date() },
        },
      }
    );
  }
  return list.length;
}

// ---- Reading --------------------------------------------------------------------------

function range(q) {
  const from = DATE_RE.test(q.from || "") ? q.from : null;
  const to = DATE_RE.test(q.to || "") ? q.to : from;
  const at = {};
  if (from) at.$gte = new Date(`${from}T00:00:00+05:30`);
  if (to) at.$lt = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86400_000);
  return Object.keys(at).length ? at : null;
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function filterOf(q = {}) {
  const f = {};
  const at = range(q);
  if (at) f.at = at;
  if (q.user) f.user = String(q.user).toLowerCase();
  if (q.department) f.department = String(q.department);
  const cats = String(q.category || "").split(",").filter((c) => CATEGORIES.includes(c));
  if (cats.length) f.category = { $in: cats };
  else if (q.presence !== "show") f.category = { $ne: "presence" }; // tab / idle noise hidden unless asked
  if (q.session) f.sessionId = String(q.session);
  const text = String(q.q || "").trim().slice(0, 60);
  if (text) {
    const rx = { $regex: escapeRegex(text), $options: "i" };
    f.$or = [{ text: rx }, { "target.orderId": rx }, { "target.patientName": rx }, { "target.uhid": rx }, { userName: rx }, { user: rx }];
  }
  return f;
}

const publicEvent = ({ _id, ...e }) => ({ id: String(_id), ...e });

export async function listAuditEvents(q = {}) {
  const c = await events();
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 10), 500);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  const f = filterOf(q);
  const [total, docs] = await Promise.all([c.countDocuments(f), c.find(f).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).toArray()]);
  return { total, page, limit, items: docs.map(publicEvent) };
}

const tabTotals = (s) => {
  const t = Object.values(s.tabs || {});
  return {
    activeMs: t.reduce((a, x) => a + (x.activeMs || 0), 0),
    idleMs: t.reduce((a, x) => a + (x.idleMs || 0), 0),
    hiddenMs: t.reduce((a, x) => a + (x.hiddenMs || 0), 0),
  };
};

/** A session's end: signed out, or (no sign-out) last seen over 15 min ago. */
function sessionView(s) {
  const open = !s.endedAt && Date.now() - new Date(s.lastSeenAt).getTime() < 15 * 60_000;
  const end = s.endedAt || (open ? null : s.lastSeenAt);
  return {
    id: s._id,
    user: s.user,
    userName: s.userName,
    department: s.department,
    designation: s.designation,
    startedAt: s.startedAt,
    lastSeenAt: s.lastSeenAt,
    endedAt: end,
    open,
    endReason: s.endReason || (open ? null : "No sign-out (closed or timed out)"),
    durationMs: new Date(end || Date.now()) - new Date(s.startedAt),
    ip: s.ip,
    device: s.device,
    ...tabTotals(s),
  };
}

function sessionFilter(q) {
  const f = {};
  const at = range(q);
  if (at) f.startedAt = at;
  if (q.user) f.user = String(q.user).toLowerCase();
  if (q.department) f.department = String(q.department);
  return f;
}

export async function listAuditSessions(q = {}) {
  const list = await sessions().find(sessionFilter(q)).sort({ startedAt: -1 }).limit(500).toArray();
  const views = list.map(sessionView);
  const ids = views.map((s) => s.id);
  const counts = await (await events())
    .aggregate([{ $match: { sessionId: { $in: ids }, category: { $ne: "presence" } } }, { $group: { _id: "$sessionId", n: { $sum: 1 } } }])
    .toArray();
  const byId = new Map(counts.map((c) => [c._id, c.n]));
  return views.map((s) => ({ ...s, actions: byId.get(s.id) || 0 }));
}

const SENDS = ["whatsapp_send", "whatsapp_retry", "report_queue"];

/** Tiles + per-user and per-department tables. */
export async function auditSummary(q = {}) {
  const c = await events();
  const f = filterOf({ ...q, category: "", presence: "show" });
  const rows = await c
    .aggregate([
      { $match: f },
      {
        $group: {
          _id: { user: "$user", action: "$action" },
          n: { $sum: 1 },
          userName: { $last: "$userName" },
          department: { $last: "$department" },
          designation: { $last: "$designation" },
          last: { $max: "$at" },
        },
      },
    ])
    .toArray();
  const sess = await listAuditSessions(q);

  const users = new Map();
  const blank = (r) => ({
    user: r._id.user,
    userName: r.userName,
    department: r.department,
    designation: r.designation,
    lastAt: null,
    sessions: 0,
    activeMs: 0,
    idleMs: 0,
    hiddenMs: 0,
    actions: 0,
    whatsappSends: 0,
    pdfs: 0,
    exports: 0,
    failedLogins: 0,
  });
  for (const r of rows) {
    if (!r._id.user) continue;
    const u = users.get(r._id.user) || blank(r);
    if (!u.lastAt || r.last > u.lastAt) u.lastAt = r.last;
    if (ACTIONS[r._id.action]?.cat !== "presence") u.actions += r.n;
    if (SENDS.includes(r._id.action)) u.whatsappSends += r.n;
    if (r._id.action === "pdf_open") u.pdfs += r.n;
    if (r._id.action === "export") u.exports += r.n;
    users.set(r._id.user, u);
  }
  for (const s of sess) {
    const u = users.get(s.user) || blank({ _id: { user: s.user }, userName: s.userName, department: s.department, designation: s.designation });
    u.sessions += 1;
    u.activeMs += s.activeMs;
    u.idleMs += s.idleMs;
    u.hiddenMs += s.hiddenMs;
    if (!u.firstLoginAt || s.startedAt < u.firstLoginAt) u.firstLoginAt = s.startedAt;
    if (!u.lastAt || s.lastSeenAt > u.lastAt) u.lastAt = s.lastSeenAt;
    users.set(s.user, u);
  }
  const failed = await c
    .aggregate([{ $match: { ...filterOf({ ...q, category: "auth" }), action: "login_failed" } }, { $group: { _id: "$details.username", n: { $sum: 1 } } }])
    .toArray();
  for (const r of failed) {
    const u = users.get(String(r._id || "").toLowerCase());
    if (u) u.failedLogins += r.n;
  }

  const departments = new Map();
  for (const u of users.values()) {
    const d = departments.get(u.department) || { department: u.department, users: 0, sessions: 0, activeMs: 0, idleMs: 0, actions: 0, whatsappSends: 0, pdfs: 0 };
    d.users += 1;
    for (const k of ["sessions", "activeMs", "idleMs", "actions", "whatsappSends", "pdfs"]) d[k] += u[k];
    departments.set(u.department, d);
  }
  const userList = [...users.values()].sort((a, b) => new Date(b.lastAt || 0) - new Date(a.lastAt || 0));
  const total = (k) => userList.reduce((a, u) => a + (u[k] || 0), 0);
  return {
    tiles: {
      users: userList.length,
      sessions: sess.length,
      activeNow: sess.filter((s) => s.open).length,
      activeMs: total("activeMs"),
      idleMs: total("idleMs"),
      hiddenMs: total("hiddenMs"),
      actions: total("actions"),
      whatsappSends: total("whatsappSends"),
      pdfs: total("pdfs"),
      exports: total("exports"),
      failedLogins: failed.reduce((a, r) => a + r.n, 0),
    },
    users: userList,
    departments: [...departments.values()].sort((a, b) => b.actions - a.actions),
  };
}

export async function auditFilterOptions() {
  const c = await events();
  const [users, departments] = await Promise.all([
    c
      .aggregate([
        { $match: { user: { $ne: null } } },
        { $group: { _id: "$user", userName: { $last: "$userName" }, department: { $last: "$department" } } },
        { $sort: { userName: 1 } },
      ])
      .toArray(),
    c.distinct("department", { department: { $nin: [null, ""] } }),
  ]);
  return { users: users.map((u) => ({ user: u._id, userName: u.userName, department: u.department })), departments: departments.sort() };
}

// ---- Export ----------------------------------------------------------------------------

const istText = (d) =>
  d
    ? new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
        .format(new Date(d))
        .replace(",", "")
    : "";

const COLUMNS = [
  ["time", "Time (IST)"],
  ["userName", "User"],
  ["user", "Username"],
  ["department", "Department"],
  ["category", "Type"],
  ["text", "What happened"],
  ["patient", "Patient"],
  ["ids", "Order / UHID"],
  ["screen", "Screen"],
  ["device", "Device"],
  ["ip", "IP address"],
  ["sessionId", "Session"],
];

export async function exportAudit(q = {}) {
  const c = await events();
  const docs = await c.find(filterOf(q)).sort({ at: -1 }).limit(50_000).toArray();
  const rows = docs.map((d) => ({
    time: istText(d.at),
    userName: d.userName,
    user: d.user,
    department: d.department,
    category: d.category,
    text: d.text,
    patient: d.target?.patientName || "",
    ids: [d.target?.orderId, d.target?.uhid].filter(Boolean).join(" / "),
    screen: SCREEN_NAMES[d.screen] || d.screen || "",
    device: d.device,
    ip: d.ip,
    sessionId: d.sessionId || "",
  }));
  const quote = (v) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [COLUMNS.map(([, label]) => quote(label)).join(","), ...rows.map((r) => COLUMNS.map(([key]) => quote(r[key])).join(","))];
  const stamp = `${q.from || "all"}${q.to && q.to !== q.from ? `_to_${q.to}` : ""}`;
  return { body: `﻿${lines.join("\r\n")}\r\n`, fileName: `audit-log-${stamp}.csv`, contentType: "text/csv; charset=utf-8" };
}
