export function formatCacheAge(cachedAt) {
  if (!cachedAt) return null;
  const ms = Date.now() - new Date(cachedAt).getTime();
  if (ms < 60000) return "just now";
  if (ms < 3600000) return `${Math.round(ms / 60000)} min ago`;
  return `${Math.round(ms / 3600000)} hr ago`;
}

export function cacheStatusLabel(meta) {
  if (!meta?.cached && !meta?.cachedAt) return "";
  const age = formatCacheAge(meta.cachedAt);
  if (meta.stale) return age ? `Cached ${age} (WATI unreachable)` : "Cached (WATI unreachable)";
  return age ? `Cached ${age}` : "Cached";
}
