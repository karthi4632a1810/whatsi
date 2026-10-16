/**
 * Saved lab report PDFs: OP lab reports open fast, AOSTA is called less, and a
 * report still opens when the EMR is down.
 *
 * - Files on disk under PDF_CACHE_DIR (a Docker volume), YYYY/MM/DD/<orderId>-<hash>.pdf
 *   — no patient data in the name beyond the order id; files 0600, folders 0700.
 *   Details in MongoDB (PdfCacheEntry). Not GridFS, so backups stay small.
 * - Only orders with every result approved (READY) are saved. Partly approved
 *   reports are always fetched live and never saved.
 * - A copy is valid while its content key (procIds, approved count, result
 *   values) matches the board; a board refresh that changes it marks the copy
 *   stale, and the next open fetches it again.
 * - AOSTA down and a copy exists (even a stale one) → that copy is served and
 *   labelled "saved copy from <date>".
 * - Kept "pdf.cacheDays" days (Master Settings, default PDF_CACHE_DAYS / 120),
 *   removed by the nightly sweep together with files no record points to.
 *
 * The folder is never served directly — only through the logged-in API
 * (permissions + audit log) or the expiring patient links.
 *
 * createPdfCache() is the logic with its storage and fetcher passed in (unit
 * tests use a temp folder, an in-memory store and a fake EMR); `pdfCache` at the
 * bottom is the app's instance.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const MIN_PDF_BYTES = 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;

const httpError = (message, status, code) => Object.assign(new Error(message), { status, code, expose: true });
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** null if this looks like a real PDF, else why not (an EMR error page, a cut-off download…). */
export function pdfProblem(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return "empty response";
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    const head = buffer.subarray(0, 200).toString("latin1").toLowerCase();
    return head.includes("<html") || head.includes("<!doctype") ? "the EMR sent a web page, not a PDF" : "not a PDF";
  }
  if (buffer.length < MIN_PDF_BYTES) return `too small for a lab report (${buffer.length} bytes)`;
  if (buffer.length > MAX_PDF_BYTES) return `too large (${Math.round(buffer.length / 1048576)} MB)`;
  if (!buffer.subarray(-2048).toString("latin1").includes("%%EOF")) return "the PDF is cut off (no end marker)";
  return null;
}

/** What a report PDF is made from — a change means a saved copy is out of date. */
export function pdfContentKey(order) {
  if (!order) return "";
  const results = (order.procedures || [])
    .filter((p) => p.status === "RESULT APPROVED")
    .map((p) => `${p.name}=${p.result || ""}`)
    .sort();
  const payload = {
    procIds: [...(order.procIds || [])].map(Number).sort((a, b) => a - b),
    approved: Number(order.approvedCount) || 0,
    total: Number(order.procedureTotal) || 0,
    results,
  };
  return crypto.createHash("sha1").update(JSON.stringify(payload)).digest("hex");
}

const safeOrderId = (id) => String(id || "").replace(/[^0-9A-Za-z-]/g, "").slice(0, 40) || "order";

/** YYYY/MM/DD/<orderId>-<first 12 of the checksum>.pdf — the lab day's date (else today). */
export function cacheRelPath({ orderId, labDay, checksum, now = new Date() }) {
  const m = String(labDay || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const [y, mo, d] = m ? m.slice(1) : [String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")];
  return path.posix.join(y, mo, d, `${safeOrderId(orderId)}-${String(checksum).slice(0, 12)}.pdf`);
}

/**
 * @param dir       absolute folder for the files
 * @param store     { get, upsert, remove, markStale, touch, all, olderThan, stats } (see mongoStore)
 * @param fetchPdf  async (url) => Buffer — throws when AOSTA can't be reached
 * @param enabled   () => boolean (Master Settings switch)
 */
export function createPdfCache({ dir, store, fetchPdf, enabled = () => true, now = () => new Date(), log = console }) {
  const root = path.resolve(dir);
  let writable = null; // unknown until the first check

  const abs = (rel) => {
    const full = path.resolve(root, rel);
    if (!full.startsWith(root + path.sep)) throw new Error("path outside the PDF folder");
    return full;
  };

  async function checkWritable() {
    try {
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      const probe = path.join(root, `.probe-${process.pid}`);
      await fs.writeFile(probe, "ok", { mode: 0o600 });
      await fs.unlink(probe);
      writable = true;
    } catch (error) {
      if (writable !== false) log.warn?.(`[pdf-cache] ${root} isn't writable (${error.code || error.message}) — PDFs are fetched live, not saved`);
      writable = false;
    }
    return writable;
  }

  /** The saved file's bytes if it's there and intact, else null. */
  async function readFile(entry) {
    if (!entry?.path) return null;
    try {
      const buf = await fs.readFile(abs(entry.path));
      if (entry.size && buf.length !== entry.size) return null;
      if (entry.checksum && sha256(buf) !== entry.checksum) return null;
      return buf;
    } catch {
      return null;
    }
  }

  const isCurrent = (entry, ctx) =>
    Boolean(entry) && !entry.stale && (!ctx.contentKey || !entry.contentKey || entry.contentKey === ctx.contentKey);

  async function save(ctx, buffer, fetchedAt) {
    if (writable === null) await checkWritable();
    if (!writable) return null;
    const checksum = sha256(buffer);
    const rel = cacheRelPath({ orderId: ctx.orderId, labDay: ctx.labDay, checksum, now: fetchedAt });
    const full = abs(rel);
    await fs.mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    const tmp = path.join(path.dirname(full), `.tmp-${crypto.randomBytes(6).toString("hex")}`);
    await fs.writeFile(tmp, buffer, { mode: 0o600 });
    await fs.rename(tmp, full);
    const previous = await store.get(ctx.orderId);
    const entry = await store.upsert(ctx.orderId, {
      orderId: String(ctx.orderId),
      labDay: ctx.labDay || "",
      path: rel,
      size: buffer.length,
      checksum,
      fetchedAt,
      approvedCount: Number(ctx.approvedCount) || 0,
      procedureTotal: Number(ctx.procedureTotal) || 0,
      procIds: (ctx.procIds || []).map(Number).filter(Number.isFinite),
      contentKey: ctx.contentKey || "",
      stale: false,
      staleAt: null,
    });
    if (previous?.path && previous.path !== rel) await fs.unlink(abs(previous.path)).catch(() => {});
    return entry;
  }

  /**
   * The PDF for an order. ctx: { orderId, labDay, readiness, contentKey, procIds,
   * approvedCount, procedureTotal, resolveUrl: async () => AOSTA url }.
   * → { buffer, source: "cache" | "fresh" | "live" | "stale-cache", fetchedAt, saved }
   */
  async function get(ctx, { fresh = false } = {}) {
    const on = enabled();
    const entry = on ? await store.get(ctx.orderId) : null;
    const ready = ctx.readiness === "READY";

    if (on && ready && !fresh && isCurrent(entry, ctx)) {
      const buf = await readFile(entry);
      if (buf) {
        Promise.resolve(store.touch?.(ctx.orderId)).catch(() => {});
        return { buffer: buf, source: "cache", fetchedAt: entry.fetchedAt, saved: true };
      }
    }

    let buffer;
    let failure;
    try {
      const url = await ctx.resolveUrl();
      if (!url) throw httpError("The report address isn't known yet (procedure IDs not found in the EMR)", 404, "NO_URL");
      buffer = await fetchPdf(url);
      const problem = pdfProblem(buffer);
      if (problem) throw httpError(`AOSTA didn't return a usable PDF: ${problem}`, 502, "NOT_PDF");
    } catch (error) {
      failure = error;
    }

    if (!failure) {
      const fetchedAt = now();
      let saved = false;
      if (on && ready) {
        try {
          saved = Boolean(await save(ctx, buffer, fetchedAt));
        } catch (error) {
          log.warn?.(`[pdf-cache] couldn't save order ${ctx.orderId}: ${error.message}`);
        }
      }
      return { buffer, source: ready ? "fresh" : "live", fetchedAt, saved };
    }

    // AOSTA failed: any copy we have beats nothing — even a stale one, and even if the cache is switched off.
    const fallback = entry || (await store.get(ctx.orderId));
    const buf = await readFile(fallback);
    if (buf) {
      log.warn?.(`[pdf-cache] AOSTA failed for order ${ctx.orderId} (${failure.message}) — serving the copy from ${new Date(fallback.fetchedAt).toISOString()}`);
      return { buffer: buf, source: "stale-cache", fetchedAt: fallback.fetchedAt, saved: true, stale: !isCurrent(fallback, ctx), error: failure.message };
    }
    throw failure.status ? failure : httpError(`AOSTA couldn't be reached: ${failure.message}`, 503, "AOSTA_DOWN");
  }

  /** Saves a copy now if the order is READY and there's no current one (errors are only logged). */
  async function warm(ctx) {
    if (!enabled() || ctx.readiness !== "READY") return { skipped: "not ready or switched off" };
    const entry = await store.get(ctx.orderId);
    if (isCurrent(entry, ctx) && (await readFile(entry))) return { skipped: "already saved" };
    try {
      const r = await get(ctx, { fresh: true });
      return { saved: r.saved, source: r.source };
    } catch (error) {
      return { error: error.message };
    }
  }

  /** A board refresh changed the order: the saved copy no longer matches. */
  async function markStaleIfChanged(orderId, contentKey) {
    const entry = await store.get(orderId);
    if (!entry || entry.stale) return false;
    if (contentKey && entry.contentKey === contentKey) return false;
    await store.markStale(orderId, now());
    return true;
  }

  /** What the info panel shows. */
  async function info(orderId, contentKey) {
    const entry = await store.get(orderId);
    if (!entry) return { saved: false };
    return {
      saved: true,
      fetchedAt: entry.fetchedAt,
      size: entry.size,
      stale: Boolean(entry.stale) || Boolean(contentKey && entry.contentKey && entry.contentKey !== contentKey),
      approvedCount: entry.approvedCount,
      procedureTotal: entry.procedureTotal,
    };
  }

  async function walk(folder, out = []) {
    let items;
    try {
      items = await fs.readdir(folder, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const item of items) {
      const full = path.join(folder, item.name);
      if (item.isDirectory()) await walk(full, out);
      else out.push(full);
    }
    return out;
  }

  async function removeEmptyDirs(folder) {
    let items;
    try {
      items = await fs.readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) if (item.isDirectory()) await removeEmptyDirs(path.join(folder, item.name));
    if (folder !== root && !(await fs.readdir(folder).catch(() => ["x"])).length) await fs.rmdir(folder).catch(() => {});
  }

  /** Nightly: copies older than `days`, records whose file is gone, files no record points to. */
  async function sweep({ days }) {
    const cutoff = new Date(now().getTime() - days * 86400_000);
    const stats = { expired: 0, missingFiles: 0, orphanFiles: 0 };
    for (const entry of await store.olderThan(cutoff)) {
      if (entry.path) await fs.unlink(abs(entry.path)).catch(() => {});
      await store.remove(entry.orderId);
      stats.expired += 1;
    }
    const known = new Set();
    for (const entry of await store.all()) {
      try {
        await fs.access(abs(entry.path));
        known.add(abs(entry.path));
      } catch {
        await store.remove(entry.orderId);
        stats.missingFiles += 1;
      }
    }
    const hourAgo = now().getTime() - 3600_000;
    for (const file of await walk(root)) {
      const base = path.basename(file);
      if (base.startsWith(".tmp-")) {
        const st = await fs.stat(file).catch(() => null);
        if (st && st.mtimeMs < hourAgo) await fs.unlink(file).catch(() => {});
        continue;
      }
      if (base.startsWith(".probe-")) continue;
      if (!known.has(file)) {
        await fs.unlink(file).catch(() => {});
        stats.orphanFiles += 1;
      }
    }
    await removeEmptyDirs(root);
    return { ...stats, ...(await usage()) };
  }

  async function usage() {
    const s = await store.stats();
    return { ...s, dir: root, writable: writable ?? (await checkWritable()) };
  }

  return { get, warm, markStaleIfChanged, info, sweep, usage, checkWritable, readFile, save };
}

/** In-memory store with the same shape as mongoStore (unit tests). */
export function memoryStore() {
  const rows = new Map();
  return {
    rows,
    get: async (id) => (rows.has(String(id)) ? { ...rows.get(String(id)) } : null),
    upsert: async (id, doc) => {
      rows.set(String(id), { servedCount: 0, ...rows.get(String(id)), ...doc });
      return { ...rows.get(String(id)) };
    },
    remove: async (id) => rows.delete(String(id)),
    markStale: async (id, at) => rows.has(String(id)) && Object.assign(rows.get(String(id)), { stale: true, staleAt: at }),
    touch: async (id) => rows.has(String(id)) && (rows.get(String(id)).servedCount += 1),
    all: async () => [...rows.values()].map((r) => ({ ...r })),
    olderThan: async (date) => [...rows.values()].filter((r) => new Date(r.fetchedAt) < date).map((r) => ({ ...r })),
    stats: async () => {
      const list = [...rows.values()];
      const times = list.map((r) => new Date(r.fetchedAt).getTime());
      return {
        files: list.length,
        bytes: list.reduce((n, r) => n + (r.size || 0), 0),
        stale: list.filter((r) => r.stale).length,
        oldest: times.length ? new Date(Math.min(...times)) : null,
        newest: times.length ? new Date(Math.max(...times)) : null,
      };
    },
  };
}
