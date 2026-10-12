export function extractObjectRows(data) {
  if (data == null) return [];
  let parsed = data;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }

  const candidates = [];
  function collect(node, depth) {
    if (depth > 14 || node == null) return;
    if (Array.isArray(node)) {
      if (node.length && node.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
        candidates.push(node);
      }
      node.forEach((item) => collect(item, depth + 1));
      return;
    }
    if (typeof node === "object") {
      Object.values(node).forEach((value) => collect(value, depth + 1));
    }
  }
  collect(parsed, 0);
  if (!candidates.length) return [];
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}

export function normKey(key) {
  return String(key || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function getRowValue(row, ...aliases) {
  const map = new Map();
  for (const [k, v] of Object.entries(row || {})) {
    map.set(normKey(k), v);
  }
  for (const alias of aliases) {
    const value = map.get(normKey(alias));
    if (value != null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

export function extractOrderId(reqNoHtml) {
  const text = String(reqNoHtml || "");
  const match = text.match(/Orderid=(\d+)/i);
  if (match) return match[1];
  const plain = text.replace(/<[^>]+>/g, "").trim();
  return /^\d+$/.test(plain) ? plain : "";
}

export function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractProcIdFromHtml(value) {
  const text = String(value || "");
  const patterns = [
    /Procid=(\d+)/i,
    /ProcId=(\d+)/i,
    /procid[=:](\d+)/i,
    /ProcID=(\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

export function extractProcIdsFromHtmlDocument(html) {
  const text = String(html || "");
  const procIds = new Set();

  for (const match of text.matchAll(/Procids=([\d,\s]+)/gi)) {
    for (const part of match[1].split(",")) {
      const id = Number(part.trim());
      if (Number.isFinite(id) && id > 0) procIds.add(id);
    }
  }

  for (const match of text.matchAll(/Procid=(\d+)/gi)) {
    procIds.add(Number(match[1]));
  }

  const hiddenProcMatch =
    text.match(/id=["']hdnProcids?["'][^>]*value=["']([^"']*)["']/i) ||
    text.match(/name=["']hdnProcids?["'][^>]*value=["']([^"']*)["']/i) ||
    text.match(/value=["']([^"']*)["'][^>]*id=["']hdnProcids?["']/i);
  if (hiddenProcMatch?.[1]) {
    for (const part of hiddenProcMatch[1].split(",")) {
      const id = Number(part.trim());
      if (Number.isFinite(id) && id > 0) procIds.add(id);
    }
  }

  return [...procIds];
}

export const EXCLUDED_PATIENT_TYPES = ["ZPATIENT"];

export function isExcludedPatientType(patientType) {
  return EXCLUDED_PATIENT_TYPES.includes(String(patientType || "").toUpperCase().trim());
}

export function parseOpIpType(value) {
  const raw = String(value || "").toUpperCase();
  if (raw.includes(" IP")) return "IP";
  if (raw.startsWith("IP")) return "IP";
  if (raw.includes(" OP")) return "OP";
  if (raw.startsWith("OP")) return "OP";
  if (raw.includes(" OT")) return "OT";
  return "UNKNOWN";
}

/**
 * The HIS RESULT column: " 2.25 10*3/µl", " 31.2 %", " Negative", " --".
 * → { result: "2.25 10*3/µl", value: 2.25, unit: "10*3/µl" }; value is null
 * for text results, and an empty / "--" result is "".
 */
export function parseLabResult(raw) {
  const result = stripHtml(raw).replace(/\s+/g, " ").trim();
  if (!result || /^-+$/.test(result)) return { result: "", value: null, unit: "" };
  const m = result.match(/^([<>]=?\s*)?(-?\d+(?:\.\d+)?)(?:\s+(.*))?$/);
  if (!m) return { result, value: null, unit: "" };
  return { result, value: Number(m[2]), unit: (m[3] || "").trim() };
}

/** "ABSOLUTE LYMPHOCYTE COUNT [COMPLETE BLOOD COUNT]" → { test, group }. */
export function splitTestName(name) {
  const raw = String(name || "").trim();
  const m = raw.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  return m ? { test: m[1].replace(/[.\s]+$/, "").trim(), group: m[2].trim() } : { test: raw, group: "" };
}

/**
 * EMR rows are result lines ("ABSOLUTE LYMPHOCYTE COUNT [COMPLETE BLOOD COUNT]");
 * the name in brackets is the test they belong to. Groups lines into tests:
 * [{ name, total, approved, completedAt }] — a test is approved when all its lines are.
 */
export function groupTests(procedures = []) {
  const groups = new Map();
  for (const p of procedures) {
    const raw = String(p?.name || "").trim();
    if (!raw) continue;
    const name = (raw.match(/\[([^\]]+)\]\s*$/)?.[1] || raw).trim();
    const g = groups.get(name) || { name, total: 0, approved: 0, completedAt: null };
    g.total += 1;
    if (p.status === "RESULT APPROVED") {
      g.approved += 1;
      if (p.completedAt && (!g.completedAt || new Date(p.completedAt) > new Date(g.completedAt))) g.completedAt = p.completedAt;
    }
    groups.set(name, g);
  }
  return [...groups.values()];
}
