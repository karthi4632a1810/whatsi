import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const { createPdfCache, memoryStore, pdfProblem, pdfContentKey, cacheRelPath } = await import("../src/services/pdfCache.js");

// A real-looking PDF: header, some body, end marker.
const pdf = (text) => Buffer.from(`%PDF-1.4\n${text}\n${"x".repeat(2000)}\n%%EOF\n`, "latin1");

/** Fake EMR (AOSTA LabReport.aspx): serves whatever `respond` says, counts hits. */
async function fakeEmr() {
  const state = { hits: 0, respond: () => ({ status: 200, body: pdf("report v1") }) };
  const server = http.createServer((req, res) => {
    state.hits += 1;
    const r = state.respond(req);
    if (r.hang) return; // never answers
    res.writeHead(r.status, { "Content-Type": r.type || "application/pdf" });
    res.end(r.body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/BB15SE/Lab/CRReport/LabReport.aspx?Orderid=386209`;
  return { state, url, close: () => new Promise((r) => server.close(r)) };
}

async function setup(t, { enabled = true } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pdfcache-test-"));
  const emr = await fakeEmr();
  const store = memoryStore();
  const fetchPdf = async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw Object.assign(new Error(`AOSTA answered ${res.status}`), { status: 502 });
    return Buffer.from(await res.arrayBuffer());
  };
  let clock = new Date("2026-10-16T09:00:00Z");
  const cache = createPdfCache({ dir, store, fetchPdf, enabled: () => enabled, now: () => clock, log: { warn() {} } });
  t.after(async () => {
    await emr.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const order = {
    orderId: "386209",
    labDay: "2026-10-16",
    readiness: "READY",
    procIds: [101, 102],
    approvedCount: 2,
    procedureTotal: 2,
    procedures: [
      { name: "HBA1C [GLYCATED HAEMOGLOBIN]", status: "RESULT APPROVED", result: "9.4 %" },
      { name: "GLUCOSE [FBS]", status: "RESULT APPROVED", result: "110 mg/dl" },
    ],
  };
  const ctx = (o = order) => ({ ...o, contentKey: pdfContentKey(o), resolveUrl: async () => emr.url });
  return { dir, emr, store, cache, order, ctx, setClock: (d) => (clock = d) };
}

test("pdfProblem: real PDFs pass; EMR error pages, cut-off and tiny files don't", () => {
  assert.equal(pdfProblem(pdf("ok")), null);
  assert.match(pdfProblem(Buffer.from("<!DOCTYPE html><html><body>Runtime error</body></html>")), /web page/);
  assert.match(pdfProblem(Buffer.from("%PDF-1.4 tiny %%EOF")), /too small/);
  assert.match(pdfProblem(Buffer.from(`%PDF-1.4\n${"x".repeat(3000)}`)), /cut off/);
  assert.match(pdfProblem(Buffer.alloc(0)), /empty/);
});

test("file names carry only the order id and a hash, in YYYY/MM/DD folders", () => {
  const rel = cacheRelPath({ orderId: "386209", labDay: "2026-10-16", checksum: "abcdef0123456789" });
  assert.equal(rel, "2026/10/16/386209-abcdef012345.pdf");
  assert.equal(cacheRelPath({ orderId: "../../etc/passwd", labDay: "2026-10-16", checksum: "aa" }), "2026/10/16/etcpasswd-aa.pdf");
});

test("valid copy: first open fetches and saves, the next is served from disk without AOSTA", async (t) => {
  const { cache, emr, store, dir, ctx } = await setup(t);
  const first = await cache.get(ctx());
  assert.equal(first.source, "fresh");
  assert.equal(first.saved, true);
  assert.equal(emr.state.hits, 1);
  const row = await store.get("386209");
  assert.equal(row.path, `2026/10/16/386209-${row.checksum.slice(0, 12)}.pdf`);
  const st = await fs.stat(path.join(dir, row.path));
  assert.equal(st.mode & 0o777, 0o600, "file readable by the backend user only");

  const second = await cache.get(ctx());
  assert.equal(second.source, "cache");
  assert.equal(emr.state.hits, 1, "AOSTA not called again");
  assert.ok(second.buffer.equals(first.buffer));
});

test("stale: a changed order (new result value) fetches again and replaces the file", async (t) => {
  const { cache, emr, store, dir, ctx, order } = await setup(t);
  await cache.get(ctx());
  const oldPath = (await store.get("386209")).path;

  const changed = { ...order, procedures: [{ ...order.procedures[0], result: "9.9 %" }, order.procedures[1]] };
  assert.equal(await cache.markStaleIfChanged("386209", pdfContentKey(changed)), true);
  assert.equal((await store.get("386209")).stale, true);

  emr.state.respond = () => ({ status: 200, body: pdf("report v2") });
  const r = await cache.get(ctx(changed));
  assert.equal(r.source, "fresh");
  assert.match(r.buffer.toString("latin1"), /report v2/);
  const row = await store.get("386209");
  assert.equal(row.stale, false);
  assert.notEqual(row.path, oldPath);
  await assert.rejects(fs.access(path.join(dir, oldPath)), "old file removed");
  assert.equal(await cache.markStaleIfChanged("386209", pdfContentKey(changed)), false, "same content → not stale");
});

test("missing or damaged file: fetched again instead of serving it", async (t) => {
  const { cache, emr, store, dir, ctx } = await setup(t);
  await cache.get(ctx());
  await fs.unlink(path.join(dir, (await store.get("386209")).path));
  const r = await cache.get(ctx());
  assert.equal(r.source, "fresh");
  assert.equal(emr.state.hits, 2);

  await fs.writeFile(path.join(dir, (await store.get("386209")).path), pdf("tampered"));
  assert.equal((await cache.get(ctx())).source, "fresh", "checksum mismatch → not served");
});

test("AOSTA down: a saved copy is served (even stale) and labelled; without one it's an error", async (t) => {
  const { cache, emr, ctx, order } = await setup(t);
  await cache.get(ctx());
  await cache.markStaleIfChanged("386209", "something-else");
  emr.state.respond = () => ({ status: 500, body: "Server Error", type: "text/html" });
  const r = await cache.get(ctx());
  assert.equal(r.source, "stale-cache");
  assert.equal(r.stale, true);
  assert.ok(r.fetchedAt);

  await assert.rejects(cache.get(ctx({ ...order, orderId: "999999" })), (e) => e.status === 502);
});

test("AOSTA returns an error page: not saved, and the saved copy is used instead", async (t) => {
  const { cache, emr, store, ctx } = await setup(t);
  emr.state.respond = () => ({ status: 200, body: "<html>Session expired</html>", type: "text/html" });
  await assert.rejects(cache.get(ctx()), /usable PDF/);
  assert.equal(await store.get("386209"), null, "nothing saved");
  emr.state.respond = () => ({ status: 200, body: pdf("good") });
  await cache.get(ctx());
  emr.state.respond = () => ({ status: 200, body: "<html>Session expired</html>", type: "text/html" });
  assert.equal((await cache.get(ctx(), { fresh: true })).source, "stale-cache");
});

test("partly approved: always fetched live, never saved", async (t) => {
  const { cache, emr, store, ctx, order } = await setup(t);
  const partial = { ...order, readiness: "PARTIAL", approvedCount: 1 };
  assert.equal((await cache.get(ctx(partial))).source, "live");
  assert.equal((await cache.get(ctx(partial))).source, "live");
  assert.equal(emr.state.hits, 2);
  assert.equal(await store.get("386209"), null);
  assert.deepEqual(await cache.warm(ctx(partial)), { skipped: "not ready or switched off" });
});

test("switched off: fetched every time and not saved", async (t) => {
  const { cache, emr, store, ctx } = await setup(t, { enabled: false });
  await cache.get(ctx());
  await cache.get(ctx());
  assert.equal(emr.state.hits, 2);
  assert.equal(await store.get("386209"), null);
});

test("fresh=true (Get fresh from AOSTA) bypasses a valid copy", async (t) => {
  const { cache, emr, ctx } = await setup(t);
  await cache.get(ctx());
  assert.equal((await cache.get(ctx(), { fresh: true })).source, "fresh");
  assert.equal(emr.state.hits, 2);
});

test("warm saves ahead of time once", async (t) => {
  const { cache, emr, ctx } = await setup(t);
  assert.equal((await cache.warm(ctx())).saved, true);
  assert.deepEqual(await cache.warm(ctx()), { skipped: "already saved" });
  assert.equal(emr.state.hits, 1);
});

test("sweep: expired copies, records without a file and stray files are removed", async (t) => {
  const { cache, store, dir, ctx, order, setClock } = await setup(t);
  await cache.get(ctx());
  await cache.get(ctx({ ...order, orderId: "386210" }));
  await cache.get(ctx({ ...order, orderId: "386211" }));
  // 386210 fetched long ago; 386211's file vanished; a stray file nobody points to.
  store.rows.get("386210").fetchedAt = new Date("2026-01-01T00:00:00Z");
  await fs.unlink(path.join(dir, store.rows.get("386211").path));
  await fs.mkdir(path.join(dir, "2026/09/01"), { recursive: true });
  await fs.writeFile(path.join(dir, "2026/09/01/123-abc.pdf"), pdf("stray"));

  setClock(new Date("2026-10-17T03:15:00Z"));
  const r = await cache.sweep({ days: 120 });
  assert.equal(r.expired, 1);
  assert.equal(r.missingFiles, 1);
  assert.equal(r.orphanFiles, 1);
  assert.equal(r.files, 1);
  assert.ok(r.bytes > 0);
  assert.deepEqual([...store.rows.keys()], ["386209"]);
  await assert.rejects(fs.access(path.join(dir, "2026/09/01")), "empty folders removed");
});

test("an unwritable folder only means no saving — reports still open", async (t) => {
  const { emr, ctx } = await setup(t);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pdfcache-ro-"));
  await fs.chmod(dir, 0o500);
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = memoryStore();
  const cache = createPdfCache({ dir: path.join(dir, "reports"), store, fetchPdf: (u) => fetch(u).then(async (r) => Buffer.from(await r.arrayBuffer())), log: { warn() {} } });
  const r = await cache.get(ctx());
  assert.equal(r.source, "fresh");
  assert.equal(r.saved, false);
  assert.equal(await store.get("386209"), null);
  assert.equal(emr.state.hits, 1);
});
