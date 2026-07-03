import express from "express";
import {
  createTemplate,
  deleteTemplate,
  getTemplateById,
  listTemplates,
  syncTemplatesFromWati,
  updateTemplate,
} from "../services/watiTemplates.js";
import { getWatiOverview } from "../services/watiStats.js";
import { listWatiContacts } from "../services/wati.js";

const router = express.Router();

router.get("/overview", async (_req, res) => {
  try {
    res.json(await getWatiOverview());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/contacts", async (_req, res) => {
  try {
    const contacts = await listWatiContacts();
    res.json({ contacts });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/templates", async (_req, res) => {
  const templates = await listTemplates();
  res.json({ templates });
});

router.post("/templates/sync", async (_req, res) => {
  try {
    const result = await syncTemplatesFromWati();
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/templates", async (req, res) => {
  try {
    const template = await createTemplate(req.body || {});
    res.status(201).json({ template });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/templates/:id", async (req, res) => {
  try {
    res.json({ template: await getTemplateById(req.params.id) });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

router.put("/templates/:id", async (req, res) => {
  try {
    const template = await updateTemplate(req.params.id, req.body || {});
    res.json({ template });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete("/templates/:id", async (req, res) => {
  try {
    res.json(await deleteTemplate(req.params.id));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
