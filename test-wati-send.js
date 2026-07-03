import "dotenv/config";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "output");

const token = process.env.token;
const baseUrl = process.env.url?.replace(/\/$/, "");

if (!token || !baseUrl) {
  console.error("Missing token or url in .env");
  process.exit(1);
}

const recipients = [
  {
    key: "nandhu",
    names: ["nandhu"],
    patientName: "Nandhu",
    attachmentUrl: "https://arxiv.org/pdf/2606.24597",
  },
  {
    key: "durgaram",
    names: ["durgaram", "durga"],
    patientName: "Durgaram R",
    attachmentUrl: "https://arxiv.org/pdf/2606.23050",
  },
];

function watiHeaders(json = true) {
  const headers = {
    Authorization: `Bearer ${token}`,
  };
  if (json) {
    headers["Content-Type"] = "application/json-patch+json";
  }
  return headers;
}

async function watiGet(endpoint, params = {}) {
  const url = new URL(`${baseUrl}/${endpoint.replace(/^\//, "")}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url, { headers: watiHeaders() });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { response, data };
}

async function watiPost(endpoint, payload, query = {}) {
  const url = new URL(`${baseUrl}/${endpoint.replace(/^\//, "")}`);
  Object.entries(query).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });

  const response = await fetch(url, {
    method: "POST",
    headers: watiHeaders(),
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { response, data };
}

function extractList(data, keys) {
  if (Array.isArray(data)) return data;
  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length === 12) return digits;
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

function contactName(contact) {
  return [contact.firstName, contact.lastName, contact.name]
    .filter(Boolean)
    .join(" ")
    .trim()
    .toLowerCase();
}

function findContact(contacts, ...names) {
  const needles = names.map((n) => n.toLowerCase());
  return contacts.find((contact) => {
    const fullName = contactName(contact);
    return needles.some((needle) => fullName.includes(needle));
  });
}

function findTemplate(templates) {
  const exact = templates.find((tpl) => {
    const name = String(tpl.elementName || tpl.name || "").toLowerCase();
    return name.includes("mapims") && name.includes("lab");
  });
  if (exact) return exact;

  return templates.find((tpl) => {
    const name = String(tpl.elementName || tpl.name || "").toLowerCase();
    return ["mapims", "lab", "report"].some((word) => name.includes(word));
  });
}

function templateParamNames(template) {
  const names = new Set();
  const candidates = [
    template?.customParams,
    template?.parameters,
    template?.bodyOriginal,
    template?.body,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      candidate.forEach((item) => {
        if (typeof item === "string") names.add(item);
        if (item?.paramName) names.add(item.paramName);
        if (item?.name) names.add(item.name);
      });
    } else if (typeof candidate === "string") {
      const matches = candidate.match(/\{\{([^}]+)\}\}/g) || [];
      matches.forEach((match) => names.add(match.replace(/[{}]/g, "")));
    }
  }

  return [...names];
}

function buildTemplatePayload(templateName, patientName, attachmentUrl, paramNames) {
  const broadcastName = `mapims_lab_test_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const parameters = [];

  const paramMap = {
    "1": patientName,
    attachmentLink: attachmentUrl,
    name: patientName,
    patientName,
    pdfLink: attachmentUrl,
  };

  if (paramNames.length > 0) {
    paramNames.forEach((name) => {
      const lower = name.toLowerCase();
      if (paramMap[name] !== undefined) {
        parameters.push({ name, value: paramMap[name] });
      } else if (lower.includes("attachment") || lower.includes("link") || lower.includes("pdf") || lower.includes("media")) {
        parameters.push({ name, value: attachmentUrl });
      } else if (lower.includes("name") || lower === "1") {
        parameters.push({ name, value: patientName });
      } else {
        parameters.push({ name, value: patientName });
      }
    });
  } else {
    parameters.push({ name: "1", value: patientName });
    parameters.push({ name: "attachmentLink", value: attachmentUrl });
  }

  return {
    template_name: templateName,
    broadcast_name: broadcastName,
    parameters,
  };
}

async function sendTemplateMessage(phone, templateName, patientName, attachmentUrl, paramNames) {
  const payload = buildTemplatePayload(templateName, patientName, attachmentUrl, paramNames);
  const whatsappNumber = normalizePhone(phone);

  let result = await watiPost("api/v1/sendTemplateMessage", payload, { whatsappNumber });
  if (!result.response.ok) {
    const altPayload = {
      ...payload,
      customParams: payload.parameters,
    };
    result = await watiPost("api/v1/sendTemplateMessage", altPayload, { whatsappNumber });
  }

  if (!result.response.ok) {
    throw new Error(
      `sendTemplateMessage failed (${result.response.status}): ${JSON.stringify(result.data)}`
    );
  }

  return result.data;
}

async function main() {
  console.log("1) Testing WATI connection...");
  const templatesResult = await watiGet("api/v1/getMessageTemplates");
  console.log(`   getMessageTemplates -> HTTP ${templatesResult.response.status}`);

  if (templatesResult.response.status === 401) {
    console.error("   Authentication failed. Check token in .env");
    process.exit(1);
  }
  if (!templatesResult.response.ok) {
    console.error("   Failed to fetch templates:", templatesResult.data);
    process.exit(1);
  }

  const templates = extractList(templatesResult.data, ["messageTemplates", "templates", "result", "data"]);
  console.log(`   Found ${templates.length} templates`);

  const template = findTemplate(templates);
  if (!template) {
    console.error("   Could not find MAPIMS lab report template. Available templates:");
    templates.forEach((tpl) => console.log(`     - ${tpl.elementName || tpl.name}`));
    process.exit(1);
  }

  const templateName = template.elementName || template.name;
  const paramNames = templateParamNames(template);
  console.log(`   Using template: ${templateName}`);
  if (paramNames.length) {
    console.log(`   Template params: ${paramNames.join(", ")}`);
  }

  console.log("2) Fetching contacts...");
  const contactsResult = await watiGet("api/v1/getContacts", { pageSize: 500, pageNumber: 1 });
  console.log(`   getContacts -> HTTP ${contactsResult.response.status}`);
  if (!contactsResult.response.ok) {
    console.error("   Failed to fetch contacts:", contactsResult.data);
    process.exit(1);
  }

  const contacts = extractList(contactsResult.data, ["contact_list", "contacts", "result", "data"]);
  console.log(`   Found ${contacts.length} contacts`);

  const results = [];

  for (const recipient of recipients) {
    const contact = findContact(contacts, ...recipient.names);
    if (!contact) {
      console.error(`   Contact not found for ${recipient.key}`);
      results.push({ recipient: recipient.key, status: "contact_not_found" });
      continue;
    }

    const phone = contact.phone || contact.whatsappNumber || contact.wAid;
    console.log(`   ${recipient.key}: ${contactName(contact)} -> ${phone}`);
    console.log(`3) Using PDF: ${recipient.attachmentUrl}`);

    console.log(`4) Sending template message to ${recipient.key}...`);
    const sendResult = await sendTemplateMessage(
      phone,
      templateName,
      recipient.patientName,
      recipient.attachmentUrl,
      paramNames
    );
    console.log(`   Send result: ${JSON.stringify(sendResult).slice(0, 500)}`);

    results.push({
      recipient: recipient.key,
      phone,
      attachmentUrl: recipient.attachmentUrl,
      status: "sent",
      response: sendResult,
    });
  }

  await fsp.mkdir(OUTPUT_DIR, { recursive: true });
  const resultsPath = path.join(OUTPUT_DIR, "send_results.json");
  await fsp.writeFile(resultsPath, JSON.stringify(results, null, 2));
  console.log(`Done. Results saved to ${resultsPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
