import { config } from "../config.js";
import { normalizePhone } from "../utils/phone.js";
import {
  readWatiCache,
  incrementWatiApiUsage,
} from "./watiCache.js";

function headers() {
  return {
    Authorization: `Bearer ${config.wati.token}`,
    "Content-Type": "application/json-patch+json",
  };
}

async function parseResponse(response) {
  const text = await response.text();
  try {
    return { response, data: text ? JSON.parse(text) : {} };
  } catch {
    return { response, data: { raw: text } };
  }
}

function isWatiHtmlResponse(data) {
  const raw = typeof data?.raw === "string" ? data.raw : "";
  return raw.includes("<!doctype html") || raw.includes("<html");
}

function assertWatiJsonResponse(result, action) {
  if (isWatiHtmlResponse(result.data)) {
    throw new Error(
      `WATI ${action} returned the web app instead of API JSON — refresh WATI_TOKEN in .env (token may be expired)`
    );
  }
}

function formatWatiNetworkError(error, action) {
  const cause = error?.cause;
  const detail =
    cause?.code ||
    cause?.message ||
    (typeof cause === "string" ? cause : "") ||
    error?.message ||
    "unknown network error";
  return `WATI ${action} failed: ${detail}. Check that this server/container can reach ${config.wati.baseUrl}`;
}

const WATI_TIMEOUT_MS = 30_000;

async function watiFetch(url, options, action) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(WATI_TIMEOUT_MS) });
  } catch (error) {
    // A send that timed out may still have reached WATI — callers must not blindly retry it.
    if (error?.name === "TimeoutError") {
      const timeout = new Error(`WATI ${action} timed out after ${WATI_TIMEOUT_MS / 1000}s — outcome unknown`);
      timeout.outcomeUnknown = true;
      throw timeout;
    }
    throw new Error(formatWatiNetworkError(error, action));
  }
}

export async function watiGet(endpoint, params = {}) {
  const url = new URL(`${config.wati.baseUrl}/${endpoint.replace(/^\//, "")}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });
  const response = await watiFetch(url, { headers: headers() }, "GET");
  return parseResponse(response);
}

async function watiPost(endpoint, payload, query = {}) {
  const url = new URL(`${config.wati.baseUrl}/${endpoint.replace(/^\//, "")}`);
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await watiFetch(
    url,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
    },
    "send"
  );
  return parseResponse(response);
}

function buildTemplatePayload(templateName, patientName, attachmentUrl) {
  return {
    template_name: templateName,
    broadcast_name: `mapims_lab_${new Date().toISOString().replace(/[:.]/g, "-")}`,
    parameters: [
      { name: "1", value: patientName },
      { name: "attachmentLink", value: attachmentUrl },
    ],
  };
}


export function normalizeWatiContact(contact = {}) {
  const phone = normalizePhone(contact.phone || contact.whatsappNumber || contact.wAid || "");
  const name = [contact.firstName, contact.lastName, contact.name, contact.fullName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return {
    id: String(contact.id || contact.contactId || contact.wAid || phone || ""),
    name: name || phone || "Unknown",
    phone,
    allowBroadcast: contact.allowBroadcast,
    contactStatus: contact.contactStatus || contact.status || "",
  };
}

export async function listWatiContacts({ force = false } = {}) {
  if (force) {
    throw new Error(
      "WATI contact import is disabled. Add test numbers manually in Settings — WATI API is only used when sending reports."
    );
  }

  const cached = await readWatiCache("contacts");
  if (cached?.contacts?.length) {
    return {
      ...cached,
      cached: true,
      apiDisabled: true,
      note: "Showing saved contact list only. WATI API is not called except on send.",
    };
  }

  return {
    contacts: [],
    cached: false,
    apiDisabled: true,
    note: "Add test numbers in Settings. WATI API is only used when sending a report.",
  };
}

export async function refreshWatiContacts() {
  throw new Error(
    "WATI contact import is disabled. Add test numbers manually in Settings — WATI API is only used when sending reports."
  );
}

export function canSendToPhone(phone, { testSendMode = false, allowedTestPhones = [] } = {}) {
  const normalized = normalizePhone(phone);
  if (!config.wati.sendEnabled) return false;
  if (testSendMode) {
    const allowed = allowedTestPhones.map(normalizePhone).filter(Boolean);
    return allowed.includes(normalized);
  }
  if (!config.wati.testMode) return true;
  return normalized === normalizePhone(config.wati.testPhoneOnly);
}

export async function sendLabReportMessage({
  phone,
  patientName,
  attachmentUrl,
  templateName = config.wati.templateName,
  testSendAllowlist = null,
}) {
  if (!config.wati.token || !config.wati.baseUrl) {
    throw new Error("WATI credentials missing");
  }
  if (!config.wati.sendEnabled) {
    throw new Error("WATI_SEND_ENABLED is false — message not sent");
  }

  const whatsappNumber = normalizePhone(phone);
  const allowlist = Array.isArray(testSendAllowlist)
    ? testSendAllowlist.map(normalizePhone).filter(Boolean)
    : null;

  if (config.wati.testMode) {
    if (allowlist?.length) {
      if (!allowlist.includes(whatsappNumber)) {
        throw new Error(`Test send: ${whatsappNumber} is not in selected WATI contacts`);
      }
    } else if (whatsappNumber !== normalizePhone(config.wati.testPhoneOnly)) {
      throw new Error(
        `WATI test mode: only ${config.wati.testPhoneOnly} is allowed (got ${whatsappNumber})`
      );
    }
  }

  const payload = buildTemplatePayload(templateName, patientName, attachmentUrl);
  await incrementWatiApiUsage({ method: "POST", endpoint: "api/v1/sendTemplateMessage" }).catch(
    () => {}
  );
  const result = await watiPost("api/v1/sendTemplateMessage", payload, { whatsappNumber });
  assertWatiJsonResponse(result, "sendTemplateMessage");
  const { response, data } = result;
  if (response.status === 429) {
    throw new Error("WATI API usage limit exceeded (429) — will retry later");
  }
  if (!response.ok) {
    throw new Error(
      `WATI send failed (${response.status}): ${data?.info || data?.message || JSON.stringify(data).slice(0, 200)}`
    );
  }
  if (data?.result !== true && data?.ok !== true) {
    throw new Error(
      `WATI send rejected: ${data?.info || data?.message || JSON.stringify(data).slice(0, 200)}`
    );
  }
  if (data?.validWhatsAppNumber === false) {
    throw new Error(`+${whatsappNumber} is not a WhatsApp number`);
  }
  return data;
}

/** WATI's message list for one number (used by the delivery status checks). */
export async function fetchWatiMessages(whatsappNumber, pageSize = 20) {
  await incrementWatiApiUsage({ method: "GET", endpoint: "api/v1/getMessages" }).catch(() => {});
  const { response, data } = await watiGet(`api/v1/getMessages/${normalizePhone(whatsappNumber)}`, {
    pageSize,
    pageNumber: 1,
  });
  if (response.status === 429) {
    const error = new Error("WATI API usage limit exceeded (429)");
    error.rateLimited = true;
    throw error;
  }
  if (!response.ok) throw new Error(`WATI getMessages ${response.status}`);
  assertWatiJsonResponse({ data }, "getMessages");
  return (data?.messages?.items || []).filter(
    (m) => m.eventType === "broadcastMessage" || m.eventType === "message"
  );
}

export async function testWatiConnection() {
  if (!config.wati.token || !config.wati.baseUrl) {
    return {
      ok: false,
      status: 0,
      templateCount: 0,
      error: "WATI credentials missing in .env",
      source: "config",
    };
  }

  return {
    ok: true,
    status: 200,
    templateCount: null,
    error: "",
    source: "config",
    note: "Credentials configured. WATI API is only called when sending a report.",
  };
}
