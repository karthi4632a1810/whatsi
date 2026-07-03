const TOKEN_KEY = "whatsi_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

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
    if (response.status === 401) {
      clearToken();
      if (!window.location.pathname.startsWith("/login")) {
        window.location.assign("/login?reason=session-expired");
      }
      throw new Error("Session expired — please log in again");
    }
    if (response.status >= 500 && !data.error) {
      throw new Error("Backend unavailable — restart the API server and try Refresh again.");
    }
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

export const api = {
  login: (email, password) =>
    request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
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
  health: () => request("/api/settings/health"),
  hisLabToday: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/api/his/lab-today${q ? `?${q}` : ""}`);
  },
  hisLabSearch: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/api/his/lab-search${q ? `?${q}` : ""}`);
  },
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
  watiTemplates: () => request("/api/wati/templates"),
  watiSyncTemplates: () => request("/api/wati/templates/sync", { method: "POST" }),
  watiCreateTemplate: (body) =>
    request("/api/wati/templates", { method: "POST", body: JSON.stringify(body) }),
  watiUpdateTemplate: (id, body) =>
    request(`/api/wati/templates/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  watiDeleteTemplate: (id) => request(`/api/wati/templates/${id}`, { method: "DELETE" }),
  watiContacts: () => request("/api/wati/contacts"),
};
