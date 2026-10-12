/**
 * The signed-in user's permissions (server: services/users.js) as simple flags
 * for the screens. The server enforces all of it; this only hides what a user
 * can't use. `me.effective` = their own permissions with the Master Settings
 * switches applied (e.g. Lab Finder off for everyone, read-only mode).
 */

const perms = (me) => me?.effective || me?.permissions || {};

/** Menu order. `screen` = the permission it needs; Users and Settings are super admin only. */
export const VIEW_ORDER = ["reports", "search", "labFinder", "wati", "monitor", "audit", "users", "settings"];
const SUPER_ONLY = new Set(["users", "settings"]);

export function canOpen(me, view) {
  if (!me) return false;
  if (SUPER_ONLY.has(view)) return Boolean(me.isSuperAdmin);
  if (me.isSuperAdmin) return true;
  const level = perms(me).screens?.[view];
  return Boolean(level) && level !== "none";
}

export function canWrite(me, view) {
  if (!me) return false;
  if (me.isSuperAdmin) return true;
  return perms(me).screens?.[view] === "write";
}

export function firstOpenView(me) {
  return VIEW_ORDER.find((v) => canOpen(me, v)) || null;
}

/** Flags each screen needs. */
export function accessFor(me) {
  const p = perms(me);
  return {
    reports: { canSend: canWrite(me, "reports") },
    wati: { canEdit: canWrite(me, "wati") },
    monitor: { canAct: canWrite(me, "monitor") },
    exports: Boolean(me?.isSuperAdmin) || p.exports !== false,
    readOnlyMode: Boolean(p.readOnlyMode),
  };
}

export function initials(name) {
  const parts = String(name || "?").trim().split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** How each access level reads on screen: "View only", and per screen what the extra right is. */
export const VIEW_LABEL = "View only";
const WRITE_LABELS = { reports: "View & send", monitor: "View & retry", wati: "View & edit" };
export const levelLabel = (screen, level) => (level === "write" ? WRITE_LABELS[screen] || "View & edit" : VIEW_LABEL);
