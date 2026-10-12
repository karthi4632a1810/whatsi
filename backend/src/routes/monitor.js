import express from "express";
import {
  monitorActivity,
  monitorExport,
  monitorInsights,
  monitorMessage,
  monitorMessages,
  monitorPatients,
  monitorRefresh,
  monitorRetry,
  monitorSummary,
  monitorWati,
} from "../services/monitor.js";

// WhatsApp Monitor (OP lab reports) — same endpoints as the investigation
// portal's monitor, under /api/monitor.
const router = express.Router();

const wrap = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    res.status(error.status || (error.blocked ? 400 : 500)).json({ ok: false, error: error.message, code: error.code });
  }
};

router.get("/summary", wrap(async (req, res) => res.json(await monitorSummary(req.query))));
router.get("/insights", wrap(async (req, res) => res.json(await monitorInsights(req.query))));
router.get("/messages", wrap(async (req, res) => res.json(await monitorMessages(req.query))));
router.get("/patients", wrap(async (req, res) => res.json(await monitorPatients(req.query))));
router.get("/activity", wrap(async (req, res) => res.json({ events: await monitorActivity(Number(req.query.limit) || 20) })));
router.get("/wati", wrap(async (_req, res) => res.json(await monitorWati())));
router.post("/refresh", wrap(async (_req, res) => res.json(await monitorRefresh())));

router.get(
  "/messages/:id",
  wrap(async (req, res) => {
    const message = await monitorMessage(String(req.params.id));
    if (!message) return res.status(404).json({ ok: false, error: "Message not found" });
    res.json({ message });
  })
);

router.post(
  "/messages/:id/retry",
  wrap(async (req, res) => res.json(await monitorRetry(String(req.params.id), req.user?.email || "")))
);

router.get(
  "/export",
  wrap(async (req, res) => {
    const file = await monitorExport(req.query);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
    res.send(file.body);
  })
);

export default router;
