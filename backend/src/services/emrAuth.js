import { config } from "../config.js";

const EMR_BASE = "https://emr.mapims.edu.in/BB15SE";
const LOGIN_URL = `${EMR_BASE}/wsLogin.asmx/chkLoginNew`;
const SESSION_URL = `${EMR_BASE}/wsLogin.asmx/GetSessionUser`;

let cachedCookie = "";
let cachedAt = 0;
const SESSION_TTL_MS = 25 * 60 * 1000;

function readSetCookies(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function cookieHeaderFromJar(setCookieHeaders = []) {
  const pairs = [];
  for (const line of setCookieHeaders) {
    const part = String(line).split(";")[0]?.trim();
    if (part) pairs.push(part);
  }
  return pairs.join("; ");
}

function mergeCookieHeader(existing = "", incoming = "") {
  const jar = new Map();
  for (const chunk of `${existing};${incoming}`.split(";")) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    jar.set(trimmed.slice(0, eq), trimmed);
  }
  return [...jar.values()].join("; ");
}

async function emrLoginRequest(url, body, cookie = "") {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });

  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  const setCookies = readSetCookies(response);

  return {
    ok: response.ok,
    status: response.status,
    json,
    cookie: mergeCookieHeader(cookie, cookieHeaderFromJar(setCookies)),
  };
}

export async function loginToEmr({ force = false } = {}) {
  if (!force && cachedCookie && Date.now() - cachedAt < SESSION_TTL_MS) {
    return cachedCookie;
  }

  const username = config.emr.username;
  const password = config.emr.password;
  if (!username || !password) {
    throw new Error("EMR_USERNAME and EMR_PASSWORD are required for automatic proc ID lookup");
  }

  let cookie = "";
  await fetch(`${EMR_BASE}/Backbone/admin/login.aspx`, {
    headers: cookie ? { Cookie: cookie } : {},
  }).then(async (res) => {
    cookie = mergeCookieHeader(cookie, cookieHeaderFromJar(readSetCookies(res)));
  });

  const login = await emrLoginRequest(
    LOGIN_URL,
    { UsrName: username, UsrPwd: password, LogOpt: "1" },
    cookie
  );
  cookie = login.cookie;

  const result = String(login.json?.d ?? login.json?.raw ?? "").replace(/"/g, "");
  if (result !== "1" && result !== "2") {
    throw new Error("EMR login failed — check EMR_USERNAME / EMR_PASSWORD");
  }

  const session = await emrLoginRequest(SESSION_URL, {}, cookie);
  cookie = session.cookie;
  if (!cookie) {
    throw new Error("EMR login succeeded but no session cookie was returned");
  }

  cachedCookie = cookie;
  cachedAt = Date.now();
  return cookie;
}

export async function getEmrSessionCookie() {
  if (config.emr.cookie) return config.emr.cookie;
  return loginToEmr();
}

export function clearEmrSessionCache() {
  cachedCookie = "";
  cachedAt = 0;
}
