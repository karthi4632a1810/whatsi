import express from "express";
import { exportLabResults, labCoverage, searchLabResults, suggestTests } from "../services/labResults.js";

/** Lab Finder (services/labResults.js). Access: services/accessControl.js. */
const router = express.Router();

const fail = (res, error) => {
  if (!error.expose) console.error("[lab-finder]", error);
  res.status(error.status || 500).json({ ok: false, error: error.expose ? error.message : "Lab Finder couldn't search — please try again" });
};

router.get("/tests", async (req, res) => {
  try {
    res.json({ ok: true, tests: await suggestTests(String(req.query.q || "").slice(0, 60)) });
  } catch (error) {
    fail(res, error);
  }
});

router.get("/coverage", async (_req, res) => {
  try {
    res.json({ ok: true, ...(await labCoverage()) });
  } catch (error) {
    fail(res, error);
  }
});

router.post("/search", async (req, res) => {
  try {
    res.json({ ok: true, ...(await searchLabResults(req.body || {})) });
  } catch (error) {
    fail(res, error);
  }
});

router.post("/export", async (req, res) => {
  try {
    const file = await exportLabResults(req.body?.query || {});
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
    res.send(file.body);
  } catch (error) {
    fail(res, error);
  }
});

export default router;
