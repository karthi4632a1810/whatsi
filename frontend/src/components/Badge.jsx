export default function Badge({ children, kind, className = "" }) {
  const tone = kind || String(children || "").toLowerCase();
  return <span className={`badge ${tone} ${className}`.trim()}>{children}</span>;
}

export function HisBadge({ status }) {
  const key = String(status || "")
    .toLowerCase()
    .replace(/\s+/g, "-");
  return <span className={`badge his-${key}`}>{status}</span>;
}
