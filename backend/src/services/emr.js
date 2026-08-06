import { config } from "../config.js";
import { getEmrSessionCookie } from "./emrAuth.js";
import {
  extractObjectRows,
  extractOrderId,
  extractProcIdFromHtml,
  extractProcIdsFromHtmlDocument,
  getRowValue,
  parseOpIpType,
  stripHtml,
} from "../utils/emrParse.js";
import { formatSqlDateTime, formatSqlDateTimeValue, buildDayTimeChunks, parseEmrDate, parseQueryDate, enumerateDays } from "../utils/dates.js";
import { formatEmrHttpError, isEmrSqlTimeout, sleep } from "../utils/emrErrors.js";
import { normalizePhone } from "../utils/phone.js";

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

const SQL_INT_MAX = 2147483647;

/** EMR @RequestNo maps to an int column — reject phones and out-of-range values. */
export function looksLikeEmrOrderId(value) {
  const s = String(value || "").trim();
  if (!/^\d+$/.test(s)) return false;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > SQL_INT_MAX) return false;
  if (s.length === 10 && /^[6-9]/.test(s)) return false;
  return true;
}

async function emrPost(url, body) {
  const headers = { "Content-Type": "application/json; charset=UTF-8" };
  if (config.emr.cookie) headers.Cookie = config.emr.cookie;

  const maxAttempts = Math.max(1, config.emr.httpRetries + 1);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.emr.httpTimeoutMs),
      });
      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { raw: text };
      }
      if (!response.ok) {
        const formatted = formatEmrHttpError(response.status, text);
        if (isEmrSqlTimeout(text) && attempt < maxAttempts) {
          await sleep(2500 * attempt);
          continue;
        }
        const err = new Error(formatted.message);
        err.code = formatted.code;
        err.status = response.status;
        err.emrSqlTimeout = formatted.code === "EMR_SQL_TIMEOUT";
        throw err;
      }
      return json;
    } catch (error) {
      lastError = error;
      const retryable =
        error.name === "TimeoutError" ||
        error.code === "EMR_SQL_TIMEOUT" ||
        error.emrSqlTimeout ||
        isEmrSqlTimeout(error.message);
      if (retryable && attempt < maxAttempts) {
        await sleep(2500 * attempt);
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error("EMR request failed");
}

async function fetchQueryRows(strQuery) {
  const json = await emrPost(config.emr.queryBuilderUrl, {
    strQuery,
    strCon: config.emr.strCon,
  });
  let parsed = json?.d;
  if (typeof parsed === "string") parsed = JSON.parse(parsed);
  return extractObjectRows(parsed);
}

async function fetchLabRows(strQuery) {
  const json = await emrPost(config.emr.labServicesUrl, {
    strQuery,
    strCon: config.emr.labStrCon,
  });
  let parsed = json?.d;
  if (typeof parsed === "string") parsed = JSON.parse(parsed);
  return extractObjectRows(parsed);
}

function buildLabHistoryQuery({ fromDate, toDate, requestNo = "", status = "6" }) {
  return (
    `Use KMCH_Lab EXEC LabTestResultHistoryQB ` +
    `@FromDate = ${sqlLiteral(fromDate)} , @ToDate = ${sqlLiteral(toDate)} , ` +
    `@RegNo = '' , @RequestNo = ${sqlLiteral(requestNo)} , @IPNO = '' , @BillNo = '' , ` +
    `@PatName = '' , @BedNo = '' , @Dept = '' , @Doc = '0' , @Proc = '0' , ` +
    `@PatCategory = '1,2,3' , @Status = '${status}' , @bDiscaintimation = '1' , ` +
    `@PatType = '0' , @Result = '1' `
  );
}

export function mapEmrRow(row) {
  const reqNoHtml = getRowValue(row, "REQ NO", "REQNO");
  return {
    regNo: getRowValue(row, "REG No", "REGNO"),
    orderId: extractOrderId(reqNoHtml),
    patientName: stripHtml(getRowValue(row, "PATIENT NAME", "NAME")),
    mobile: getRowValue(row, "MOBILE"),
    status: getRowValue(row, "STATUS"),
    procedureHtml: getRowValue(row, "PROCEDURE"),
    procedureName: stripHtml(getRowValue(row, "PROCEDURE")),
    procId: extractProcIdFromHtml(getRowValue(row, "PROCEDURE")),
    department: getRowValue(row, "ORDERING DEPARTMENT", "DEPARTMENT"),
    opIpRaw: getRowValue(row, "IP/OP/OT"),
    opIpType: parseOpIpType(getRowValue(row, "IP/OP/OT")),
    patientType: getRowValue(row, "PATIENT TYPE").toUpperCase(),
    completedAt: parseEmrDate(getRowValue(row, "COMPLETED DATE")),
    requestDate: parseEmrDate(getRowValue(row, "REQUEST DATE")),
  };
}

export async function fetchApprovedLabRows({ from, to, requestNo = "" }) {
  const rows = await fetchLabRowsForDay({ from, to, requestNo, emrStatus: "6" });
  return rows.filter((row) => row.status === "RESULT APPROVED");
}

export async function fetchOrderStatusRows(orderId, from, to) {
  if (!looksLikeEmrOrderId(orderId)) return [];
  const fromDate = formatSqlDateTime(from, false);
  const toDate = formatSqlDateTime(to, true);
  const rows = await fetchQueryRows(
    buildLabHistoryQuery({ fromDate, toDate, requestNo: orderId, status: "0" })
  );
  return rows.map(mapEmrRow).filter((row) => row.orderId === String(orderId));
}

async function fetchProcIdsFromLabService(orderId) {
  const opts = [2, 3, 4, 1];
  for (const opt of opts) {
    try {
      const rows = await fetchLabRows(`Exec LabPatFiles @Opt=${opt},@OrderID=${orderId}`);
      const ids = rows
        .flatMap((row) =>
          [row.ProcId, row.ProcID, row.PROCID, row.ProcedureId, row.Proc_Id, row.Procid]
            .map((v) => Number(v))
            .filter((n) => Number.isFinite(n) && n > 0)
        )
        .filter((n, i, arr) => arr.indexOf(n) === i);
      if (ids.length) return ids;
    } catch {
      // try next opt
    }
  }
  return [];
}

export function isPlausibleProcIds(procIds = []) {
  const ids = procIds.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length) return false;
  if (ids.length <= 5 && ids.every((id) => id <= 20)) return false;
  return true;
}

async function fetchProcIdsFromCustomQuery(orderId) {
  if (!config.emr.procIdsQuery) return [];
  const query = config.emr.procIdsQuery.replaceAll("{orderId}", String(orderId));
  const rows = await fetchLabRows(query);
  return rows
    .flatMap((row) => Object.values(row))
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export async function fetchLabResultHisHtml(orderId) {
  const url = new URL(config.emr.labResultHisUrl);
  url.searchParams.set("action", "Search");
  url.searchParams.set("Orderid", String(orderId));

  let cookie = config.emr.cookie;
  if (!cookie && config.emr.username && config.emr.password) {
    cookie = await getEmrSessionCookie();
  }

  const response = await fetch(url.toString(), {
    headers: cookie ? { Cookie: cookie } : {},
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`LabResultHis HTTP ${response.status}`);
  }
  if (
    text.includes("SqlException") ||
    text.includes("Server Error in '/BB15SE' Application") ||
    text.includes("Incorrect syntax near")
  ) {
    return "";
  }
  return text;
}

export async function fetchProcIdsFromLabResultHis(orderId) {
  const html = await fetchLabResultHisHtml(orderId);
  if (!html) return [];
  const procIds = extractProcIdsFromHtmlDocument(html);
  return isPlausibleProcIds(procIds) ? procIds : [];
}

export async function resolveProcIds(orderId, approvedRows) {
  const fromHtml = approvedRows
    .map((row) => row.procId)
    .filter((id) => Number.isFinite(id) && id > 0);
  if (fromHtml.length) return [...new Set(fromHtml)];

  const fromLabResultHis = await fetchProcIdsFromLabResultHis(orderId);
  if (fromLabResultHis.length) return fromLabResultHis;

  const fromLab = await fetchProcIdsFromLabService(orderId);
  if (fromLab.length) return fromLab;

  const fromCustom = await fetchProcIdsFromCustomQuery(orderId);
  if (fromCustom.length) return fromCustom;

  return [];
}

export function buildLabReportUrl(orderId, procIds = []) {
  const url = new URL(config.emr.reportBaseUrl);
  url.searchParams.set("action", "Search");
  url.searchParams.set("Orderid", String(orderId));
  url.searchParams.set("Procids", procIds.length ? `${procIds.join(",")},` : "");
  url.searchParams.set("COMPHDR", "0");
  url.searchParams.set("PatEmail", "0");
  return url.toString();
}

export function assessOrderReadiness(allRows, rule = "STRICT") {
  const active = allRows.filter((row) => row.status !== "CANCELLED");
  if (!active.length) return { readiness: "WAITING", approvedRows: [] };

  const approvedRows = active.filter((row) => row.status === "RESULT APPROVED");
  if (!approvedRows.length) return { readiness: "WAITING", approvedRows: [] };

  if (rule === "PARTIAL") {
    return { readiness: "PARTIAL", approvedRows };
  }

  const allApproved = active.every((row) => row.status === "RESULT APPROVED");
  return {
    readiness: allApproved ? "READY" : "PARTIAL",
    approvedRows,
  };
}

export function groupApprovedOrders(approvedRows) {
  const groups = new Map();
  for (const row of approvedRows) {
    if (!groups.has(row.orderId)) groups.set(row.orderId, []);
    groups.get(row.orderId).push(row);
  }
  return groups;
}

export async function buildOrderSnapshot(orderId, approvedRows, readinessRule) {
  const from = approvedRows[0]?.requestDate || new Date();
  const to = new Date();
  const allRows = await fetchOrderStatusRows(orderId, from, to);
  const { readiness, approvedRows: approvedForOrder } = assessOrderReadiness(
    allRows.length ? allRows : approvedRows,
    readinessRule
  );
  const procIds = await resolveProcIds(orderId, approvedForOrder);
  const active = (allRows.length ? allRows : approvedRows).filter((row) => row.status !== "CANCELLED");
  const first = approvedForOrder[0] || approvedRows[0];
  const latestCompleted = approvedForOrder.reduce((max, row) => {
    if (!row.completedAt) return max;
    return !max || row.completedAt > max ? row.completedAt : max;
  }, null);

  return {
    orderId: String(orderId),
    patientId: first?.regNo || "",
    patientName: first?.patientName || "",
    phone: normalizePhone(first?.mobile),
    opIpType: first?.opIpType || "UNKNOWN",
    patientType: first?.patientType || "",
    department: first?.department || "",
    readiness,
    procIds,
    procedureNames: approvedForOrder.map((r) => r.procedureName).filter(Boolean),
    procedureTotal: active.length,
    approvedCount: approvedForOrder.length,
    reportReadyAt: latestCompleted || new Date(),
    hisReportUrl: procIds.length ? buildLabReportUrl(orderId, procIds) : "",
  };
}

export async function fetchLabRowsForDay({ from, to, emrStatus = "0", requestNo = "" }) {
  if (requestNo) {
    return fetchLabRowsRange({ from, to, emrStatus, requestNo, precise: true });
  }

  if (!config.emr.chunkEnabled) {
    return fetchLabRowsRange({ from, to, emrStatus, requestNo: "", precise: false });
  }

  // Full-day queries time out on busy lab days (~30s SQL limit) — use time slices directly.
  return fetchLabRowsChunked({ from, to, emrStatus });
}

async function fetchLabRowsChunkWithRetry(chunk, emrStatus) {
  try {
    return await fetchLabRowsRange({
      from: chunk.from,
      to: chunk.to,
      emrStatus,
      requestNo: "",
      precise: true,
    });
  } catch (error) {
    if (
      (isEmrSqlTimeout(error.message) || error.code === "EMR_SQL_TIMEOUT" || error.emrSqlTimeout) &&
      config.emr.chunkHours > 1
    ) {
      console.warn("[emr] chunk timed out — retrying with 1-hour slices");
      const subChunks = buildDayTimeChunks(chunk.from, chunk.to, 1);
      const subSeen = new Set();
      const subMerged = [];
      for (const sub of subChunks) {
        const rows = await fetchLabRowsRange({
          from: sub.from,
          to: sub.to,
          emrStatus,
          requestNo: "",
          precise: true,
        });
        mergeLabRows(subMerged, subSeen, rows);
      }
      return subMerged;
    }
    throw error;
  }
}

async function fetchLabRowsChunked({ from, to, emrStatus, onChunk }) {
  const chunks = buildDayTimeChunks(from, to, config.emr.chunkHours);
  if (!onChunk) {
    console.log(`[emr] loading lab day in ${chunks.length} × ${config.emr.chunkHours}h chunks`);
  }
  const seen = new Set();
  const merged = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const rows = await fetchLabRowsChunkWithRetry(chunk, emrStatus);
    mergeLabRows(merged, seen, rows);

    if (onChunk) {
      await onChunk({
        chunkIndex: i + 1,
        chunksTotal: chunks.length,
        rows: merged,
        chunkOrderIds: [...new Set(rows.map((r) => String(r.orderId)))],
      });
    }
  }

  return merged;
}

function mergeLabRows(target, seen, rows) {
  for (const row of rows) {
    const key = labRowDedupeKey(row);
    if (!seen.has(key)) {
      seen.add(key);
      target.push(row);
    }
  }
}

function labRowDedupeKey(row) {
  return [
    row.orderId,
    row.procId || 0,
    row.status,
    row.procedureName,
    row.completedAt?.getTime() || 0,
  ].join("|");
}

async function fetchLabRowsRange({ from, to, emrStatus, requestNo, precise = false }) {
  const fromDate = precise ? formatSqlDateTimeValue(from) : formatSqlDateTime(from, false);
  const toDate = precise ? formatSqlDateTimeValue(to) : formatSqlDateTime(to, true);
  const rows = await fetchQueryRows(
    buildLabHistoryQuery({ fromDate, toDate, requestNo, status: emrStatus })
  );
  return rows.map(mapEmrRow).filter((row) => row.orderId);
}

function summarizeStatusCounts(rows) {
  const counts = {};
  for (const row of rows) {
    const key = row.status || "UNKNOWN";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function dominantHisStatus(statusCounts) {
  if (statusCounts["RESULT APPROVED"]) return "RESULT APPROVED";
  if (statusCounts["IN PROCESS"]) return "IN PROCESS";
  if (statusCounts["RESULT ENTERED"]) return "RESULT ENTERED";
  if (statusCounts["COMPLETED"]) return "COMPLETED";
  if (statusCounts["DEPT RECEIVE PENDING"]) return "DEPT RECEIVE PENDING";
  if (statusCounts["SPECIMEN YET TO BE COLLECTED"]) return "SPECIMEN YET TO BE COLLECTED";
  return Object.keys(statusCounts)[0] || "UNKNOWN";
}

export function buildTodayLabBoard(rows) {
  const byOrder = new Map();
  for (const row of rows) {
    if (!byOrder.has(row.orderId)) byOrder.set(row.orderId, []);
    byOrder.get(row.orderId).push(row);
  }

  return [...byOrder.entries()].map(([orderId, procedures]) => {
    const active = procedures.filter((p) => p.status !== "CANCELLED");
    const statusCounts = summarizeStatusCounts(active);
    const { readiness, approvedRows } = assessOrderReadiness(active, "STRICT");
    const first = procedures[0];
    const latestCompleted = active.reduce((max, row) => {
      if (!row.completedAt) return max;
      return !max || row.completedAt > max ? row.completedAt : max;
    }, null);

    const procIds = [
      ...new Set(
        approvedRows.map((p) => p.procId).filter((id) => Number.isFinite(id) && id > 0)
      ),
    ];

    return {
      orderId,
      patientId: first.regNo,
      patientName: first.patientName,
      phone: normalizePhone(first.mobile),
      department: first.department,
      opIpType: first.opIpType,
      opIpRaw: first.opIpRaw,
      patientType: first.patientType || "",
      hisStatus: dominantHisStatus(statusCounts),
      statusCounts,
      procedureTotal: active.length,
      approvedCount: approvedRows.length,
      readiness,
      procIds,
      requestDate: first.requestDate,
      completedAt: latestCompleted,
      procedures: active.map((p) => ({
        name: p.procedureName,
        status: p.status,
        procId: p.procId || null,
        completedAt: p.completedAt,
      })),
    };
  });
}

export async function fetchTodayLabBoard({ from, to, filter = "all" }) {
  const rows = await fetchLabRowsForDay({ from, to, emrStatus: "0" });
  let board = buildTodayLabBoard(rows);

  if (filter === "approved") {
    board = board.filter((o) => o.statusCounts["RESULT APPROVED"]);
  } else if (filter === "ready") {
    board = board.filter((o) => o.readiness === "READY");
  } else if (filter === "completed") {
    board = board.filter(
      (o) => o.hisStatus === "RESULT APPROVED" || o.hisStatus === "COMPLETED"
    );
  }

  board.sort((a, b) => {
    const ta = a.completedAt?.getTime() || a.requestDate?.getTime() || 0;
    const tb = b.completedAt?.getTime() || b.requestDate?.getTime() || 0;
    return tb - ta;
  });

  return board;
}

function sortLabBoard(board) {
  board.sort((a, b) => {
    const ta = a.completedAt?.getTime() || a.requestDate?.getTime() || 0;
    const tb = b.completedAt?.getTime() || b.requestDate?.getTime() || 0;
    return tb - ta;
  });
  return board;
}

/** Load EMR in time chunks; calls onChunk after each slice (for progressive UI). */
export async function fetchTodayLabBoardProgressive({ from, to, onChunk }) {
  const merged = await fetchLabRowsChunked({
    from,
    to,
    emrStatus: "0",
    onChunk: onChunk
      ? async ({ chunkIndex, chunksTotal, rows, chunkOrderIds }) => {
          const board = sortLabBoard(buildTodayLabBoard(rows));
          const touched = board.filter((o) => chunkOrderIds.includes(String(o.orderId)));
          await onChunk({
            chunkIndex,
            chunksTotal,
            orders: board,
            touchedOrders: touched,
            orderCount: board.length,
          });
        }
      : undefined,
  });

  return sortLabBoard(buildTodayLabBoard(merged));
}

export async function fetchLabBoardRange({ from, to, filter = "all", maxDays = 31 }) {
  const days = enumerateDays(from, to);
  if (!days.length) return { days: [], orders: [] };
  if (days.length > maxDays) {
    throw new Error(`Date range cannot exceed ${maxDays} days`);
  }

  const seen = new Set();
  const orders = [];

  for (const day of days) {
    const dayFrom = parseQueryDate(day, false);
    const dayTo = parseQueryDate(day, true);
    const board = await fetchTodayLabBoard({ from: dayFrom, to: dayTo, filter });
    for (const order of board) {
      if (seen.has(order.orderId)) continue;
      seen.add(order.orderId);
      orders.push({ ...order, reportDay: day });
    }
  }

  orders.sort((a, b) => {
    const ta = a.completedAt?.getTime() || a.requestDate?.getTime() || 0;
    const tb = b.completedAt?.getTime() || b.requestDate?.getTime() || 0;
    return tb - ta;
  });

  return { days, orders };
}

export async function pollApprovedOrders({ from, to, readinessRule = "STRICT" }) {
  const approvedRows = await fetchApprovedLabRows({ from, to });
  const groups = groupApprovedOrders(approvedRows);
  const snapshots = [];

  for (const [orderId, rows] of groups) {
    try {
      const snapshot = await buildOrderSnapshot(orderId, rows, readinessRule);
      snapshots.push(snapshot);
    } catch (error) {
      console.error("[emr] order snapshot failed", orderId, error.message);
    }
  }

  return snapshots;
}
