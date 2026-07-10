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

export async function watiGet(endpoint, params = {}) {
  const url = new URL(`${config.wati.baseUrl}/${endpoint.replace(/^\//, "")}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, { headers: headers() });
  return parseResponse(response);
}

async function watiPost(endpoint, payload, query = {}) {
  const url = new URL(`${config.wati.baseUrl}/${endpoint.replace(/^\//, "")}`);
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  });
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
  if (!result.response.ok && result.response.status >= 500) {
    throw new Error(
      `WATI send failed (${result.response.status}): ${JSON.stringify(result.data)}`
    );
  }
  if (!result.response.ok) {
    await incrementWatiApiUsage({ method: "POST", endpoint: "api/v1/sendTemplateMessage" }).catch(
      () => {}
    );
    const retry = await watiPost(
      "api/v1/sendTemplateMessage",
      { ...payload, customParams: payload.parameters },
      { whatsappNumber }
    );
    assertWatiJsonResponse(retry, "sendTemplateMessage");
    if (!retry.response.ok) {
      throw new Error(
        `WATI send failed (${retry.response.status}): ${JSON.stringify(retry.data)}`
      );
    }
    return retry.data;
  }
  if (result.data?.result !== true && result.data?.ok !== true) {
    throw new Error(
      `WATI send rejected: ${result.data?.info || result.data?.message || JSON.stringify(result.data).slice(0, 200)}`
    );
  }
  return result.data;
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
