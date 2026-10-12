import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { User } from "../models/index.js";

// Short cache so every API call doesn't hit the database; a password change
// clears the entry at once (forgetUser).
const CACHE_MS = 10_000;
const cache = new Map();

async function currentTokenVersion(userId) {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.version;
  const user = await User.findById(userId).select("tokenVersion").lean();
  const version = user ? user.tokenVersion || 0 : null;
  cache.set(userId, { version, at: Date.now() });
  if (cache.size > 5000) cache.clear();
  return version;
}

export function forgetUser(userId) {
  cache.delete(String(userId));
}

export async function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  let claims;
  try {
    claims = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: "Session expired — please log in again" });
  }
  try {
    const version = await currentTokenVersion(String(claims.sub));
    // Account deleted, or password changed / signed out everywhere since this token was issued.
    if (version === null || (claims.v || 0) !== version) {
      return res.status(401).json({ error: "Session ended — please log in again" });
    }
  } catch (error) {
    return next(error);
  }
  req.user = claims;
  next();
}
