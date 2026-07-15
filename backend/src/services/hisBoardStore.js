import crypto from "node:crypto";
import { HisLabOrder, LabBoardDay } from "../models/index.js";
import {
  fetchTodayLabBoard,
  fetchTodayLabBoardProgressive,
  fetchOrderStatusRows,
  buildTodayLabBoard,
  looksLikeEmrOrderId,
} from "./emr.js";
import { reportDayKey, parseQueryDate, buildDayTimeChunks, enumerateDays } from "../utils/dates.js";
import { config } from "../config.js";

const INCREMENTAL_CONCURRENCY = 8;
const activeBoardRefreshes = new Map();

function latestSyncAt(meta) {
  if (!meta) return null;
  const full = meta.lastFullSyncAt ? new Date(meta.lastFullSyncAt).getTime() : 0;
  const incremental = meta.lastIncrementalSyncAt
    ? new Date(meta.lastIncrementalSyncAt).getTime()
    : 0;
  const ts = Math.max(full, incremental);
  return ts ? new Date(ts) : null;
}

function hashOrder(order) {
  const payload = {
    readiness: order.readiness,
    hisStatus: order.hisStatus,
    procedureTotal: order.procedureTotal,
    approvedCount: order.approvedCount,
    procIds: order.procIds || [],
    statusCounts: order.statusCounts || {},
    completedAt: order.completedAt?.toISOString?.() || order.completedAt || null,
    phone: order.phone || "",
  };
  return crypto.createHash("sha1").update(JSON.stringify(payload)).digest("hex");
}

function toStoredDoc(labDay, order) {
  return {
    labDay,
    orderId: String(order.orderId),
    patientId: order.patientId || "",
    patientName: order.patientName || "",
    phone: order.phone || "",
    department: order.department || "",
    opIpType: order.opIpType || "UNKNOWN",
    opIpRaw: order.opIpRaw || "",
    hisStatus: order.hisStatus || "",
    readiness: order.readiness || "WAITING",
    procedureTotal: order.procedureTotal || 0,
    approvedCount: order.approvedCount || 0,
    procIds: order.procIds || [],
    procedureNames: (order.procedures || [])
      .map((p) => p.name)
      .filter(Boolean),
    procedures: (order.procedures || []).map((p) => ({
      name: p.name || "",
      status: p.status || "",
      procId: p.procId || null,
      completedAt: p.completedAt || null,
    })),
    statusCounts: order.statusCounts || {},
    requestDate: order.requestDate || null,
    completedAt: order.completedAt || null,
    contentHash: hashOrder(order),
    lastEmrSyncAt: new Date(),
  };
}

export function boardOrderFromDocument(doc) {
  if (!doc) return null;
  const row = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return {
    orderId: row.orderId,
    reportDay: row.labDay,
    patientId: row.patientId,
    patientName: row.patientName,
    phone: row.phone,
    department: row.department,
    opIpType: row.opIpType,
    opIpRaw: row.opIpRaw,
    hisStatus: row.hisStatus,
    statusCounts: row.statusCounts || {},
    procedureTotal: row.procedureTotal,
    approvedCount: row.approvedCount,
    readiness: row.readiness,
    procIds: row.procIds || [],
    requestDate: row.requestDate,
    completedAt: row.completedAt,
    procedures: (row.procedures || []).map((p) => ({
      name: p.name,
      status: p.status,
      procId: p.procId,
      completedAt: p.completedAt,
    })),
  };
}

export function applyBoardFilter(orders, filter = "all") {
  if (filter === "approved") {
    return orders.filter((o) => o.statusCounts?.["RESULT APPROVED"]);
  }
  if (filter === "ready") {
    return orders.filter((o) => o.readiness === "READY");
  }
  if (filter === "completed") {
    return orders.filter(
      (o) => o.hisStatus === "RESULT APPROVED" || o.hisStatus === "COMPLETED"
    );
  }
  return orders;
}

export function summarizeBoardOrders(orders) {
  return {
    total: orders.length,
    ready: orders.filter((o) => o.readiness === "READY").length,
    partial: orders.filter((o) => o.readiness === "PARTIAL").length,
    approved: orders.filter((o) => o.hisStatus === "RESULT APPROVED").length,
    inProcess: orders.filter((o) => o.hisStatus === "IN PROCESS").length,
  };
}

export async function getLabBoardMeta(labDay) {
  return LabBoardDay.findOne({ labDay });
}

export async function getBoardRefreshStatus(labDay) {
  const meta = await getLabBoardMeta(labDay);
  if (!meta) {
    return {
      labDay,
      refreshStatus: activeBoardRefreshes.has(labDay) ? "running" : "idle",
      refreshProgress: { chunksDone: 0, chunksTotal: 0, orderCount: 0 },
      refreshError: "",
      orderCount: 0,
      lastFullSyncAt: null,
    };
  }
  return {
    labDay,
    refreshStatus: meta.refreshStatus || "idle",
    refreshProgress: meta.refreshProgress || { chunksDone: 0, chunksTotal: 0, orderCount: 0 },
    refreshError: meta.refreshError || "",
    orderCount: meta.orderCount || 0,
    lastFullSyncAt: meta.lastFullSyncAt || null,
  };
}

export async function getActiveBoardRefreshes() {
  const runningDays = [...activeBoardRefreshes.keys()];
  if (!runningDays.length) return [];

  const statuses = await Promise.all(runningDays.map((labDay) => getBoardRefreshStatus(labDay)));
  return statuses
    .filter((status) => status.refreshStatus === "running")
    .sort((a, b) => String(a.labDay).localeCompare(String(b.labDay)));
}

export function startBoardRefresh(labDay) {
  const day = labDay || reportDayKey();
  if (activeBoardRefreshes.has(day)) {
    return { labDay: day, alreadyRunning: true };
  }

  const job = runChunkedBoardRefresh(day)
    .catch((error) => {
      console.error("[his-board] chunked refresh failed", day, error.message);
    })
    .finally(() => {
      activeBoardRefreshes.delete(day);
    });

  activeBoardRefreshes.set(day, job);
  return { labDay: day, started: true };
}

async function runChunkedBoardRefresh(labDay) {
  const from = parseQueryDate(labDay, false);
  const to = parseQueryDate(labDay, true);
  const chunksTotal = buildDayTimeChunks(from, to, config.emr.chunkHours).length;

  await LabBoardDay.findOneAndUpdate(
    { labDay },
    {
      labDay,
      refreshStatus: "running",
      refreshError: "",
      refreshProgress: { chunksDone: 0, chunksTotal, orderCount: 0 },
    },
    { upsert: true }
  );

  console.log(`[his-board] chunked refresh start ${labDay} (${chunksTotal} slices)`);

  try {
    const knownOrderIds = new Set();

    await fetchTodayLabBoardProgressive({
      from,
      to,
      onChunk: async ({ chunkIndex, chunksTotal: total, touchedOrders, orderCount }) => {
        for (const order of touchedOrders) {
          await upsertBoardOrder(labDay, order);
          knownOrderIds.add(String(order.orderId));
        }

        await LabBoardDay.updateOne(
          { labDay },
          {
            refreshProgress: {
              chunksDone: chunkIndex,
              chunksTotal: total,
              orderCount,
            },
            orderCount,
          }
        );

        console.log(
          `[his-board] chunk ${chunkIndex}/${total} · ${orderCount} orders (${touchedOrders.length} updated)`
        );
      },
    });

    const finalOrders = await getStoredBoard(labDay, "all");
    const finalIds = finalOrders.map((o) => String(o.orderId));
    if (finalIds.length) {
      await HisLabOrder.deleteMany({ labDay, orderId: { $nin: finalIds } });
    }

    await LabBoardDay.updateOne(
      { labDay },
      {
        refreshStatus: "done",
        lastFullSyncAt: new Date(),
        orderCount: finalIds.length,
        refreshProgress: {
          chunksDone: chunksTotal,
          chunksTotal,
          orderCount: finalIds.length,
        },
        refreshError: "",
      }
    );

    console.log(`[his-board] chunked refresh done ${labDay} · ${finalIds.length} orders`);
    return { labDay, orderCount: finalIds.length };
  } catch (error) {
    await LabBoardDay.updateOne(
      { labDay },
      { refreshStatus: "error", refreshError: error.message }
    );
    throw error;
  }
}

export async function getStoredBoard(labDay, filter = "all") {
  const docs = await HisLabOrder.find({ labDay })
    .sort({ completedAt: -1, requestDate: -1 })
    .lean();
  return applyBoardFilter(docs.map(boardOrderFromDocument), filter);
}

async function upsertBoardOrder(labDay, order) {
  const doc = toStoredDoc(labDay, order);
  const existing = await HisLabOrder.findOne({ labDay, orderId: doc.orderId }).select("contentHash");
  if (existing?.contentHash === doc.contentHash) {
    return { changed: false, order: boardOrderFromDocument(existing) };
  }
  const saved = await HisLabOrder.findOneAndUpdate(
    { labDay, orderId: doc.orderId },
    doc,
    { upsert: true, new: true }
  );
  return { changed: true, order: boardOrderFromDocument(saved) };
}

export async function saveBoardFromEmr(labDay, orders = []) {
  const incomingIds = new Set();
  let changed = 0;
  let unchanged = 0;

  for (const order of orders) {
    incomingIds.add(String(order.orderId));
    const result = await upsertBoardOrder(labDay, order);
    if (result.changed) changed += 1;
    else unchanged += 1;
  }

  if (incomingIds.size) {
    await HisLabOrder.deleteMany({
      labDay,
      orderId: { $nin: [...incomingIds] },
    });
  } else {
    await HisLabOrder.deleteMany({ labDay });
  }

  await LabBoardDay.findOneAndUpdate(
    { labDay },
    {
      labDay,
      orderCount: orders.length,
      lastFullSyncAt: new Date(),
    },
    { upsert: true, new: true }
  );

  return { changed, unchanged, total: orders.length };
}

async function runPool(items, worker, concurrency = INCREMENTAL_CONCURRENCY) {
  const results = [];
  let index = 0;

  async function next() {
    while (index < items.length) {
      const i = index;
      index += 1;
      results[i] = await worker(items[i], i);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(runners);
  return results;
}

export async function refreshOrderFromEmr(labDay, orderId) {
  const from = parseQueryDate(labDay, false);
  const to = parseQueryDate(labDay, true);
  const id = String(orderId || "").trim();
  if (!id) throw new Error("Order ID is required");

  const rows = await fetchOrderStatusRows(id, from, to);
  if (!rows.length) {
    await HisLabOrder.deleteOne({ labDay, orderId: id });
    return { orderId: id, removed: true, changed: true };
  }

  const built = buildTodayLabBoard(rows);
  const order = built.find((o) => String(o.orderId) === id);
  if (!order) {
    await HisLabOrder.deleteOne({ labDay, orderId: id });
    return { orderId: id, removed: true, changed: true };
  }

  const result = await upsertBoardOrder(labDay, order);
  return { orderId: id, removed: false, changed: result.changed, order: result.order };
}

export async function refreshBoardFromEmr(labDay, { mode = "full" } = {}) {
  const day = labDay || reportDayKey();
  const from = parseQueryDate(day, false);
  const to = parseQueryDate(day, true);

  if (mode === "incremental") {
    const meta = await getLabBoardMeta(day);
    if (!meta?.lastFullSyncAt && !meta?.orderCount) {
      if (!activeBoardRefreshes.has(day)) {
        startBoardRefresh(day);
      }
      return {
        mode: "chunked-started",
        labDay: day,
        ...(await getBoardRefreshStatus(day)),
      };
    }

    // Pull the full day from HIS so NEW orders appear and READY/PARTIAL updates apply.
    // (Old incremental only re-polled WAITING/PARTIAL ids — new rows never showed up.)
    const beforeIds = new Set(
      (await HisLabOrder.find({ labDay: day }).select("orderId").lean()).map((d) =>
        String(d.orderId)
      )
    );

    const orders = await fetchTodayLabBoard({ from, to, filter: "all" });
    const save = await saveBoardFromEmr(day, orders);

    const added = orders.filter((o) => !beforeIds.has(String(o.orderId))).length;

    await LabBoardDay.findOneAndUpdate(
      { labDay: day },
      { lastIncrementalSyncAt: new Date() },
      { upsert: true }
    );

    return {
      mode: "incremental",
      labDay: day,
      polled: orders.length,
      added,
      updated: save.changed,
      unchanged: save.unchanged,
      orderCount: orders.length,
      errors: 0,
    };
  }

  const orders = await fetchTodayLabBoard({ from, to, filter: "all" });
  const save = await saveBoardFromEmr(day, orders);
  return {
    mode: "full",
    labDay: day,
    ...save,
    orderCount: orders.length,
  };
}

export async function refreshBoardFromEmrProgressive(labDay) {
  return startBoardRefresh(labDay);
}

export async function getHisDaySummary(labDay) {
  const orders = await getStoredBoard(labDay, "all");
  if (!orders.length) return null;
  const meta = await getLabBoardMeta(labDay);
  return {
    ...summarizeBoardOrders(orders),
    lastSyncAt: latestSyncAt(meta),
    source: "mongodb",
  };
}

function buildStoredRangeQuery(days, q = "") {
  const query = { labDay: { $in: days } };
  const term = String(q || "").trim();
  if (!term) return query;

  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, "i");
  const digits = term.replace(/\D/g, "");
  const or = [{ patientName: re }, { patientId: re }, { orderId: re }, { phone: re }];
  if (digits.length >= 4) {
    or.push({ phone: new RegExp(digits) });
    or.push({ patientId: new RegExp(digits) });
    or.push({ orderId: new RegExp(digits) });
  }
  return { ...query, $or: or };
}

/** Fast path: search orders already saved on the server for a date range. */
export async function searchStoredBoardRange({ fromRaw, toRaw, filter = "all", q = "" }) {
  const days = enumerateDays(fromRaw, toRaw);
  if (!days.length) {
    return { days: [], orders: [], missingDays: [], cachedDays: 0, source: "mongodb" };
  }

  const docs = await HisLabOrder.find(buildStoredRangeQuery(days, q))
    .sort({ completedAt: -1, requestDate: -1 })
    .lean();

  const orders = applyBoardFilter(
    docs.map(boardOrderFromDocument).filter(Boolean),
    filter
  );

  const metas = await LabBoardDay.find({ labDay: { $in: days } })
    .select("labDay lastFullSyncAt orderCount")
    .lean();
  const loadedDays = new Set(metas.filter((m) => m.lastFullSyncAt).map((m) => m.labDay));
  const missingDays = days.filter((d) => !loadedDays.has(d));

  return {
    days,
    orders,
    missingDays,
    cachedDays: loadedDays.size,
    source: "mongodb",
  };
}

async function loadDaysFromEmr(missingDays, { filter = "all" } = {}) {
  const seen = new Set();
  const orders = [];

  const outcomes = await runPool(
    missingDays,
    async (day) => {
      const from = parseQueryDate(day, false);
      const to = parseQueryDate(day, true);
      console.log(`[his-board] lab-search loading missing day ${day} from EMR`);
      const board = await fetchTodayLabBoard({ from, to, filter: "all" });
      await saveBoardFromEmr(day, board);
      return applyBoardFilter(board, filter).map((order) => ({ ...order, reportDay: day }));
    },
    2
  );

  for (const dayOrders of outcomes) {
    if (!Array.isArray(dayOrders)) continue;
    for (const order of dayOrders) {
      if (seen.has(order.orderId)) continue;
      seen.add(order.orderId);
      orders.push(order);
    }
  }

  return orders;
}

export async function lookupOrderInDateRange(orderId, from, to) {
  const id = String(orderId || "").trim();
  if (!id || !looksLikeEmrOrderId(id)) return null;

  const rows = await fetchOrderStatusRows(id, from, to);
  if (!rows.length) return null;

  const built = buildTodayLabBoard(rows);
  const order = built.find((o) => String(o.orderId) === id);
  if (!order) return null;

  const labDay = reportDayKey(order.requestDate || from);
  await upsertBoardOrder(labDay, order);
  return { ...boardOrderFromDocument(toStoredDoc(labDay, order)), reportDay: labDay };
}

export async function searchLabBoardRange({ fromRaw, toRaw, filter = "all", q = "" }) {
  const from = parseQueryDate(fromRaw, false);
  const to = parseQueryDate(toRaw, true);
  const term = String(q || "").trim();

  const stored = await searchStoredBoardRange({ fromRaw, toRaw, filter, q: term });
  let orders = stored.orders;
  let source = stored.cachedDays > 0 ? "mongodb" : "emr";

  if (!orders.length && term && looksLikeEmrOrderId(term)) {
    const direct = await lookupOrderInDateRange(term, from, to);
    if (direct) {
      orders = applyBoardFilter([direct], filter);
      source = "emr-direct";
    }
  }

  const shouldLoadMissing =
    stored.missingDays.length > 0 && (!term || orders.length === 0);
  let emrDaysLoaded = 0;

  if (shouldLoadMissing) {
    emrDaysLoaded = stored.missingDays.length;
    const emrOrders = await loadDaysFromEmr(stored.missingDays, { filter });
    const seen = new Set(orders.map((o) => o.orderId));
    for (const order of emrOrders) {
      if (seen.has(order.orderId)) continue;
      seen.add(order.orderId);
      orders.push(order);
    }
    if (term) {
      const lower = term.toLowerCase();
      const digits = term.replace(/\D/g, "");
      orders = orders.filter((order) => {
        const patientId = String(order.patientId || "").toLowerCase();
        const orderId = String(order.orderId || "").toLowerCase();
        const patientName = String(order.patientName || "").toLowerCase();
        const phone = String(order.phone || "").replace(/\D/g, "");
        if (patientId.includes(lower) || orderId.includes(lower) || patientName.includes(lower)) {
          return true;
        }
        return Boolean(digits && (patientId.includes(digits) || orderId.includes(digits) || phone.includes(digits)));
      });
    }
    source = stored.cachedDays > 0 ? "mongodb+emr" : "emr";
  }

  orders.sort((a, b) => {
    const ta = a.completedAt?.getTime?.() || new Date(a.completedAt || 0).getTime() || 0;
    const tb = b.completedAt?.getTime?.() || new Date(b.completedAt || 0).getTime() || 0;
    return tb - ta;
  });

  return {
    days: stored.days,
    orders,
    daysLoaded: stored.days.length,
    cachedDays: stored.cachedDays,
    missingDays: stored.missingDays,
    emrDaysLoaded,
    source,
  };
}
