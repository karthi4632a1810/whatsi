import express from "express";
import { publicSettings } from "../services/appSettings.js";
import { changeOwnPassword, publicUser } from "../services/users.js";
import { signToken } from "../middleware/auth.js";

const router = express.Router();

/** The signed-in user and the Master Settings every page needs — open pages poll this every minute. */
router.get("/", (req, res) => {
  res.json({ ok: true, user: publicUser(req.user), app: publicSettings() });
});

/** Their own password. Other sessions end; this one gets a fresh token. */
router.post("/password", async (req, res) => {
  try {
    const version = await changeOwnPassword(req.user._id, req.body?.current, req.body?.password);
    res.json({ ok: true, token: signToken({ _id: req.user._id, tokenVersion: version }, req.sessionId) });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.expose ? error.message : "Couldn't change the password" });
  }
});

export default router;
