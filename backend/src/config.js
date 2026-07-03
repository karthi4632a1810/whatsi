import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(rootDir, ".env") });

export const config = {
  port: Number(process.env.PORT) || 5001,
  mongodbUri: process.env.MONGODB_URI || "mongodb://localhost:27017/whatsi",
  jwtSecret: process.env.JWT_SECRET || "change-me-in-production",
  wati: {
    token: process.env.WATI_TOKEN || process.env.token || "",
    baseUrl: (process.env.WATI_URL || process.env.url || "").replace(/\/$/, ""),
    templateName: process.env.WATI_TEMPLATE_NAME || "mapims_lab_rpt",
    sendEnabled: process.env.WATI_SEND_ENABLED === "true",
    testPhoneOnly: process.env.WATI_TEST_PHONE || "919360635207",
    testMode: process.env.WATI_TEST_MODE !== "false",
    contactsCacheMs: Number(process.env.WATI_CONTACTS_CACHE_MS) || 30 * 60 * 1000,
    connectionCacheMs: Number(process.env.WATI_CONNECTION_CACHE_MS) || 15 * 60 * 1000,
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
  },
  automation: {
    eodCron: process.env.EOD_CRON || "0 18 * * *",
    retryCron: process.env.RETRY_CRON || "*/10 * * * *",
  },
  webhooks: {
    hisSecret: process.env.HIS_WEBHOOK_SECRET || "",
  },
};
