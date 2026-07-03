export function parseProcIdsParam(value = "") {
  return String(value)
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function parseLabReportUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("EMR LabReport URL is required");

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid EMR LabReport URL");
  }

  const orderId = url.searchParams.get("Orderid") || url.searchParams.get("orderid") || "";
  const procIds = parseProcIdsParam(url.searchParams.get("Procids") || url.searchParams.get("procids"));

  if (!orderId) throw new Error("Orderid missing from EMR URL");
  if (!procIds.length) throw new Error("Procids missing from EMR URL");

  return {
    orderId: String(orderId),
    procIds,
    hisReportUrl: url.toString(),
  };
}
