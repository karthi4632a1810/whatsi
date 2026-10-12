import { OrderPdfMeta, Report } from "../models/index.js";
import { buildLabReportUrl, isEmrReportUrl, isPlausibleProcIds } from "./emr.js";
import { parseLabReportUrl } from "../utils/labReportUrl.js";

export async function getOrderPdfMeta(orderId) {
  return OrderPdfMeta.findOne({ orderId: String(orderId) });
}

export async function upsertOrderPdfMeta(orderId, payload = {}) {
  const id = String(orderId);
  let procIds = Array.isArray(payload.procIds) ? payload.procIds.map(Number) : [];
  let hisReportUrl = String(payload.hisReportUrl || "").trim();

  if (payload.labReportUrl) {
    const parsed = parseLabReportUrl(payload.labReportUrl);
    if (parsed.orderId !== id) {
      throw new Error(`URL order ${parsed.orderId} does not match ${id}`);
    }
    procIds = parsed.procIds;
    hisReportUrl = parsed.hisReportUrl;
  }

  procIds = procIds.filter((n) => Number.isFinite(n) && n > 0);

  if (!hisReportUrl && procIds.length) {
    hisReportUrl = buildLabReportUrl(id, procIds);
  }

  if (hisReportUrl && !isEmrReportUrl(hisReportUrl)) {
    throw new Error("The report link must be an EMR LabReport URL");
  }

  if (!isPlausibleProcIds(procIds) || !hisReportUrl) {
    throw new Error("Provide a valid EMR LabReport URL or procedure ID list");
  }

  const meta = await OrderPdfMeta.findOneAndUpdate(
    { orderId: id },
    {
      orderId: id,
      patientId: String(payload.patientId || ""),
      procIds,
      hisReportUrl,
      source: payload.source || "MANUAL",
    },
    { upsert: true, new: true }
  );

  await Report.updateMany({ reportId: id }, { $set: { procIds, hisReportUrl } });

  return meta;
}

export async function getOrderPdfMetaMap(orderIds = []) {
  const ids = [...new Set(orderIds.map(String).filter(Boolean))];
  if (!ids.length) return new Map();

  const rows = await OrderPdfMeta.find({ orderId: { $in: ids } });
  return new Map(rows.map((row) => [row.orderId, row]));
}
