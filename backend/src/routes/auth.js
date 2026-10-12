import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { User } from "../models/index.js";
import { authRequired, forgetUser } from "../middleware/auth.js";

const router = express.Router();

// 5 wrong passwords for the same email from the same address → 15 minutes locked.
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const failures = new Map();

function attemptKey(req, email) {
  return `${req.ip}|${email}`;
}

router.post("/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const key = attemptKey(req, email);
  const entry = failures.get(key);
  if (entry?.lockedUntil > Date.now()) {
    const minutes = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({ error: `Too many wrong passwords — try again in ${minutes} minute(s)` });
  }
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    const count = (entry?.count || 0) + 1;
    failures.set(key, { count, lockedUntil: count >= MAX_FAILURES ? Date.now() + LOCK_MS : 0 });
    if (failures.size > 10_000) failures.clear();
    return res.status(401).json({ error: "Invalid email or password" });
  }
  failures.delete(key);
  res.json({
    token: signToken(user),
    user: { id: user._id, email: user.email, name: user.name, role: user.role },
  });
});

export function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), email: user.email, role: user.role, v: user.tokenVersion || 0 },
    config.jwtSecret,
    { expiresIn: "12h" }
  );
}

const MIN_PASSWORD = 8;

/** Signed-in staff change their own password; every other session of theirs ends. */
router.post("/change-password", authRequired, async (req, res) => {
  const current = String(req.body?.currentPassword || "");
  const next = String(req.body?.newPassword || "");
  if (next.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `The new password needs at least ${MIN_PASSWORD} characters` });
  }
  if (next === current) return res.status(400).json({ error: "The new password must be different" });
  const user = await User.findById(req.user.sub);
  if (!user || !(await bcrypt.compare(current, user.passwordHash))) {
    return res.status(400).json({ error: "Your current password is not right" });
  }
  user.passwordHash = await bcrypt.hash(next, 10);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  user.passwordChangedAt = new Date();
  await user.save();
  forgetUser(user._id);
  res.json({ ok: true, token: signToken(user) });
});

/** Ends every session of the signed-in user, including this one. */
router.post("/sign-out-everywhere", authRequired, async (req, res) => {
  await User.updateOne({ _id: req.user.sub }, { $inc: { tokenVersion: 1 } });
  forgetUser(req.user.sub);
  res.json({ ok: true });
});

export default router;
