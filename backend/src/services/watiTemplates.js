import { WatiTemplate } from "../models/index.js";
import { watiGet } from "./wati.js";

function extractTemplateList(data) {
  if (Array.isArray(data?.messageTemplates)) return data.messageTemplates;
  if (Array.isArray(data?.templates)) return data.templates;
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data)) return data;
  return [];
}

function mapWatiRemoteTemplate(tpl) {
  const name = tpl.elementName || tpl.name || "";
  const params = [];
  const sources = [tpl.customParams, tpl.parameters].filter(Array.isArray);
  for (const list of sources) {
    for (const p of list) {
      const paramName = p?.paramName || p?.name;
      if (paramName && !params.some((x) => x.name === paramName)) {
        params.push({ name: paramName, example: p?.example || "" });
      }
    }
  }
  return {
    name,
    displayName: tpl.elementName || tpl.name || "",
    category: tpl.category || "UTILITY",
    language: tpl.language?.value || tpl.language || "en",
    status: tpl.status === "APPROVED" ? "ACTIVE" : "INACTIVE",
    parameters: params,
    bodyPreview: tpl.bodyOriginal || tpl.body || "",
    source: "WATI",
    watiStatus: tpl.status || "",
    lastSyncedAt: new Date(),
  };
}

export async function listTemplates() {
  return WatiTemplate.find().sort({ isDefault: -1, name: 1 });
}

export async function getTemplateById(id) {
  const tpl = await WatiTemplate.findById(id);
  if (!tpl) throw new Error("Template not found");
  return tpl;
}

export async function createTemplate(payload) {
  const name = String(payload.name || "").trim();
  if (!name) throw new Error("Template name is required");

  const existing = await WatiTemplate.findOne({ name });
  if (existing) throw new Error("Template name already exists");

  if (payload.isDefault) {
    await WatiTemplate.updateMany({}, { $set: { isDefault: false } });
  }

  return WatiTemplate.create({
    name,
    displayName: payload.displayName || name,
    category: payload.category || "LAB",
    language: payload.language || "en",
    status: payload.status || "ACTIVE",
    parameters: payload.parameters || [],
    bodyPreview: payload.bodyPreview || "",
    isDefault: Boolean(payload.isDefault),
    notes: payload.notes || "",
    source: "LOCAL",
  });
}

export async function updateTemplate(id, payload) {
  const tpl = await getTemplateById(id);
  if (payload.isDefault) {
    await WatiTemplate.updateMany({ _id: { $ne: id } }, { $set: { isDefault: false } });
  }

  const fields = [
    "displayName",
    "category",
    "language",
    "status",
    "parameters",
    "bodyPreview",
    "isDefault",
    "notes",
  ];
  for (const key of fields) {
    if (payload[key] !== undefined) tpl[key] = payload[key];
  }
  await tpl.save();
  return tpl;
}

export async function deleteTemplate(id) {
  const tpl = await getTemplateById(id);
  if (tpl.isDefault) {
    throw new Error("Cannot delete the default template — set another default first");
  }
  await tpl.deleteOne();
  return { deleted: true };
}

export async function syncTemplatesFromWati() {
  const result = await watiGet("api/v1/getMessageTemplates");
  if (!result.response.ok) {
    throw new Error(`WATI template sync failed (${result.response.status})`);
  }

  const remote = extractTemplateList(result.data);
  let created = 0;
  let updated = 0;

  for (const item of remote) {
    const mapped = mapWatiRemoteTemplate(item);
    if (!mapped.name) continue;

    const existing = await WatiTemplate.findOne({ name: mapped.name });
    if (existing) {
      existing.displayName = mapped.displayName;
      existing.category = mapped.category;
      existing.language = mapped.language;
      existing.parameters = mapped.parameters;
      existing.bodyPreview = mapped.bodyPreview;
      existing.source = "WATI";
      existing.watiStatus = mapped.watiStatus;
      existing.lastSyncedAt = mapped.lastSyncedAt;
      if (existing.status === "DRAFT") existing.status = mapped.status;
      await existing.save();
      updated += 1;
    } else {
      await WatiTemplate.create({ ...mapped, status: mapped.status });
      created += 1;
    }
  }

  const total = await WatiTemplate.countDocuments();
  return { created, updated, remoteCount: remote.length, total };
}

export async function ensureDefaultTemplate() {
  const count = await WatiTemplate.countDocuments();
  if (count) return;
  await WatiTemplate.create({
    name: "mapims_lab_rpt",
    displayName: "MAPIMS Lab Report",
    category: "LAB",
    status: "ACTIVE",
    isDefault: true,
    parameters: [
      { name: "1", example: "Patient name" },
      { name: "attachmentLink", example: "PDF URL" },
    ],
    source: "LOCAL",
  });
}
