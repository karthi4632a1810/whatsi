const TOKEN_KEY = "whatsi_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  // Cached HIS boards contain patient data — don't leave them on shared PCs.
  try {
    indexedDB?.deleteDatabase("mapims-his");
  } catch {
    // ignore
  }
}

/** App.jsx listens: the session ended (→ sign-in screen) or a temporary password must be replaced. */
export const AUTH_EXPIRED_EVENT = "whatsi:auth-expired";
export const MUST_CHANGE_PASSWORD_EVENT = "whatsi:must-change-password";

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/api/auth/")) {
      clearToken();
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { reason: data.error } }));
      throw new Error(data.error || "Session expired — please log in again");
    }
    if (response.status === 403 && data.code === "must_change_password") {
      window.dispatchEvent(new CustomEvent(MUST_CHANGE_PASSWORD_EVENT));
    }
    if (response.status >= 500 && !data.error) {
      throw new Error("Backend unavailable — restart the API server and try Refresh again.");
    }
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

/** Query string for the WhatsApp Monitor (arrays become comma lists, empty values are left out). */
function monitorParams(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const value = Array.isArray(v) ? v.join(",") : v;
    if (value !== undefined && value !== null && String(value) !== "") q.set(k, value);
  }
  return q.toString();
}

/** Downloads a file from the API (with the login token); returns the file name. */
async function downloadFile(path, { method = "GET", body, fallbackName = "download" } = {}) {
  const token = getToken();
  const response = await fetch(path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Download failed (${response.status})`);
  }
  const blob = await response.blob();
  const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") || "")?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return name;
}

/** Downloads a WhatsApp Monitor export; returns the file name. */
export const downloadMonitorExport = (params, view, format) =>
  downloadFile(`/api/monitor/export?${monitorParams({ ...params, view, format })}`, { fallbackName: `whatsapp-op.${format}` });
export const downloadAuditLog = (params) => downloadFile(`/api/audit/export?${monitorParams(params)}`, { fallbackName: "audit-log.csv" });
export const downloadLabResults = (query) =>
  downloadFile("/api/lab-results/export", { method: "POST", body: { query }, fallbackName: "lab-finder.csv" });

const post = (path, body = {}) => request(path, { method: "POST", body: JSON.stringify(body) });
const put = (path, body = {}) => request(path, { method: "PUT", body: JSON.stringify(body) });

export const api = {
  // Sign-in, the signed-in user, users (super admin), Master Settings, audit, Lab Finder
  login: (username, password) => post("/api/auth/login", { username, password }),
  logout: () => post("/api/auth/logout").catch(() => {}),
  me: () => request("/api/me"),
  changeMyPassword: (current, password) => post("/api/me/password", { current, password }),
  users: () => request("/api/users"),
  createUser: (body) => post("/api/users", body),
  updateUser: (username, body) => put(`/api/users/${encodeURIComponent(username)}`, body),
  resetUserPassword: (username, password, mustChange = true) => post(`/api/users/${encodeURIComponent(username)}/password`, { password, mustChange }),
  signOutUser: (username) => post(`/api/users/${encodeURIComponent(username)}/sign-out`),
  deleteUser: (username) => request(`/api/users/${encodeURIComponent(username)}`, { method: "DELETE" }),
  masterSettings: () => request("/api/settings"),
  saveMasterSettings: (values) => put("/api/settings", { values }),
  auditSummary: (params) => request(`/api/audit/summary?${monitorParams(params)}`),
  auditEvents: (params) => request(`/api/audit/events?${monitorParams(params)}`),
  auditSessions: (params) => request(`/api/audit/sessions?${monitorParams(params)}`),
  auditOptions: () => request("/api/audit/options"),
  labTests: (q) => request(`/api/lab-results/tests?q=${encodeURIComponent(q || "")}`),
  labCoverage: () => request("/api/lab-results/coverage"),
  labSearch: (query) => post("/api/lab-results/search", query),

  // WhatsApp Monitor (OP lab reports)
  monitorSummary: (params) => request(`/api/monitor/summary?${monitorParams(params)}`),
  monitorInsights: (params) => request(`/api/monitor/insights?${monitorParams(params)}`),
  monitorMessages: (params) => request(`/api/monitor/messages?${monitorParams(params)}`),
  monitorPatients: (params) => request(`/api/monitor/patients?${monitorParams(params)}`),
  monitorMessage: (id) => request(`/api/monitor/messages/${encodeURIComponent(id)}`).then((d) => d.message),
  monitorActivity: (limit = 20) => request(`/api/monitor/activity?limit=${limit}`).then((d) => d.events),
  monitorWati: () => request("/api/monitor/wati"),
  monitorRefresh: () => request("/api/monitor/refresh", { method: "POST", body: "{}" }),
  monitorRetry: (id) => request(`/api/monitor/messages/${encodeURIComponent(id)}/retry`, { method: "POST", body: "{}" }),
  monitorCheckMessage: (id) => request(`/api/monitor/messages/${encodeURIComponent(id)}/check`, { method: "POST", body: "{}" }),

  stats: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/api/stats${q ? `?${q}` : ""}`);
  },
  hisDayStats: (date) => {
    const q = date ? `?date=${encodeURIComponent(date)}` : "";
    return request(`/api/stats/his${q}`);
  },
  reports: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/api/reports${q ? `?${q}` : ""}`);
  },
  report: (id) => request(`/api/reports/${id}`),
  pollEmr: (body = {}) =>
    request("/api/reports/poll", { method: "POST", body: JSON.stringify(body) }),
  sendReport: (id, { force = false, testContactPhones = null } = {}) =>
    request(`/api/reports/${id}/send`, {
      method: "POST",
      body: JSON.stringify({
        force,
        ...(testContactPhones?.length ? { testContactPhones } : {}),
      }),
    }),
  bulkSend: (ids, testContactPhones = null) =>
    request("/api/reports/bulk-send", {
      method: "POST",
      body: JSON.stringify({
        ids,
        ...(testContactPhones?.length ? { testContactPhones } : {}),
      }),
    }),
  sendAllPending: () => request("/api/reports/send-all-pending", { method: "POST" }),
  patients: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/api/patients${q ? `?${q}` : ""}`);
  },
  patchPatient: (id, body) =>
    request(`/api/patients/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  messages: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/api/messages${q ? `?${q}` : ""}`);
  },
  retryMessage: (id) => request(`/api/messages/${id}/retry`, { method: "POST" }),
  settings: () => request("/api/settings/automation"),
  saveSettings: (body) =>
    request("/api/settings/automation", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  hisLabToday: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/api/his/lab-today${q ? `?${q}` : ""}`);
  },
  startHisBoardRefresh: (body = {}) =>
    request("/api/his/lab-today/refresh", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  softHisBoardRefresh: (body = {}) =>
    request("/api/his/lab-today/soft-refresh", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  hisBoardRefreshStatus: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/api/his/lab-today/refresh-status${q ? `?${q}` : ""}`);
  },
  hisActiveRefreshes: () => request("/api/his/lab-today/active-refreshes"),
  hisLabSearch: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/api/his/lab-search${q ? `?${q}` : ""}`);
  },
  refreshHisOrder: (orderId, body = {}) =>
    request(`/api/his/lab-today/${encodeURIComponent(orderId)}/refresh`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  syncOrderToQueue: (body) =>
    request("/api/reports/sync-order", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  hisPdfUrl: (orderId) => request(`/api/his/pdf-url/${orderId}`),
  saveOrderPdfMeta: (orderId, body) =>
    request(`/api/his/orders/${orderId}/pdf-meta`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  watiOverview: () => request("/api/wati/overview"),
  watiDelivery: () => request("/api/wati/delivery"),
  sendOpOrder: (orderId, body) => post(`/api/op/orders/${encodeURIComponent(orderId)}/send`, body),
  saveContactByUhid: (uhid, body) => put(`/api/patients/by-uhid/${encodeURIComponent(uhid)}`, body),
  saveWatiDelivery: (body) => put("/api/wati/delivery", body),
  watiTemplates: () => request("/api/wati/templates"),
  watiSyncTemplates: () => request("/api/wati/templates/sync", { method: "POST" }),
  watiCreateTemplate: (body) =>
    request("/api/wati/templates", { method: "POST", body: JSON.stringify(body) }),
  watiUpdateTemplate: (id, body) =>
    request(`/api/wati/templates/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  watiDeleteTemplate: (id) => request(`/api/wati/templates/${id}`, { method: "DELETE" }),
  watiContacts: (opts = {}) => {
    const q = new URLSearchParams();
    if (opts.refresh) q.set("refresh", "true");
    const qs = q.toString();
    return request(`/api/wati/contacts${qs ? `?${qs}` : ""}`);
  },
  health: (opts = {}) => {
    const q = opts.refresh ? "?refresh=true" : "";
    return request(`/api/settings/health${q}`);
  },
};
