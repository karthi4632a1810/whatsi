import { config } from "../config.js";
import { normalizePhone } from "../utils/phone.js";
import { readWatiCache, writeWatiCache, clearWatiCache } from "./watiCache.js";

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

function extractList(data, keys) {
  if (Array.isArray(data)) return data;
  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
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

export async function listWatiContacts({ pageNumber = 1, pageSize = 500, force = false } = {}) {
  if (!force) {
    const cached = await readWatiCache("contacts");
    if (cached?.contacts) return cached;
  }

  const result = await watiGet("api/v1/getContacts", { pageNumber, pageSize });
  if (!result.response.ok) {
    const stale = await readWatiCache("contacts");
    if (stale?.contacts?.length) {
      return {
        ...stale,
        stale: true,
        error: `WATI contacts failed (${result.response.status}) — showing cached list`,
      };
    }
    throw new Error(`WATI contacts failed (${result.response.status})`);
  }
  const contacts = extractList(result.data, ["contact_list", "contacts", "result", "data"])
    .map(normalizeWatiContact)
    .filter((c) => c.phone);
  contacts.sort((a, b) => a.name.localeCompare(b.name));

  const payload = { contacts, cached: false };
  const syncedAt = await writeWatiCache("contacts", { contacts });
  return { contacts, cached: false, cachedAt: syncedAt.toISOString() };
}

export async function refreshWatiContacts() {
  await clearWatiCache("contacts");
  return listWatiContacts({ force: true });
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
  const result = await watiPost("api/v1/sendTemplateMessage", payload, { whatsappNumber });
  if (!result.response.ok && result.response.status >= 500) {
    throw new Error(
      `WATI send failed (${result.response.status}): ${JSON.stringify(result.data)}`
    );
  }
  if (!result.response.ok) {
    const retry = await watiPost(
      "api/v1/sendTemplateMessage",
      { ...payload, customParams: payload.parameters },
      { whatsappNumber }
    );
    if (!retry.response.ok) {
      throw new Error(
        `WATI send failed (${retry.response.status}): ${JSON.stringify(retry.data)}`
      );
    }
    return retry.data;
  }
  return result.data;
}

export async function testWatiConnection({ force = false } = {}) {
  if (!config.wati.token || !config.wati.baseUrl) {
    return { ok: false, status: 0, templateCount: 0, error: "WATI credentials missing in .env" };
  }

  if (!force) {
    const cached = await readWatiCache("connection");
    if (cached?.ok !== undefined) return cached;
  }

  const result = await watiGet("api/v1/getMessageTemplates");
  const payload = {
    ok: result.response.ok,
    status: result.response.status,
    templateCount: Array.isArray(result.data?.messageTemplates)
      ? result.data.messageTemplates.length
      : 0,
    error: result.response.ok
      ? ""
      : result.data?.message || result.data?.error || `WATI API error (${result.response.status})`,
    cached: false,
  };

  if (result.response.ok) {
    const syncedAt = await writeWatiCache("connection", payload);
    payload.cachedAt = syncedAt.toISOString();
  } else {
    const stale = await readWatiCache("connection");
    if (stale?.ok) {
      return {
        ...stale,
        stale: true,
        error: payload.error || stale.error,
      };
    }
  }

  return payload;
}
