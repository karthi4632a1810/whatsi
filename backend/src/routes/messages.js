import express from "express";
import { MessageLog } from "../models/index.js";
import { sendReportById } from "../services/reports.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const query = {};
  if (req.query.status) query.status = String(req.query.status).toUpperCase();
  const messages = await MessageLog.find(query).sort({ sentAt: -1 }).limit(500);
  res.json({ messages });
});

router.post("/:id/retry", async (req, res) => {
  const log = await MessageLog.findById(req.params.id);
  if (!log?.reportRef) return res.status(404).json({ error: "Message log not found" });
  try {
    const result = await sendReportById(log.reportRef, { triggerType: "MANUAL", force: true });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/stats/daily", async (_req, res) => {
  const rows = await MessageLog.aggregate([
    {
      $group: {
        _id: {
          day: { $dateToString: { format: "%Y-%m-%d", date: "$sentAt" } },
          status: "$status",
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { "_id.day": -1 } },
    { $limit: 30 },
  ]);
  res.json({ rows });
});

export default router;
