import express from "express";
import {
  CATEGORIES,
  auditFilterOptions,
  auditSummary,
  exportAudit,
  listAuditEvents,
  listAuditSessions,
  recordClientEvents,
} from "../services/audit.js";

/**
 * The browser's own audit events (screens, idle time) and the Audit Log
 * screen's data and download. Access: services/accessControl.js.
 */
const router = express.Router();

router.post("/events", async (req, res) => {
  try {
    res.json({ ok: true, recorded: await recordClientEvents(req, req.body || {}) });
  } catch (error) {
    res.status(400).json({ ok: false, error: "Couldn't record audit events" });
    console.warn("[audit] client events:", error.message);
  }
});

const query = (req) => ({
  from: req.query.from,
  to: req.query.to,
  user: req.query.user,
  department: req.query.department,
  category: req.query.category,
  session: req.query.session,
  presence: req.query.presence,
  q: req.query.q,
  page: req.query.page,
  limit: req.query.limit,
});
const route = (fn) => async (req, res) => {
  try {
    res.json({ ok: true, ...(await fn(req)) });
  } catch (error) {
    console.error("[audit]", error);
    res.status(500).json({ ok: false, error: "Couldn't read the audit log" });
  }
};

router.get("/summary", route(async (req) => auditSummary(query(req))));
router.get("/events", route(async (req) => listAuditEvents(query(req))));
router.get("/sessions", route(async (req) => ({ sessions: await listAuditSessions(query(req)) })));
router.get("/options", route(async () => ({ ...(await auditFilterOptions()), categories: CATEGORIES })));
router.get("/export", async (req, res) => {
  try {
    const file = await exportAudit(query(req));
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
    res.send(file.body);
  } catch (error) {
    console.error("[audit] export", error);
    res.status(500).json({ ok: false, error: "Couldn't export the audit log" });
  }
});

export default router;
