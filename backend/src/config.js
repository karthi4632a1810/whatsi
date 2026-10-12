import crypto from "node:crypto";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(rootDir, ".env") });

const WEAK_JWT_SECRETS = new Set(["", "change-me-in-production", "secret", "changeme"]);

/**
 * Login tokens are signed with JWT_SECRET. A missing or well-known value would
 * let anyone forge an admin login, so the app falls back to a random secret
 * (everyone is signed out on each restart) and says so loudly.
 */
function jwtSecret() {
  const value = String(process.env.JWT_SECRET || "");
  if (!WEAK_JWT_SECRETS.has(value) && value.length >= 16) return value;
  console.warn(
    "[config] JWT_SECRET is missing or weak — using a random secret for this run. " +
      "Set JWT_SECRET in .env (e.g. `openssl rand -hex 32`) so logins survive restarts."
  );
  return crypto.randomBytes(32).toString("hex");
}

export const config = {
  port: Number(process.env.PORT) || 5001,
  mongodbUri: process.env.MONGODB_URI || "mongodb://localhost:27017/whatsi",
  jwtSecret: jwtSecret(),
  // This app's public https address. Set → patients get private expiring report
  // links on it (services/reportLinks.js); unset → the EMR report URL is sent.
  publicBaseUrl: String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, ""),
  reportLinkDays: Math.min(Math.max(Number(process.env.REPORT_LINK_DAYS) || 2, 1), 30),
  // Comma-separated browser origins allowed to call the API (empty = same origin only).
  corsOrigins: String(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  wati: {
    token: process.env.WATI_TOKEN || process.env.token || "",
    baseUrl: (process.env.WATI_URL || process.env.url || "").replace(/\/$/, ""),
    templateName: process.env.WATI_TEMPLATE_NAME || "mapims_lab_rpt",
    sendEnabled: process.env.WATI_SEND_ENABLED === "true",
    testPhoneOnly: process.env.WATI_TEST_PHONE || "919360635207",
    testMode: process.env.WATI_TEST_MODE !== "false",
    contactsCacheMs: Number(process.env.WATI_CONTACTS_CACHE_MS) || 30 * 60 * 1000,
    connectionCacheMs: Number(process.env.WATI_CONNECTION_CACHE_MS) || 15 * 60 * 1000,
    basicPlanApiLimit: Number(process.env.WATI_BASIC_PLAN_API_LIMIT) || 0,
  },
  emr: {
    queryBuilderUrl:
      process.env.EMR_QUERY_BUILDER_URL ||
      "https://emr.mapims.edu.in/BB15SE/QueryBuilder/wsQueryBuilder.asmx/Getdataset1",
    labServicesUrl:
      process.env.EMR_LAB_SERVICES_URL ||
      "https://emr.mapims.edu.in/BB15SE/Lab/wsLabServices.asmx/RETDatatable",
    strCon: process.env.EMR_STR_CON || "BB_CONSTR",
    labStrCon: process.env.EMR_LAB_STR_CON || "LAB_CONSTR",
    sqlDateOrder: (process.env.EMR_SQL_DATE_ORDER || "mdy").toLowerCase() === "dmy" ? "dmy" : "mdy",
    reportBaseUrl:
      process.env.EMR_REPORT_BASE_URL ||
      "https://emr.mapims.edu.in/BB15SE/Lab/CRReport/LabReport.aspx",
    labResultHisUrl:
      process.env.EMR_LAB_RESULT_HIS_URL ||
      "https://emr.mapims.edu.in/BB15SE/Lab/LabResultHis.aspx",
    username: process.env.EMR_USERNAME || "",
    password: process.env.EMR_PASSWORD || "",
    cookie: process.env.EMR_COOKIE || "",
    pollEnabled: process.env.EMR_POLL_ENABLED !== "false",
    pollCron: process.env.EMR_POLL_CRON || "*/15 * * * *",
    procIdsQuery: process.env.EMR_PROCIDS_QUERY || "",
    httpTimeoutMs: Number(process.env.EMR_HTTP_TIMEOUT_MS) || 120000,
    httpRetries: Number(process.env.EMR_HTTP_RETRIES) || 1,
    chunkHours: Number(process.env.EMR_CHUNK_HOURS) || 2,
    chunkEnabled: process.env.EMR_CHUNK_ENABLED !== "false",
    // How many past days to re-check for late READY completions (excludes today)
    backlogLookbackDays: Number(process.env.EMR_BACKLOG_LOOKBACK_DAYS) || 3,
  },
  webhooks: {
    hisSecret: process.env.HIS_WEBHOOK_SECRET || "",
  },
};
