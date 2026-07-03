export function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("91") && digits.length === 12) return digits;
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

export function displayPhone(value) {
  const normalized = normalizePhone(value);
  if (normalized.length === 12 && normalized.startsWith("91")) {
    return `+${normalized.slice(0, 2)} ${normalized.slice(2)}`;
  }
  return value || "";
}
