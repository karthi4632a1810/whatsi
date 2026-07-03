export function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("91") && digits.length === 12) return digits;
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

export function displayPhone(value) {
  const n = normalizePhone(value);
  if (n.length === 12 && n.startsWith("91")) return `+${n.slice(0, 2)} ${n.slice(2)}`;
  return value || "";
}
