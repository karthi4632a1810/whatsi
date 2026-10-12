/**
 * End-to-end test of the OP send pipeline: a throwaway MongoDB database and a
 * fake WATI server (integration/mock-wati.mjs) — no real WhatsApp is sent.
 *
 *   npm run test:integration
 *
 * Needs a MongoDB: by default the Docker one on 127.0.0.1:3002, logging in as
 * MONGO_APP_USER from the root .env (database whatsi_integration_test, emptied
 * before and after). Override with TEST_MONGODB_URI.
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { startMockWati } from "./mock-wati.mjs";

dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });
const { MONGO_APP_USER, MONGO_APP_PASSWORD } = process.env;
const defaultUri = MONGO_APP_USER
  ? `mongodb://${MONGO_APP_USER}:${MONGO_APP_PASSWORD}@127.0.0.1:3002/whatsi_integration_test?authSource=whatsi`
  : "mongodb://127.0.0.1:3002/whatsi_integration_test";

Object.assign(process.env, {
  MONGODB_URI: process.env.TEST_MONGODB_URI || defaultUri,
  WATI_URL: "http://127.0.0.1:9911",
  WATI_TOKEN: "test-token",
  WATI_SEND_ENABLED: "true",
  WATI_TEST_MODE: "false",
  EMR_POLL_ENABLED: "false",
  JWT_SECRET: "integration-test-secret-0123456789",
  PUBLIC_BASE_URL: "https://whatsi.test.example",
});

if (!/\/[^/?]*test[^/?]*(\?|$)/i.test(process.env.MONGODB_URI)) {
  console.error("Refusing to run: TEST_MONGODB_URI must point at a database with 'test' in its name");
  process.exit(1);
}

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const models = await import(`${SRC}/models/index.js`);
const reports = await import(`${SRC}/services/reports.js`);
const delivery = await import(`${SRC}/services/delivery.js`);
const opBoard = await import(`${SRC}/services/opBoard.js`);
const analytics = await import(`${SRC}/services/analytics.js`);
const { reportDayKey, startOfToday, endOfToday } = await import(`${SRC}/utils/dates.js`);
const { readReportToken } = await import(`${SRC}/services/reportLinks.js`);

const { HisLabOrder, Report, MessageLog, AutomationSettings, Patient } = models;
const wati = await startMockWati();
await mongoose.connect(process.env.MONGODB_URI);
// Empty the test database (dropping collections only needs readWrite).
const emptyDb = async () => {
  for (const c of await mongoose.connection.db.collections()) await c.drop();
};
await emptyDb();
for (const name of mongoose.modelNames()) await mongoose.model(name).createIndexes();

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (error) {
    results.push(["FAIL", name, error.message]);
  }
};

const day = reportDayKey();
// Pick "now" as 15:00 India time today so quiet hours never interfere.
const now = new Date(`${day}T15:00:00+05:30`);
const hoursAgo = (h) => new Date(now.getTime() - h * 3600e3);
const order = (id, extra) => ({
  labDay: day,
  orderId: String(id),
  patientId: `P${id}`,
  patientName: `PATIENT ${id}`,
  phone: `9190000000${String(id).slice(-2)}`,
  department: "GENERAL MEDICINE",
  opIpType: "OP",
  patientType: "GENERAL",
  hisStatus: "RESULT APPROVED",
  readiness: "READY",
  procedureTotal: 2,
  approvedCount: 2,
  procIds: [55501, 55502],
  procedures: [
    { name: "CBC", status: "RESULT APPROVED", procId: 55501 },
    { name: "LFT", status: "RESULT APPROVED", procId: 55502 },
  ],
  requestDate: hoursAgo(6),
  completedAt: hoursAgo(4),
  ...extra,
});

await AutomationSettings.create({
  automationEnabled: true,
  messageSendEnabled: true,
  mode: "AFTER_READY",
  sendDelayHours: 3,
  quietHoursEnabled: true,
  quietStart: "21:00",
  quietEnd: "07:00",
});

await HisLabOrder.insertMany([
  order(900001, {}), // A: approved 4 h ago → due
  order(900002, { completedAt: hoursAgo(1) }), // B: approved 1 h ago → scheduled
  order(900003, { readiness: "WAITING", approvedCount: 0, hisStatus: "IN PROCESS" }), // C
  order(900004, { patientType: "ZPATIENT" }), // D: excluded
  order(900005, { phone: "" }), // E: no phone
  order(900006, { completedAt: hoursAgo(30) }), // F: too old for auto-send
  order(900007, {}), // G: not on WhatsApp (mock)
  order(900008, {}), // H: WATI 500 → temporary failure
  order(900009, { opIpType: "IP", opIpRaw: "IP IP0701" }), // I: IP — must be ignored
  order(900010, { completedAt: hoursAgo(1) }), // J: for the per-report claim race
]);

await check("queue sync takes READY OP orders only (no IP, no Z patient)", async () => {
  const sync = await reports.syncLabBoardToQueue({ from: startOfToday(), to: endOfToday() });
  const queued = (await Report.find().lean()).map((r) => r.reportId).sort();
  assert.deepEqual(queued, ["900001", "900002", "900005", "900006", "900007", "900008", "900010"]);
  assert.equal(sync.created, 7);
  assert.equal(sync.updated, 0);
});

await check("second sync updates instead of creating (includeResultMetadata fix)", async () => {
  const sync = await reports.syncLabBoardToQueue({ from: startOfToday(), to: endOfToday() });
  assert.equal(sync.created, 0);
  assert.equal(sync.updated, 7);
});

await check("three senders at once → exactly one WhatsApp per patient", async () => {
  const [a, b, c] = await Promise.all([
    reports.dispatchDueReports({ now }),
    reports.dispatchDueReports({ now }),
    reports.sendPendingReports({ triggerType: "MANUAL", reportIds: (await Report.find({ reportId: "900001" })).map((r) => r._id) }),
  ]);
  const toA = wati.sends.filter((s) => s.phone === "919000000001");
  assert.equal(toA.length, 1, `A got ${toA.length} messages (runs: ${JSON.stringify([a, b, c].map((r) => r.sent))})`);
});

const byId = async (id) => Report.findOne({ reportId: id }).lean();

await check("same report sent from 3 places at once (no batch lock) → one message", async () => {
  const j = await Report.findOne({ reportId: "900010" });
  const outcomes = await Promise.allSettled([
    reports.sendReportById(j._id, { triggerType: "MANUAL" }),
    reports.sendReportById(j._id, { triggerType: "MANUAL" }),
    reports.sendReportById(j._id, { triggerType: "AUTO_DELAYED" }),
  ]);
  const ok = outcomes.filter((o) => o.status === "fulfilled").length;
  assert.equal(ok, 1, JSON.stringify(outcomes.map((o) => o.reason?.message || "sent")));
  assert.equal(wati.sends.filter((s) => s.phone === "919000000010").length, 1);
});

// the batches that found the lock busy run again a minute later
await reports.dispatchDueReports({ now: new Date(now.getTime() + 60e3) });

await check("A (approved 4 h ago) was sent and recorded", async () => {
  const r = await byId("900001");
  assert.equal(r.status, "SENT");
  assert.equal(r.deliveryStatus, "sent");
  assert.ok(r.watiMessageId);
  const log = await MessageLog.findOne({ reportId: "900001" }).lean();
  assert.equal(log.status, "SENT");
  assert.ok(log.watiLocalMessageId);
});

await check("WATI gets a private expiring whatsi link, not the EMR address", async () => {
  const sent = wati.sends.find((x) => x.phone === "919000000001");
  const link = sent.params.find((p) => p.name === "attachmentLink").value;
  assert.match(link, /^https:\/\/whatsi\.test\.example\/api\/public\/report\/[\w-]+\.[\w-]+\/Lab-Report-900001\.pdf$/);
  assert.ok(!link.includes("emr.mapims"), link);
  const token = link.split("/report/")[1].split("/")[0];
  const report = await Report.findOne({ reportId: "900001" });
  assert.deepEqual(readReportToken(token), { reportId: String(report._id) });
});

await check("B (approved 1 h ago) waits — not sent before 3 hours", async () => {
  assert.equal((await byId("900002")).status, "PENDING");
  assert.equal(wati.sends.filter((s) => s.phone === "919000000002").length, 0);
});

await check("E (no phone) and F (30 h old) are not sent automatically", async () => {
  assert.equal((await byId("900005")).status, "PENDING");
  assert.equal((await byId("900006")).status, "PENDING");
  assert.equal(wati.sends.filter((s) => s.phone === "919000000006").length, 0);
});

await check("G (not on WhatsApp) fails permanently — no auto retry", async () => {
  const r = await byId("900007");
  assert.equal(r.status, "FAILED");
  assert.equal(r.failureKind, "NOT_ON_WHATSAPP");
  assert.equal(r.retryable, false);
});

await check("H (WATI 500) fails temporarily with a retry time", async () => {
  const r = await byId("900008");
  assert.equal(r.status, "FAILED");
  assert.equal(r.failureKind, "TEMPORARY");
  assert.equal(r.retryable, true);
  assert.ok(new Date(r.nextRetryAt) > new Date());
});

await check("B goes out once its 3 hours have passed", async () => {
  const later = new Date(now.getTime() + 2 * 3600e3 + 60e3);
  await reports.dispatchDueReports({ now: later });
  assert.equal((await byId("900002")).status, "SENT");
});

await check("nothing is sent during quiet hours", async () => {
  await Report.updateOne({ reportId: "900002" }, { $set: { status: "PENDING" } });
  const night = new Date(`${day}T22:30:00+05:30`);
  const before = wati.sends.length;
  const result = await reports.dispatchDueReports({ now: night });
  assert.equal(result.skipped, "quiet hours");
  assert.equal(wati.sends.length, before);
  await Report.updateOne({ reportId: "900002" }, { $set: { status: "SENT" } });
});

await check("sending switched off → nothing goes out", async () => {
  await AutomationSettings.updateOne({}, { $set: { messageSendEnabled: false } });
  const r = await reports.dispatchDueReports({ now: new Date(now.getTime() + 5 * 3600e3) });
  assert.equal(r.skipped, "sending off");
  await AutomationSettings.updateOne({}, { $set: { messageSendEnabled: true } });
});

await check("manual send of an already-sent report needs an explicit resend", async () => {
  const r = await Report.findOne({ reportId: "900001" });
  await assert.rejects(reports.sendReportById(r._id, { triggerType: "MANUAL" }), /Already sent/);
  const before = wati.sends.length;
  await reports.sendReportById(r._id, { triggerType: "MANUAL", force: true, sentBy: "staff@test" });
  assert.equal(wati.sends.length, before + 1);
  assert.equal((await byId("900001")).sentBy, "staff@test");
});

await check("webhook: delivered then read updates the report", async () => {
  const log = await MessageLog.findOne({ reportId: "900001", status: "SENT" }).sort({ sentAt: -1 });
  let r = await delivery.handleWatiStatusEvent({ eventType: "sentMessageDELIVERED_v2", localMessageId: log.watiLocalMessageId });
  assert.equal(r.matched, true);
  assert.equal((await byId("900001")).deliveryStatus, "delivered");
  r = await delivery.handleWatiStatusEvent({ eventType: "sentMessageREAD_v2", localMessageId: log.watiLocalMessageId });
  assert.equal((await byId("900001")).deliveryStatus, "read");
  // a late "delivered" never moves it back
  await delivery.handleWatiStatusEvent({ eventType: "sentMessageDELIVERED_v2", localMessageId: log.watiLocalMessageId });
  assert.equal((await byId("900001")).deliveryStatus, "read");
});

await check("status checks (no webhook) pick up the ticks for B", async () => {
  await models.WatiApiSnapshot.deleteOne({ key: "webhook" }); // webhook "not active"
  await MessageLog.updateMany({ reportId: "900002" }, { $set: { nextCheckAt: new Date(Date.now() - 1000), sentAt: new Date(Date.now() - 40 * 60e3) } });
  wati.markRead("919000000002");
  const run = await delivery.runDeliveryChecks();
  assert.equal(run.error, "", run.error);
  assert.ok(run.numbers >= 1, JSON.stringify(run));
  assert.equal((await byId("900002")).deliveryStatus, "read");
});

await check("a send stuck in QUEUED after a crash becomes 'Check needed'", async () => {
  await Report.updateOne({ reportId: "900006" }, { $set: { status: "QUEUED", queuedAt: new Date(Date.now() - 20 * 60e3) } });
  const n = await reports.recoverStaleSends();
  assert.equal(n, 1);
  assert.equal((await byId("900006")).status, "NEEDS_REVIEW");
});

await check("adding a phone number re-queues a 'no phone' failure", async () => {
  await Report.updateOne({ reportId: "900005" }, { $set: { status: "FAILED", failureKind: "NO_PHONE" } });
  const patient = await Patient.findOne({ patientId: "P900005" });
  patient.phoneOverride = "919000000055";
  await patient.save();
  // same logic as PATCH /api/patients/:id
  await Report.updateMany({ patientRef: patient._id, status: { $in: ["PENDING", "FAILED"] } }, { $set: { phone: "919000000055" } });
  await Report.updateMany(
    { patientRef: patient._id, status: "FAILED", failureKind: { $in: ["NO_PHONE", "NOT_ON_WHATSAPP"] } },
    { $set: { status: "PENDING", failureKind: "" } }
  );
  assert.equal((await byId("900005")).status, "PENDING");
});

await check("results changed in HIS → a queued report is held again", async () => {
  await HisLabOrder.updateOne({ orderId: "900005" }, { $set: { readiness: "PARTIAL", approvedCount: 1 } });
  const sync = await reports.syncLabBoardToQueue({ from: startOfToday(), to: endOfToday() });
  assert.equal(sync.held, 1);
  const r = await byId("900005");
  assert.equal(r.readiness, "PARTIAL");
  const d = await reports.dispatchDueReports({ now: new Date(now.getTime() + 1 * 3600e3) });
  assert.equal(wati.sends.filter((s) => s.phone === "919000000055").length, 0, JSON.stringify(d));
});

await check("OP Reports list: stages, counts, no IP orders", async () => {
  const list = await opBoard.listOpReports({ from: day, to: day });
  const ids = list.rows.map((r) => r.orderId);
  assert.ok(!ids.includes("900009"), "IP order listed");
  const stageOf = (id) => list.rows.find((r) => r.orderId === id)?.stage.key;
  assert.equal(stageOf("900003"), "in_lab");
  assert.equal(stageOf("900004"), "excluded");
  assert.equal(stageOf("900001"), "read");
  assert.equal(stageOf("900007"), "failed");
  assert.equal(stageOf("900006"), "review");
  assert.equal(list.counts.all, 9);
  const searched = await opBoard.listOpReports({ from: day, to: day, q: "900007" });
  assert.equal(searched.total, 1);
  const failed = await opBoard.listOpReports({ from: day, to: day, stage: "failed" });
  assert.ok(failed.rows.every((r) => r.stage.key === "failed"));
});

await check("analytics computes without errors", async () => {
  const a = await analytics.getAnalytics({ from: day, to: day });
  assert.equal(a.kpis.opOrders, 9);
  assert.ok(a.kpis.sent >= 2);
  assert.ok(a.kpis.read >= 2);
  assert.equal(a.series.length, 1);
  assert.ok(Array.isArray(a.failures));
});

await check("WhatsApp Monitor: counts, coverage, attention, patients, activity, export", async () => {
  const monitor = await import(`${SRC}/services/monitor.js`);
  const q = { from: day, to: day, basis: "report" };
  const summary = await monitor.monitorSummary(q);
  assert.ok(summary.total >= 5, JSON.stringify(summary.counts));
  assert.equal(summary.range.granularity, "hour");
  assert.equal(summary.series.length, 24);
  assert.ok(summary.counts.read >= 2, JSON.stringify(summary.counts));
  assert.ok(summary.notOnWhatsApp.messages >= 1, "G is not on WhatsApp");
  assert.ok(summary.failedToSend >= 1, "H failed to send");
  const pending = await monitor.monitorMessages({ ...q, status: "pending" });
  assert.ok(pending.items.every((m) => m.status === "pending"));
  assert.ok(pending.items.some((m) => m.review), "the 'Check needed' report shows as pending");
  const insights = await monitor.monitorInsights(q);
  assert.ok(insights.coverage.ready >= 6, JSON.stringify(insights.coverage));
  assert.ok(insights.coverage.counts.read >= 1);
  assert.ok(insights.attention.nowa >= 1 && insights.attention.review >= 1, JSON.stringify(insights.attention));
  assert.equal(insights.trend.length, 14);
  const patients = await monitor.monitorPatients(q);
  assert.ok(patients.items.length >= 4);
  assert.ok(patients.items.every((p) => p.reports.length >= 1 && p.uhid));
  const search = await monitor.monitorMessages({ ...q, q: "900007" });
  assert.ok(search.items.length >= 1 && search.items.every((m) => m.orderId === "900007"));
  const detail = await monitor.monitorMessage(search.items[0].id);
  assert.equal(detail.orderId, "900007");
  const activity = await monitor.monitorActivity(10);
  assert.ok(activity.length >= 3 && activity.every((e) => e.at && e.status));
  const csv = await monitor.monitorExport({ ...q, format: "csv" });
  assert.match(csv.body, /Status,Patient,UHID,Order/);
  assert.ok(csv.body.split("\r\n").length >= summary.total + 1);
  const wati = await monitor.monitorWati();
  assert.match(wati.webhookPath, /^\/api\/webhooks\/wati\/[a-f0-9]{32}$/);
});

// KEEP_TEST_DATA=1 leaves the test database filled (e.g. to look at the screens).
if (!process.env.KEEP_TEST_DATA) await emptyDb();
await mongoose.disconnect();
await wati.close();

for (const [status, name, detail] of results) console.log(`${status}  ${name}${detail ? `\n      → ${detail}` : ""}`);
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed · WATI mock received ${wati.sends.length} sends`);
process.exit(failed ? 1 : 0);
