/**
 * Staff accounts and what each one may do (role-based access).
 *
 * - role "admin" is a super admin: full access, manages users and Master
 *   Settings, can't be disabled, locked or deleted from the Users screen — so
 *   nobody can lock the hospital out. Create one with `npm run seed`.
 * - Everyone else has a permission set: each screen off / view only / view &
 *   send (or edit), and optional access hours (days + time, India time).
 *
 * Accounts are re-read on every request (short cache), so a change applies at
 * once; a password reset or "sign out everywhere" bumps tokenVersion, which
 * ends that user's existing sessions.
 */
import bcrypt from "bcryptjs";
import { User } from "../models/index.js";
import { applyGlobalSwitches, setting } from "./appSettings.js";

const CACHE_MS = 5_000;
export const minPasswordLength = () => setting("auth.minPasswordLength");

// ---- Permission model ------------------------------------------------------

/** Screens, in menu order. `write` says what the higher level adds on that screen. */
export const SCREENS = [
  { id: "reports", label: "OP Lab Reports", write: "Refresh from HIS, sync the queue, and send, retry or cancel reports on WhatsApp" },
  { id: "search", label: "Lab Search", write: null },
  { id: "labFinder", label: "Lab Finder", write: null },
  { id: "wati", label: "WATI Settings", write: "Switch WhatsApp Off / Test / Live, set the test numbers, edit templates and contacts" },
  { id: "monitor", label: "WhatsApp Monitor", write: "Retry failed messages and ask WATI for the latest ticks" },
  { id: "audit", label: "Audit Log", write: null, note: "Everyone's sign-ins, screens and actions" },
];
const SCREEN_IDS = SCREENS.map((s) => s.id);
const READ_ONLY_SCREENS = new Set(SCREENS.filter((s) => !s.write).map((s) => s.id));
const LEVELS = ["none", "read", "write"];
export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // ISO order: 1 = Mon … 7 = Sun

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const screens = (levels) => Object.fromEntries(SCREEN_IDS.map((id) => [id, levels[id] || "none"]));
const ANY_TIME = { enabled: false, days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00" };

export const FULL_PERMISSIONS = {
  screens: screens({ reports: "write", search: "read", labFinder: "read", wati: "write", monitor: "write", audit: "read" }),
  schedule: { ...ANY_TIME },
};

/** Starting points in the user editor; everything stays adjustable. */
export const PRESETS = [
  { id: "admin", label: "Admin", description: "Everything except users and Master Settings", permissions: FULL_PERMISSIONS },
  {
    id: "lab",
    label: "Lab staff",
    description: "OP reports, Lab Search and Lab Finder; sends reports",
    permissions: { screens: screens({ reports: "write", search: "read", labFinder: "read" }), schedule: { ...ANY_TIME } },
  },
  {
    id: "doctor",
    label: "Doctor",
    description: "Reads reports and lab results",
    permissions: { screens: screens({ reports: "read", search: "read", labFinder: "read" }), schedule: { ...ANY_TIME } },
  },
  {
    id: "frontdesk",
    label: "Front desk",
    description: "Sends reports on WhatsApp, Mon–Sat 8 am – 8 pm",
    permissions: {
      screens: screens({ reports: "write", monitor: "read" }),
      schedule: { enabled: true, days: [1, 2, 3, 4, 5, 6], from: "08:00", to: "20:00" },
    },
  },
  {
    id: "viewer",
    label: "View only",
    description: "Opens reports and the monitor, changes nothing",
    permissions: { screens: screens({ reports: "read", monitor: "read" }), schedule: { ...ANY_TIME } },
  },
];

const DEFAULT_PERMISSIONS = PRESETS.find((p) => p.id === "viewer").permissions;

/** A complete, valid permission set from whatever the editor sent. */
export function normalizePermissions(input = {}) {
  const base = DEFAULT_PERMISSIONS;
  const out = { screens: {}, schedule: { ...base.schedule } };
  // No permissions at all → the View only preset; a screen missing from a given set → no access.
  const given = input?.screens && typeof input.screens === "object";
  for (const id of SCREEN_IDS) {
    let level = LEVELS.includes(input?.screens?.[id]) ? input.screens[id] : given ? "none" : base.screens[id];
    if (READ_ONLY_SCREENS.has(id) && level === "write") level = "read"; // nothing to write there
    out.screens[id] = level;
  }
  const s = input?.schedule || {};
  const days = Array.isArray(s.days) ? [...new Set(s.days.map(Number).filter((d) => d >= 1 && d <= 7))].sort() : base.schedule.days;
  out.schedule = {
    enabled: Boolean(s.enabled),
    days: days.length ? days : [1, 2, 3, 4, 5],
    from: TIME_RE.test(s.from) ? s.from : "09:00",
    to: TIME_RE.test(s.to) ? s.to : "18:00",
  };
  return out;
}

// ---- Access hours ------------------------------------------------------------

/** India time now: ISO weekday (1 = Mon) and minutes since midnight. */
function istClock(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return { day: ((ist.getUTCDay() + 6) % 7) + 1, minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes() };
}

const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Whether the schedule allows access now. Handles overnight windows (e.g. 20:00–08:00). */
export function scheduleAllows(schedule, now = new Date()) {
  if (!schedule?.enabled) return true;
  const { day, minutes } = istClock(now);
  const from = toMinutes(schedule.from);
  const to = toMinutes(schedule.to);
  const days = new Set(schedule.days);
  if (from === to) return days.has(day); // whole day
  if (from < to) return days.has(day) && minutes >= from && minutes < to;
  const yesterday = day === 1 ? 7 : day - 1;
  return (days.has(day) && minutes >= from) || (days.has(yesterday) && minutes < to);
}

/** "Mon–Fri, 09:00–18:00" / "Mon, Wed, Fri, 08:00–14:00" / "Any time". */
export function describeSchedule(schedule) {
  if (!schedule?.enabled) return "Any time";
  const days = [...schedule.days].sort();
  const runs = [];
  for (const d of days) {
    const last = runs[runs.length - 1];
    if (last && d === last[1] + 1) last[1] = d;
    else runs.push([d, d]);
  }
  const name = (d) => DAY_NAMES[d - 1];
  const dayText =
    days.length === 7
      ? "Every day"
      : runs.map(([a, b]) => (a === b ? name(a) : b === a + 1 ? `${name(a)}, ${name(b)}` : `${name(a)}–${name(b)}`)).join(", ");
  const time = schedule.from === schedule.to ? "all day" : `${schedule.from}–${schedule.to}`;
  return `${dayText}, ${time}`;
}

// ---- Accounts --------------------------------------------------------------------

const httpError = (message, status = 400, code) => Object.assign(new Error(message), { status, code, expose: true });
const normalizeLogin = (v) => String(v || "").trim().toLowerCase();
// A database account (role) or one already shaped by publicUser (isSuperAdmin).
export const isSuperAdmin = (user) => user?.role === "admin" || user?.isSuperAdmin === true;

function checkPasswordRules(password) {
  if (String(password || "").length < minPasswordLength()) {
    throw httpError(`Password must be at least ${minPasswordLength()} characters`);
  }
}

const PROFILE_FIELDS = ["name", "designation", "department", "phone", "email"];

function cleanProfile(input = {}) {
  const out = {};
  for (const key of PROFILE_FIELDS) {
    if (input[key] !== undefined) out[key] = String(input[key] || "").trim().slice(0, 120);
  }
  if (out.email !== undefined) {
    out.email = out.email.toLowerCase();
    if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw httpError("That email address doesn't look right");
  }
  return out;
}

/** The permissions a user really has right now (global switches applied). */
export function effectivePermissions(user) {
  if (isSuperAdmin(user)) return { ...FULL_PERMISSIONS, exports: true };
  return applyGlobalSwitches(normalizePermissions(user?.permissions));
}

/** What the browser gets — never the password hash. */
export function publicUser(user) {
  if (!user) return null;
  const superAdmin = isSuperAdmin(user);
  const permissions = superAdmin ? FULL_PERMISSIONS : normalizePermissions(user.permissions);
  return {
    id: String(user._id),
    username: user.username || user.email || "",
    name: user.name || user.username || user.email || "",
    designation: superAdmin && !user.designation ? "Super admin" : user.designation || "",
    department: user.department || "",
    phone: user.phone || "",
    email: user.email || "",
    isSuperAdmin: superAdmin,
    active: user.active !== false,
    mustChangePassword: Boolean(user.mustChangePassword),
    minPasswordLength: minPasswordLength(),
    // What they can do right now; `permissions` stays their own, for editing.
    effective: effectivePermissions(user),
    permissions,
    scheduleText: describeSchedule(permissions.schedule),
    allowedNow: superAdmin || scheduleAllows(permissions.schedule),
    lockedUntil: user.lockedUntil && new Date(user.lockedUntil) > new Date() ? user.lockedUntil : null,
    lastLoginAt: user.lastLoginAt || null,
    lastLoginIp: user.lastLoginIp || null,
    loginCount: user.loginCount || 0,
    createdAt: user.createdAt || null,
    createdBy: user.createdBy || null,
    updatedAt: user.updatedAt || null,
    updatedBy: user.updatedBy || null,
  };
}

const cache = new Map();
export const forgetUser = (id) => cache.delete(String(id));

/** The account behind a session, or null if it's gone or signed out everywhere. */
export async function resolveSessionUser(id, tokenVersion = 0) {
  const key = String(id || "");
  if (!key) return null;
  let entry = cache.get(key);
  if (!entry || Date.now() - entry.at > CACHE_MS) {
    const user = await User.findById(key).lean().catch(() => null);
    entry = { at: Date.now(), user };
    cache.set(key, entry);
    if (cache.size > 5000) cache.clear();
  }
  const user = entry.user;
  if (!user || (user.tokenVersion || 0) !== (tokenVersion || 0)) return null;
  return user;
}

/** Checks a sign-in by username or email. Returns the user, or throws with a message for the login screen. */
export async function authenticate(login, password, ip) {
  const key = normalizeLogin(login);
  if (!key || !password) throw httpError("Username and password are required", 400, "missing");

  const user = await User.findOne({ $or: [{ username: key }, { email: key }] }).lean();
  // Same message for an unknown user and a wrong password.
  if (!user) throw httpError("Invalid username or password", 401, "invalid");
  const superAdmin = isSuperAdmin(user);
  if (!superAdmin && user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    const mins = Math.ceil((new Date(user.lockedUntil) - Date.now()) / 60_000);
    throw httpError(`Too many wrong passwords — try again in ${mins} minute${mins === 1 ? "" : "s"}, or ask the super admin to unlock it`, 423, "locked");
  }
  if (!(await bcrypt.compare(String(password), user.passwordHash))) {
    if (superAdmin) throw httpError("Invalid username or password", 401, "invalid");
    const failed = (user.failedLogins || 0) + 1;
    const lock = failed >= setting("auth.maxFailedLogins");
    await User.updateOne(
      { _id: user._id },
      { $set: { failedLogins: lock ? 0 : failed, ...(lock ? { lockedUntil: new Date(Date.now() + setting("auth.lockMinutes") * 60_000) } : {}) } }
    );
    forgetUser(user._id);
    if (lock) throw httpError(`Too many wrong passwords — the account is locked for ${setting("auth.lockMinutes")} minutes`, 423, "locked");
    throw httpError("Invalid username or password", 401, "invalid");
  }
  if (user.active === false) throw httpError("This account is disabled — ask the super admin", 403, "disabled");
  if (!superAdmin) {
    const schedule = normalizePermissions(user.permissions).schedule;
    if (!scheduleAllows(schedule)) throw httpError(`Your access hours are ${describeSchedule(schedule)} (India time)`, 403, "outside_hours");
  }
  await User.updateOne(
    { _id: user._id },
    { $set: { lastLoginAt: new Date(), lastLoginIp: String(ip || "").slice(0, 100), failedLogins: 0, lockedUntil: null }, $inc: { loginCount: 1 } }
  );
  forgetUser(user._id);
  return user;
}

export async function listUsers() {
  const users = await User.find({}).sort({ role: 1, createdAt: 1 }).lean();
  return users.map(publicUser);
}

async function findByUsername(username) {
  const key = normalizeLogin(username);
  return User.findOne({ $or: [{ username: key }, { email: key }] });
}

async function staffAccount(username) {
  const user = await findByUsername(username);
  if (!user) throw httpError("User not found", 404);
  if (isSuperAdmin(user)) throw httpError("Super admin accounts always have full access and are managed with `npm run seed`");
  return user;
}

export async function createUser(input = {}, by) {
  const username = normalizeLogin(input.username);
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw httpError("Username: 3–32 letters, numbers, dot, dash or underscore");
  checkPasswordRules(input.password);
  const profile = cleanProfile(input);
  if (await User.exists({ $or: [{ username }, { email: username }] })) throw httpError("That username is already taken", 409);
  if (profile.email && (await User.exists({ $or: [{ email: profile.email }, { username: profile.email }] }))) {
    throw httpError("Another account already uses that email", 409);
  }
  const doc = await User.create({
    username,
    ...profile,
    email: profile.email || undefined,
    name: profile.name || username,
    role: "staff",
    active: input.active !== false,
    permissions: normalizePermissions(input.permissions),
    passwordHash: await bcrypt.hash(String(input.password), 10),
    mustChangePassword: input.mustChangePassword !== false,
    createdBy: by || "",
    updatedBy: by || "",
  });
  return publicUser(doc.toObject());
}

export async function updateUser(username, input = {}, by) {
  const user = await staffAccount(username);
  const profile = cleanProfile(input);
  if (profile.email && profile.email !== user.email) {
    if (await User.exists({ _id: { $ne: user._id }, $or: [{ email: profile.email }, { username: profile.email }] })) {
      throw httpError("Another account already uses that email", 409);
    }
  }
  const set = { ...profile, updatedBy: by || "" };
  const unset = {};
  if (set.email === "") {
    delete set.email;
    unset.email = "";
  }
  if (input.permissions) set.permissions = normalizePermissions(input.permissions);
  if (typeof input.active === "boolean") set.active = input.active;
  if (input.unlock) Object.assign(set, { lockedUntil: null, failedLogins: 0 });
  await User.updateOne({ _id: user._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
  forgetUser(user._id);
  return publicUser(await User.findById(user._id).lean());
}

/**
 * Sets a new password and signs the user out everywhere. A reset by the super
 * admin (mustChange) makes them choose their own at the next sign-in.
 */
export async function setPassword(username, password, by, { mustChange = false } = {}) {
  const user = await staffAccount(username);
  await writePassword(user._id, password, by, mustChange);
}

async function writePassword(id, password, by, mustChange) {
  checkPasswordRules(password);
  await User.updateOne(
    { _id: id },
    {
      $set: {
        passwordHash: await bcrypt.hash(String(password), 10),
        passwordChangedAt: new Date(),
        mustChangePassword: Boolean(mustChange),
        updatedBy: by || "",
        lockedUntil: null,
        failedLogins: 0,
      },
      $inc: { tokenVersion: 1 },
    }
  );
  forgetUser(id);
}

/** Changes the signed-in person's own password; returns the new tokenVersion. */
export async function changeOwnPassword(id, current, next) {
  const user = await User.findById(id).lean();
  if (!user || !(await bcrypt.compare(String(current || ""), user.passwordHash))) throw httpError("Your current password is wrong", 403);
  if (String(current) === String(next)) throw httpError("Choose a new password — not the one you were given");
  await writePassword(user._id, next, user.username || user.email, false);
  return (await User.findById(user._id).select("tokenVersion").lean()).tokenVersion || 0;
}

/** Ends every session of this user (their next click shows the login screen). */
export async function signOutEverywhere(username, by) {
  const user = await staffAccount(username);
  await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 }, $set: { updatedBy: by || "" } });
  forgetUser(user._id);
}

export async function deleteUser(username) {
  const user = await staffAccount(username);
  await User.deleteOne({ _id: user._id });
  forgetUser(user._id);
}

/** For the user editor: screens, presets, choices. */
export function accessModel() {
  return { screens: SCREENS, presets: PRESETS, days: DAY_NAMES, minPasswordLength: minPasswordLength() };
}

/**
 * Once at start-up: replaces the old unique email index (email is optional now)
 * and gives older accounts a username (the part of their email before the @).
 */
export async function migrateUsers() {
  const indexes = await User.collection.indexes().catch(() => []);
  const oldEmail = indexes.find((i) => i.name === "email_1" && !i.partialFilterExpression);
  if (oldEmail) await User.collection.dropIndex("email_1");
  await User.createIndexes();

  const missing = await User.find({ $or: [{ username: { $exists: false } }, { username: null }, { username: "" }] }).lean();
  for (const user of missing) {
    const base = (String(user.email || "user").split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "") || "user").slice(0, 28).padEnd(3, "0");
    let name = base;
    for (let n = 2; await User.exists({ $or: [{ username: name }, { email: name }] }); n += 1) name = `${base}${n}`;
    await User.updateOne({ _id: user._id }, { $set: { username: name } });
    console.log(`[users] ${user.email || user._id} can now also sign in as "${name}"`);
  }

  // Staff accounts from before permissions existed could use every screen; keep
  // that (all but Users and Settings) until a super admin narrows it on Users.
  const unset = await User.updateMany(
    { role: { $ne: "admin" }, $or: [{ permissions: null }, { permissions: { $exists: false } }] },
    { $set: { permissions: FULL_PERMISSIONS } }
  );
  if (unset.modifiedCount) console.log(`[users] ${unset.modifiedCount} older staff account(s) given the Admin preset — adjust them on Users`);
}
