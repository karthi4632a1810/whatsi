/**
 * The app's saved-PDF cache (services/pdfCache.js) wired to MongoDB, AOSTA and
 * the OP board: which order a request means, when to fetch ahead, when a copy
 * goes stale, and the nightly clean-up.
 */
import { config } from "../config.js";
import { HisLabOrder, PdfCacheEntry, Report } from "../models/index.js";
import { setting } from "./appSettings.js";
import { DELIVERY_OP_IP_TYPE, isEmrReportUrl } from "./emr.js";
import { createPdfCache, pdfContentKey } from "./pdfCache.js";

const lean = (q) => q.lean().then((d) => d || null);

/** PdfCacheEntry as the store pdfCache.js expects. */
export const mongoStore = {
  get: (orderId) => lean(PdfCacheEntry.findOne({ orderId: String(orderId) })),
  upsert: (orderId, doc) => lean(PdfCacheEntry.findOneAndUpdate({ orderId: String(orderId) }, { $set: doc }, { upsert: true, new: true })),
  remove: (orderId) => PdfCacheEntry.deleteOne({ orderId: String(orderId) }),
  markStale: (orderId, at) => PdfCacheEntry.updateOne({ orderId: String(orderId) }, { $set: { stale: true, staleAt: at } }),
  touch: (orderId) => PdfCacheEntry.updateOne({ orderId: String(orderId) }, { $inc: { servedCount: 1 }, $set: { lastServedAt: new Date() } }),
  all: () => PdfCacheEntry.find({}).select("orderId path").lean(),
  olderThan: (date) => PdfCacheEntry.find({ fetchedAt: { $lt: date } }).select("orderId path").lean(),
  stats: async () => {
    const [s] = await PdfCacheEntry.aggregate([
      {
        $group: {
          _id: null,
          files: { $sum: 1 },
          bytes: { $sum: "$size" },
          stale: { $sum: { $cond: ["$stale", 1, 0] } },
          oldest: { $min: "$fetchedAt" },
          newest: { $max: "$fetchedAt" },
        },
      },
    ]);
    return s ? { files: s.files, bytes: s.bytes, stale: s.stale, oldest: s.oldest, newest: s.newest } : { files: 0, bytes: 0, stale: 0, oldest: null, newest: null };
  },
};

/** The PDF from AOSTA (the EMR's LabReport.aspx). Throws when AOSTA can't be reached. */
export async function fetchPdfFromEmr(url) {
  if (!isEmrReportUrl(url)) throw Object.assign(new Error("Stored report link is not an EMR report URL"), { status: 400, expose: true });
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw Object.assign(new Error(`AOSTA answered ${res.status}`), { status: 502, expose: true });
  return Buffer.from(await res.arrayBuffer());
}

export const pdfCache = createPdfCache({
  dir: config.pdfCache.dir,
  store: mongoStore,
  fetchPdf: fetchPdfFromEmr,
  enabled: () => setting("pdf.cacheEnabled"),
});

/**
 * What pdfCache needs to know about an order: ready or not, what it's made of,
 * and how to find its AOSTA address (only asked when the copy can't be used).
 */
export async function orderContext(orderId, { day = "", procIds = [], report: givenReport = null } = {}) {
  const id = String(orderId);
  const query = { orderId: id, opIpType: DELIVERY_OP_IP_TYPE };
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) query.labDay = day;
  const board = await HisLabOrder.findOne(query).sort({ labDay: -1 }).lean();
  const report = givenReport || (await Report.findOne({ reportId: id }).sort({ updatedAt: -1 }).lean());
  const hint = procIds.length ? procIds : board?.procIds || [];
  return {
    orderId: id,
    labDay: board?.labDay || report?.reportDay || "",
    readiness: board?.readiness || report?.readiness || "WAITING",
    contentKey: board ? pdfContentKey(board) : "",
    procIds: board?.procIds?.length ? board.procIds : report?.procIds || [],
    approvedCount: board?.approvedCount ?? report?.approvedCount ?? 0,
    procedureTotal: board?.procedureTotal ?? report?.procedureTotal ?? 0,
    resolveUrl: async () => {
      if (givenReport && isEmrReportUrl(givenReport.hisReportUrl)) return givenReport.hisReportUrl;
      const { resolveOrderPdfUrl } = await import("./reports.js");
      return (await resolveOrderPdfUrl(id, { procIds: hint })).pdfUrl;
    },
  };
}

/** The PDF for a logged-in screen (GET /api/his/pdf). */
export async function getOrderPdf(orderId, { day, procIds, fresh = false } = {}) {
  return pdfCache.get(await orderContext(orderId, { day, procIds }), { fresh });
}

/** The PDF behind a patient's expiring link — the queue row decides which report. */
export async function getReportPdf(report) {
  return pdfCache.get(await orderContext(report.reportId, { day: report.reportDay, report }));
}

/** For the ⓘ panel: is there a saved copy, from when, still current? */
export async function pdfCacheInfo(orderId, boardOrder) {
  return pdfCache.info(String(orderId), boardOrder ? pdfContentKey(boardOrder) : "");
}

// ---- fetching ahead ---------------------------------------------------------------

const queue = new Map(); // orderId → labDay, one fetch at a time
let draining = false;
const QUEUE_MAX = 1000;
const GAP_MS = 1500;

async function drain() {
  draining = true;
  try {
    while (queue.size) {
      const [orderId, day] = queue.entries().next().value;
      queue.delete(orderId);
      try {
        const r = await pdfCache.warm(await orderContext(orderId, { day }));
        if (r.error) console.warn(`[pdf-cache] fetch ahead for order ${orderId}: ${r.error}`);
      } catch (error) {
        console.warn(`[pdf-cache] fetch ahead for order ${orderId}: ${error.message}`);
      }
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
  } finally {
    draining = false;
  }
}

/** Fetch this order's PDF soon (background, one at a time so AOSTA isn't flooded). */
export function schedulePrefetch(orderId, labDay = "") {
  if (!config.pdfCache.prefetch || !setting("pdf.cacheEnabled")) return;
  if (queue.size >= QUEUE_MAX && !queue.has(String(orderId))) return;
  queue.set(String(orderId), labDay);
  if (!draining) drain();
}

/**
 * Called for every order a board save wrote: the copy goes stale when what the
 * PDF is made of changed, and a READY order is fetched ahead.
 */
export async function onBoardOrderSaved(order) {
  if (!order?.orderId) return;
  try {
    await pdfCache.markStaleIfChanged(String(order.orderId), pdfContentKey(order));
  } catch (error) {
    console.warn(`[pdf-cache] mark stale ${order.orderId}: ${error.message}`);
  }
  if (order.readiness === "READY") schedulePrefetch(order.orderId, order.labDay);
}

/** Just before a WhatsApp send: make sure the patient's link has a saved copy (never holds the send long). */
export async function warmBeforeSend(orderId, day, { timeoutMs = 15_000 } = {}) {
  if (!setting("pdf.cacheEnabled")) return { skipped: "off" };
  const work = orderContext(orderId, { day }).then((ctx) => pdfCache.warm(ctx));
  return Promise.race([work, new Promise((r) => setTimeout(() => r({ skipped: "timeout" }), timeoutMs))]).catch((e) => ({ error: e.message }));
}

// ---- nightly clean-up ------------------------------------------------------------

let lastSweep = null;

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

export async function sweepPdfCache() {
  const days = setting("pdf.cacheDays");
  const result = await pdfCache.sweep({ days });
  lastSweep = { at: new Date(), days, ...result };
  console.log(
    `[pdf-cache] sweep: ${result.expired} expired, ${result.missingFiles} records without a file, ${result.orphanFiles} stray files removed · ` +
      `${result.files} PDFs, ${mb(result.bytes)} in ${result.dir}`
  );
  return lastSweep;
}

/** Settings → "Saved lab report PDFs": how much is kept, and the last clean-up. */
export async function pdfCacheUsage() {
  return { ...(await pdfCache.usage()), queued: queue.size, lastSweep };
}

/**
 * Today's READY orders with no saved copy, queued to fetch ahead. The board only
 * triggers a fetch when an order changes, so this catches up after a restart
 * (or after fetches failed earlier in the day).
 */
export async function prefetchTodayMissing() {
  if (!config.pdfCache.prefetch || !setting("pdf.cacheEnabled")) return 0;
  const labDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const ready = await HisLabOrder.find({ labDay, opIpType: DELIVERY_OP_IP_TYPE, readiness: "READY" }).select("orderId").lean();
  if (!ready.length) return 0;
  const saved = new Set(await PdfCacheEntry.distinct("orderId", { orderId: { $in: ready.map((o) => String(o.orderId)) }, stale: { $ne: true } }));
  const missing = ready.filter((o) => !saved.has(String(o.orderId)));
  for (const o of missing) schedulePrefetch(o.orderId, labDay);
  return missing.length;
}

/** Start-up: check the folder, say how much is there, and catch up on today's reports. */
export async function startPdfCache() {
  const ok = await pdfCache.checkWritable();
  const u = await pdfCache.usage();
  console.log(`[pdf-cache] ${ok ? "ready" : "NOT writable — PDFs fetched live"}: ${u.files} PDFs, ${mb(u.bytes)} in ${u.dir}`);
  if (!ok) return;
  setTimeout(() => {
    prefetchTodayMissing()
      .then((n) => n && console.log(`[pdf-cache] fetching ahead ${n} of today's ready reports with no saved copy`))
      .catch((e) => console.warn(`[pdf-cache] catch-up: ${e.message}`));
  }, 30_000).unref?.();
}
