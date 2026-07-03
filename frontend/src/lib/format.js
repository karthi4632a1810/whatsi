export function formatPatientName(name) {
  if (!name) return "—";
  const cleaned = String(name).replace(/[\s,]+$/g, "").trim();
  return cleaned || "—";
}
