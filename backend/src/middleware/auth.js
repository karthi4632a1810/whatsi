import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { setting } from "../services/appSettings.js";
import { checkRoute } from "../services/accessControl.js";
import { touchSession } from "../services/audit.js";
import { describeSchedule, isSuperAdmin, normalizePermissions, resolveSessionUser, scheduleAllows } from "../services/users.js";

export { forgetUser } from "../services/users.js";

/**
 * A login token: `v` is the user's tokenVersion (a password reset or "sign out
 * everywhere" bumps it, and older tokens stop working); `sid` is the audit
 * session (services/audit.js) — sign-in to sign-out.
 */
export function signToken(user, sid = null) {
  return jwt.sign({ sub: String(user._id), v: user.tokenVersion || 0, sid }, config.jwtSecret, {
    expiresIn: `${setting("auth.sessionHours")}h`,
  });
}

/** { sub, v, sid } from a valid Bearer token, or null. */
export function readClaims(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

// Allowed while a temporary password still has to be replaced.
const PASSWORD_PATHS = new Set(["/api/me", "/api/me/password"]);

/**
 * Every /api route after this needs a valid token for an active account inside
 * its access hours — then the route's permission (services/accessControl.js).
 */
export async function authRequired(req, res, next) {
  const claims = readClaims(req);
  if (!claims) return res.status(401).json({ error: "Session expired — please log in again" });
  let user;
  try {
    user = await resolveSessionUser(claims.sub, claims.v);
  } catch (error) {
    return next(error);
  }
  // Account deleted or disabled, or password changed / signed out everywhere since this token was issued.
  if (!user || user.active === false) return res.status(401).json({ error: "Session ended — please log in again" });
  if (!isSuperAdmin(user)) {
    const schedule = normalizePermissions(user.permissions).schedule;
    if (!scheduleAllows(schedule)) {
      return res.status(401).json({ code: "outside_hours", error: `Your access hours are ${describeSchedule(schedule)} (India time)` });
    }
  }
  // `email` stays the "sent by" name the send code records.
  req.user = { ...user, sub: String(user._id), email: user.email || user.username };
  req.sessionId = claims.sid || null;
  touchSession(req.sessionId);

  const path = `${req.baseUrl}${req.path}`.replace(/\/+$/, "") || "/";
  if (user.mustChangePassword && !PASSWORD_PATHS.has(path)) {
    return res.status(403).json({ code: "must_change_password", error: "Choose your own password first" });
  }
  const ok = checkRoute(user, req.method === "HEAD" ? "GET" : req.method, path);
  if (ok !== true) {
    return res.status(403).json({ code: "forbidden", error: `Not allowed — ${ok}. Ask the super admin if you need it.` });
  }
  next();
}
