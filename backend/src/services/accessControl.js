/**
 * Which permission each API route needs (services/users.js has the model).
 * The screens hide what a user can't use; this is what actually stops it — a
 * view-only user can't send WhatsApp even by calling the API directly.
 *
 * Every /api route must be listed. One that isn't is super-admin only, so a
 * new route can't be left open by accident.
 */
import { effectivePermissions, isSuperAdmin } from "./users.js";

const perms = (user) => (isSuperAdmin(user) ? null : effectivePermissions(user));

const LABELS = {
  reports: "OP Lab Reports",
  search: "Lab Search",
  labFinder: "Lab Finder",
  wati: "WATI Settings",
  monitor: "the WhatsApp Monitor",
  audit: "the Audit Log",
};

// Rule helpers: each returns (user) => true | "reason"
const screen = (id, level) => (user) => {
  const p = perms(user);
  if (!p) return true;
  const have = p.screens[id];
  if (level === "read" ? have !== "none" : have === "write") return true;
  if (p.readOnlyMode && have === "read") return "the portal is in read-only mode for maintenance";
  return have === "none" ? `no access to ${LABELS[id] || id}` : `${LABELS[id] || id} is view-only for you`;
};
const superAdmin = (user) => (isSuperAdmin(user) ? true : "only a super admin can do this");
const downloads = (user) => {
  const p = perms(user);
  return !p || p.exports !== false ? true : p.readOnlyMode ? "downloads are paused (read-only mode)" : "downloads are turned off for everyone";
};
const loggedIn = () => true;
const all = (...rules) => (user) => {
  for (const r of rules) {
    const ok = r(user);
    if (ok !== true) return ok;
  }
  return true;
};
const anyOf = (...rules) => (user) => {
  let reason = "no access";
  for (const r of rules) {
    const ok = r(user);
    if (ok === true) return true;
    reason = ok;
  }
  return reason;
};

const ID = "[^/]+";
const re = (path) => new RegExp(`^${path}$`);

const RULES = [
  // Signed-in basics: own profile, the System pills, the audit events this browser reports.
  [null, /^\/api\/me(\/|$)/, loggedIn],
  ["GET", re("/api/stats"), loggedIn],
  ["GET", re("/api/settings/health"), loggedIn],
  ["GET", re("/api/settings/automation"), loggedIn],
  ["POST", re("/api/audit/events"), loggedIn],

  // OP Lab Reports: the HIS board and the WhatsApp queue
  ["GET", re("/api/stats/his"), screen("reports", "read")],
  ["GET", /^\/api\/his\/lab-today(\/refresh-status|\/active-refreshes)?$/, screen("reports", "read")],
  ["POST", re("/api/his/lab-today/soft-refresh"), screen("reports", "read")],
  ["POST", re(`/api/his/lab-today/${ID}/refresh`), screen("reports", "read")],
  ["POST", re("/api/his/lab-today/refresh"), screen("reports", "write")],
  ["GET", re(`/api/settings/health/emr-procids/${ID}`), screen("reports", "read")],
  ["GET", /^\/api\/reports(\/[^/]+)?$/, screen("reports", "read")],
  ["POST", /^\/api\/reports\/(sync-order|poll|bulk-send|send-all-pending)$/, screen("reports", "write")],
  ["POST", re(`/api/reports/${ID}/send`), screen("reports", "write")],
  ["GET", re("/api/op/reports"), screen("reports", "read")],
  ["GET", re(`/api/op/orders/${ID}`), screen("reports", "read")],
  ["POST", re(`/api/op/orders/${ID}/refresh`), screen("reports", "read")],
  ["POST", re("/api/op/refresh"), screen("reports", "write")],
  ["POST", re(`/api/op/orders/${ID}/(queue|send)`), screen("reports", "write")],
  ["PUT", re(`/api/his/orders/${ID}/pdf-meta`), screen("reports", "write")],
  ["POST", re("/api/his/pdf-meta/parse"), screen("reports", "write")],
  // A report PDF opens from any screen that lists it.
  ["GET", re(`/api/his/(pdf|pdf-url)/${ID}`), anyOf(screen("reports", "read"), screen("search", "read"), screen("labFinder", "read"), screen("monitor", "read"))],

  // Lab Search / Lab Finder
  ["GET", re("/api/his/lab-search"), screen("search", "read")],
  ["GET", /^\/api\/lab-results\/(tests|coverage)$/, screen("labFinder", "read")],
  ["POST", re("/api/lab-results/search"), screen("labFinder", "read")],
  ["POST", re("/api/lab-results/export"), all(downloads, screen("labFinder", "read"))],

  // Contacts: WATI Settings, and fixing a number while sending (OP Lab Reports)
  ["GET", /^\/api\/patients\/?$/, anyOf(screen("wati", "read"), screen("reports", "read"))],
  ["PUT", re(`/api/patients/by-uhid/${ID}`), anyOf(screen("wati", "write"), screen("reports", "write"))],
  ["PATCH", re(`/api/patients/${ID}`), anyOf(screen("wati", "write"), screen("reports", "write"))],

  // WATI Settings (templates and the contact picker are read by the send screens too)
  ["GET", /^\/api\/wati\//, anyOf(screen("wati", "read"), screen("reports", "read"), screen("monitor", "read"))],
  [null, /^\/api\/wati\//, screen("wati", "write")],

  // WhatsApp Monitor + Message log
  ["GET", re("/api/analytics"), anyOf(screen("monitor", "read"), screen("reports", "read"))],
  ["GET", re("/api/monitor/export"), all(downloads, screen("monitor", "read"))],
  ["GET", /^\/api\/monitor\//, screen("monitor", "read")],
  ["POST", /^\/api\/monitor\//, screen("monitor", "write")],
  ["GET", /^\/api\/messages(\/delivery-state)?\/?$/, anyOf(screen("monitor", "read"), screen("reports", "read"))],
  ["POST", /^\/api\/messages\/(check-now|[^/]+\/retry)$/, anyOf(screen("monitor", "write"), screen("reports", "write"))],

  // Audit Log
  ["GET", re("/api/audit/export"), all(downloads, screen("audit", "read"))],
  ["GET", /^\/api\/audit\//, screen("audit", "read")],

  // Users and Master Settings (incl. the sending schedule) — super admin only
  [null, /^\/api\/users(\/|$)/, superAdmin],
  [null, /^\/api\/settings(\/|$)/, superAdmin],
];

/** true, or the reason this user can't call this route. */
export function checkRoute(user, method, path) {
  for (const [m, pattern, rule] of RULES) {
    if ((m === null || m === method) && pattern.test(path)) return rule(user);
  }
  return superAdmin(user);
}
