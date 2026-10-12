/**
 * Master Settings (super admin): the portal-wide switches, sign-in rules,
 * audit retention and the announcement banner. Stored in Mongo
 * ("app_settings") and read from an in-memory copy, so any code can call
 * setting("auth.lockMinutes") synchronously. A value never set falls back to
 * the built-in default — nothing changes until someone changes it.
 *
 * When reports go out (delay, night hold, retries) stays in the Sending tab
 * (AutomationSettings, routes/settings.js).
 *
 * Global switches (features.*, maintenance.readOnly) sit above every staff
 * member's own permissions (applyGlobalSwitches); the super admin is never
 * limited by them.
 */
import mongoose from "mongoose";

const COLLECTION = "app_settings";
const DOC_ID = "master";
const HISTORY_KEEP = 100;

/** Sections, in the order the screen shows them. */
export const SECTIONS = [
  {
    id: "features",
    title: "Features for everyone",
    icon: "toggle",
    intro: "Switch a feature off for all staff at once — above each person’s own permissions. The super admin always keeps everything.",
  },
  { id: "board", title: "OP Lab Reports", icon: "clock", intro: "How the OP lab board keeps itself up to date on screen." },
  { id: "security", title: "Sign-in & security", icon: "lock", intro: "Sessions, wrong-password lockout and passwords for staff accounts." },
  { id: "audit", title: "Audit log", icon: "shield", intro: "What is recorded and for how long." },
  { id: "notice", title: "Announcement & maintenance", icon: "megaphone", intro: "A message at the top of every screen, and a read-only mode for maintenance." },
];

/**
 * Every setting. type: bool | number | select | text. `public`: sent to every
 * signed-in browser (switches, banner, timings).
 */
export const SETTINGS = [
  { key: "features.labSearch", section: "features", type: "bool", default: true, public: true, label: "Lab Search screen", help: "Off hides Lab Search for all staff." },
  { key: "features.labFinder", section: "features", type: "bool", default: true, public: true, label: "Lab Finder screen", help: "Off hides Lab Finder for all staff." },
  { key: "features.exports", section: "features", type: "bool", default: true, public: true, label: "Downloads & exports", help: "Off blocks CSV / JSON downloads of lists and logs for all staff (opening a patient’s own PDF still works)." },

  { key: "board.refreshSeconds", section: "board", type: "select", options: [10, 15, 30, 60, 120], unit: "sec", default: 15, public: true, label: "OP Lab Reports screen refreshes every", help: "Quietly, from the server board — it doesn’t call HIS each time." },

  { key: "auth.sessionHours", section: "security", type: "number", min: 1, max: 24, step: 1, unit: "hours", default: 12, label: "Stay signed in for", help: "After this, everyone signs in again. Applies to new sign-ins." },
  { key: "auth.idleSignOutMinutes", section: "security", type: "number", min: 0, max: 480, step: 5, unit: "min", default: 0, public: true, label: "Sign out after no activity for", help: "For shared computers: no mouse or keyboard for this long signs the person out. 0 = never." },
  { key: "auth.maxFailedLogins", section: "security", type: "number", min: 3, max: 20, step: 1, unit: "tries", default: 5, label: "Lock an account after wrong passwords", help: "Super admin accounts are never locked." },
  { key: "auth.lockMinutes", section: "security", type: "number", min: 5, max: 240, step: 5, unit: "min", default: 15, label: "Locked for", help: "Or unlock it straight away on the Users screen." },
  { key: "auth.minPasswordLength", section: "security", type: "number", min: 6, max: 32, step: 1, unit: "characters", default: 8, label: "Shortest password allowed", help: "For new and changed passwords." },

  { key: "audit.retentionDays", section: "audit", type: "number", min: 30, max: 1825, step: 30, unit: "days", default: 365, label: "Keep audit records for", help: "Older records are removed automatically." },
  { key: "audit.trackPresence", section: "audit", type: "bool", default: true, public: true, label: "Record tab switches and idle time", help: "Active / idle / away-from-tab time per session. Sign-ins, sends, retries, exports and settings are always recorded." },

  { key: "notice.text", section: "notice", type: "text", max: 240, default: "", public: true, label: "Announcement for everyone", help: "Shown at the top of every screen, e.g. “HIS maintenance tonight 10–11 pm — reports may be delayed.” Empty = none." },
  { key: "notice.tone", section: "notice", type: "select", options: ["info", "warning", "danger"], default: "info", public: true, label: "Announcement colour", help: "Blue (info), amber (warning) or red (urgent)." },
  { key: "maintenance.readOnly", section: "notice", type: "bool", default: false, public: true, label: "Read-only mode", help: "Staff can open and view everything but can’t send, retry, change settings or download. Automatic sending is paused too. Super admins are not affected." },
];

const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

function clamp(def, n) {
  let v = Math.round(Number(n) / (def.step || 1)) * (def.step || 1);
  if (def.min !== undefined) v = Math.max(def.min, v);
  if (def.max !== undefined) v = Math.min(def.max, v);
  return v;
}

/** A valid value for the setting, or throws with a message for the screen. */
export function validateSetting(def, value) {
  const fail = (msg) => {
    throw Object.assign(new Error(`${def.label}: ${msg}`), { status: 400, expose: true });
  };
  switch (def.type) {
    case "bool":
      if (typeof value !== "boolean") fail("must be on or off");
      return value;
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) fail("must be a number");
      if (n < def.min || n > def.max) fail(`must be between ${def.min} and ${def.max}`);
      return clamp(def, n);
    }
    case "select": {
      const match = def.options.find((o) => String(o) === String(value));
      if (match === undefined) fail(`must be one of ${def.options.join(", ")}`);
      return match;
    }
    case "text":
      return String(value ?? "").trim().slice(0, def.max || 500);
    default:
      return fail("unknown type");
  }
}

// ---- The in-memory copy ----------------------------------------------------------

let stored = {};
let meta = { updatedAt: null, updatedBy: null };
const listeners = [];

export function setting(key) {
  const def = BY_KEY.get(key);
  if (!def) throw new Error(`Unknown setting ${key}`);
  return Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : def.default;
}

/** Run something when settings change (e.g. the audit log's retention). */
export function onSettingsChange(fn) {
  listeners.push(fn);
}

const collection = () => mongoose.connection.collection(COLLECTION);

/** Mongo stores "auth.lockMinutes" under values.auth.lockMinutes — read back as flat keys. */
function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !BY_KEY.has(key)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

export async function loadSettings() {
  try {
    const doc = await collection().findOne({ _id: DOC_ID });
    const values = {};
    for (const [key, value] of Object.entries(flatten(doc?.values))) {
      const def = BY_KEY.get(key);
      if (!def) continue;
      try {
        values[key] = validateSetting(def, value);
      } catch {
        // an old / invalid value falls back to the default
      }
    }
    stored = values;
    meta = { updatedAt: doc?.updatedAt || null, updatedBy: doc?.updatedBy || null };
  } catch (error) {
    console.warn(`[settings] using defaults: ${error.message}`);
  }
  return stored;
}

/** Keeps the in-memory copy in step if another process saved (cheap: one small document). */
export function startSettingsRefresh() {
  setInterval(() => loadSettings().catch(() => {}), 60_000).unref?.();
}

const display = (def, v) =>
  def.type === "bool" ? (v ? "on" : "off") : def.type === "text" ? (v ? `“${String(v).slice(0, 60)}”` : "empty") : `${v}${def.unit ? ` ${def.unit}` : ""}`;

/**
 * Saves changes: { key: value } — null (or "default") resets a key.
 * Returns the full screen state plus what changed (for the audit log).
 */
export async function updateSettings(patch = {}, by) {
  const set = {};
  const unset = {};
  const changes = [];
  for (const [key, raw] of Object.entries(patch)) {
    const def = BY_KEY.get(key);
    if (!def) throw Object.assign(new Error(`Unknown setting ${key}`), { status: 400, expose: true });
    const before = setting(key);
    if (raw === null || raw === "default") {
      unset[`values.${key}`] = "";
      if (def.default !== before) changes.push({ key, label: def.label, from: display(def, before), to: `${display(def, def.default)} (default)` });
      continue;
    }
    const value = validateSetting(def, raw);
    set[`values.${key}`] = value;
    if (value !== before) changes.push({ key, label: def.label, from: display(def, before), to: display(def, value) });
  }
  const now = new Date();
  const update = { $set: { ...set, updatedAt: now, updatedBy: by || null } };
  if (Object.keys(unset).length) update.$unset = unset;
  if (changes.length) {
    update.$push = { history: { $each: changes.map((ch) => ({ ...ch, at: now, by: by || null })), $slice: -HISTORY_KEEP } };
  }
  await collection().updateOne({ _id: DOC_ID }, update, { upsert: true });
  await loadSettings();
  for (const fn of listeners) {
    try {
      await fn(changes);
    } catch (error) {
      console.warn(`[settings] after change: ${error.message}`);
    }
  }
  return { ...(await settingsScreen()), changes };
}

/** Everything the Master Settings screen needs. */
export async function settingsScreen() {
  const doc = await collection().findOne({ _id: DOC_ID }, { projection: { history: { $slice: -40 } } });
  return {
    sections: SECTIONS,
    settings: SETTINGS.map((def) => ({
      ...def,
      value: setting(def.key),
      baseValue: def.default,
      changed: Object.prototype.hasOwnProperty.call(stored, def.key),
    })),
    updatedAt: meta.updatedAt,
    updatedBy: meta.updatedBy,
    history: (doc?.history || []).slice().reverse(),
  };
}

/** What every signed-in browser gets (switches, banner, timings). */
export function publicSettings() {
  return Object.fromEntries(SETTINGS.filter((d) => d.public).map((d) => [d.key, setting(d.key)]));
}

/**
 * A staff member's permissions with the global switches applied — what they
 * can actually do right now. (Super admins aren't passed through this.)
 */
export function applyGlobalSwitches(p) {
  const out = { ...p, screens: { ...p.screens } };
  if (!setting("features.labSearch")) out.screens.search = "none";
  if (!setting("features.labFinder")) out.screens.labFinder = "none";
  out.exports = setting("features.exports");
  if (setting("maintenance.readOnly")) {
    for (const id of Object.keys(out.screens)) if (out.screens[id] === "write") out.screens[id] = "read";
    out.exports = false;
    out.readOnlyMode = true;
  }
  return out;
}

/** Read-only mode pauses automatic sending too (jobs/scheduler.js). */
export const isReadOnlyMode = () => Boolean(setting("maintenance.readOnly"));
