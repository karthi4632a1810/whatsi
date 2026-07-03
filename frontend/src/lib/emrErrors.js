export function formatEmrError(message = "") {
  const text = String(message || "");
  if (/backend unavailable|ECONNREFUSED|fetch failed/i.test(text)) {
    return "API server is not running. Restart the backend (npm run dev in backend/) and click Refresh.";
  }
  if (/execution timeout expired|timeout period elapsed|EMR database query timed out/i.test(text)) {
    return "EMR database timed out loading that date. Wait 1–2 minutes and click Refresh — past days load in chunks.";
  }
  if (/^HTTP 500$/i.test(text.trim())) {
    return "Server error — the API may have restarted. Wait a few seconds and click Refresh.";
  }
  return text.replace(/^EMR HTTP \d+: /, "").slice(0, 320);
}
