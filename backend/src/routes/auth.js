import express from "express";
import { publicSettings } from "../services/appSettings.js";
import { endSession, startSession } from "../services/audit.js";
import { authenticate, publicUser } from "../services/users.js";
import { readClaims, signToken } from "../middleware/auth.js";

const router = express.Router();

/** Sign in with a username or email. Lockout, disabled accounts and access hours: services/users.js. */
router.post("/login", async (req, res) => {
  const login = req.body?.username ?? req.body?.email;
  try {
    const user = await authenticate(login, req.body?.password, req.ip);
    // A new audit session (sign-in → sign-out), carried in the token.
    const sid = await startSession(user, req).catch(() => null);
    req.sessionId = sid;
    res.json({ ok: true, token: signToken(user, sid), user: publicUser(user), app: publicSettings() });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, code: error.code, error: error.expose ? error.message : "Sign-in failed — please try again" });
  }
});

/** Ends the audit session; the browser drops its token. */
router.post("/logout", async (req, res) => {
  const claims = readClaims(req);
  if (claims?.sid) {
    const s = await endSession(claims.sid, "Signed out").catch(() => null);
    if (s?.startedAt) res.locals.sessionMs = Date.now() - new Date(s.startedAt).getTime();
  }
  res.json({ ok: true });
});

export default router;
