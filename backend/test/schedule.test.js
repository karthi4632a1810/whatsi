import test from "node:test";
import assert from "node:assert/strict";
import {
  autoSendDecision,
  classifyFailure,
  deriveStage,
  isQuietTime,
  nextAllowedTime,
  nextRetryTime,
  plannedSendAt,
} from "../src/utils/schedule.js";

// India time helper: ist("2026-10-06 14:00")
const ist = (s) => new Date(`${s.replace(" ", "T")}:00+05:30`);
const iso = (d) => d.toISOString();

const settings = {
  mode: "AFTER_READY",
  sendDelayHours: 3,
  quietHoursEnabled: true,
  quietStart: "21:00",
  quietEnd: "07:00",
  maxAutoSendAgeHours: 24,
  readinessRule: "STRICT",
  retryPolicy: { maxAttempts: 3, retryIntervalMinutes: 15 },
};
const flagsOn = { sendingOn: true, automationOn: true, testMode: false };

test("report approved at 11:00 goes out at 14:00", () => {
  const report = { readiness: "READY", reportReadyAt: ist("2026-10-06 11:00") };
  assert.equal(iso(plannedSendAt(report, settings)), iso(ist("2026-10-06 14:00")));
});

test("approval at 20:00 would send at 23:00 → held until 07:00 next day", () => {
  const report = { readiness: "READY", reportReadyAt: ist("2026-10-06 20:00") };
  assert.equal(iso(plannedSendAt(report, settings)), iso(ist("2026-10-07 07:00")));
});

test("approval at 03:00 → 06:00 is still quiet → 07:00 same day", () => {
  const report = { readiness: "READY", reportReadyAt: ist("2026-10-07 03:00") };
  assert.equal(iso(plannedSendAt(report, settings)), iso(ist("2026-10-07 07:00")));
});

test("quiet hours boundaries: 21:00 is quiet, 07:00 is not", () => {
  assert.equal(isQuietTime(ist("2026-10-06 21:00"), settings), true);
  assert.equal(isQuietTime(ist("2026-10-06 20:59"), settings), false);
  assert.equal(isQuietTime(ist("2026-10-07 06:59"), settings), true);
  assert.equal(isQuietTime(ist("2026-10-07 07:00"), settings), false);
});

test("quiet hours off → exactly 3 hours later, even at night", () => {
  const report = { readiness: "READY", reportReadyAt: ist("2026-10-06 20:00") };
  assert.equal(iso(plannedSendAt(report, { ...settings, quietHoursEnabled: false })), iso(ist("2026-10-06 23:00")));
});

test("daytime quiet window (13:00–14:00) holds until 14:00 the same day", () => {
  const s = { ...settings, quietStart: "13:00", quietEnd: "14:00" };
  assert.equal(iso(nextAllowedTime(ist("2026-10-06 13:30"), s)), iso(ist("2026-10-06 14:00")));
  assert.equal(iso(nextAllowedTime(ist("2026-10-06 12:30"), s)), iso(ist("2026-10-06 12:30")));
});

test("not due before the delay, due after it", () => {
  const report = { readiness: "READY", reportReadyAt: ist("2026-10-06 11:00") };
  assert.equal(autoSendDecision(report, settings, ist("2026-10-06 13:59")).due, false);
  assert.equal(autoSendDecision(report, settings, ist("2026-10-06 14:00")).due, true);
});

test("a report found late (app was off) is sent at once — but never during quiet hours", () => {
  const report = { readiness: "READY", reportReadyAt: ist("2026-10-06 09:00") };
  assert.equal(autoSendDecision(report, settings, ist("2026-10-06 18:00")).due, true);
  const decision = autoSendDecision(report, settings, ist("2026-10-06 22:00"));
  assert.equal(decision.due, false);
  assert.equal(decision.reason, "quiet-hours");
});

test("partly approved reports wait under the strict rule", () => {
  const report = { readiness: "PARTIAL", reportReadyAt: ist("2026-10-06 09:00") };
  assert.equal(autoSendDecision(report, settings, ist("2026-10-06 15:00")).reason, "not-ready");
  assert.equal(autoSendDecision(report, { ...settings, readinessRule: "PARTIAL" }, ist("2026-10-06 15:00")).due, true);
});

test("reports approved more than 24 h ago are not sent automatically", () => {
  const report = { readiness: "READY", reportReadyAt: ist("2026-10-04 10:00") };
  assert.equal(autoSendDecision(report, settings, ist("2026-10-06 10:00")).reason, "too-old");
});

test("no EMR approval time → the delay counts from when whatsi saw it ready", () => {
  const report = { readiness: "READY", reportReadyAt: null, readySeenAt: ist("2026-10-06 10:15") };
  assert.equal(iso(plannedSendAt(report, settings)), iso(ist("2026-10-06 13:15")));
});

test("once-a-day mode plans the next 18:00 run", () => {
  const eod = { ...settings, mode: "END_OF_DAY", endOfDayTime: "18:00" };
  assert.equal(iso(plannedSendAt({ reportReadyAt: ist("2026-10-06 11:00") }, eod)), iso(ist("2026-10-06 18:00")));
  assert.equal(iso(plannedSendAt({ reportReadyAt: ist("2026-10-06 19:00") }, eod)), iso(ist("2026-10-07 18:00")));
});

test("old IMMEDIATE setting means no delay", () => {
  const report = { readiness: "READY", reportReadyAt: ist("2026-10-06 11:00") };
  assert.equal(iso(plannedSendAt(report, { ...settings, mode: "IMMEDIATE" })), iso(ist("2026-10-06 11:00")));
});

test("failure classification decides automatic retries", () => {
  assert.deepEqual(classifyFailure("Patient phone missing — add a number"), { kind: "NO_PHONE", retryable: false });
  assert.deepEqual(classifyFailure("+919999999999 is not a WhatsApp number"), { kind: "NOT_ON_WHATSAPP", retryable: false });
  assert.deepEqual(classifyFailure("WATI API usage limit exceeded (429) — will retry later"), { kind: "TEMPORARY", retryable: true });
  assert.deepEqual(classifyFailure("WATI send failed (400): template not found"), { kind: "WATI_REJECTED", retryable: false });
  assert.deepEqual(classifyFailure("WATI send failed: ECONNRESET"), { kind: "TEMPORARY", retryable: true });
  assert.deepEqual(classifyFailure("Missing PDF URL — procedure IDs not resolved"), { kind: "TEMPORARY", retryable: true });
});

test("retry backoff doubles and respects quiet hours", () => {
  assert.equal(iso(nextRetryTime(1, settings, ist("2026-10-06 12:00"))), iso(ist("2026-10-06 12:15")));
  assert.equal(iso(nextRetryTime(2, settings, ist("2026-10-06 12:00"))), iso(ist("2026-10-06 12:30")));
  assert.equal(iso(nextRetryTime(1, settings, ist("2026-10-06 20:50"))), iso(ist("2026-10-07 07:00")));
});

test("stages: the label staff see for each situation", () => {
  const now = ist("2026-10-06 12:00");
  const order = { readiness: "READY", phone: "919999999999", patientType: "GENERAL" };
  const stageOf = (report, extra = {}) =>
    deriveStage({ order: { ...order, ...extra.order }, report, settings, flags: extra.flags || flagsOn, now }).key;

  assert.equal(stageOf(null, { order: { readiness: "WAITING" } }), "in_lab");
  assert.equal(stageOf(null, { order: { readiness: "PARTIAL" } }), "partial");
  assert.equal(stageOf(null), "ready");
  assert.equal(stageOf(null, { order: { patientType: "ZPATIENT" } }), "excluded");
  assert.equal(stageOf(null, { order: { phone: "" } }), "no_phone");

  const pending = { status: "PENDING", readiness: "READY", phone: "919999999999", reportReadyAt: ist("2026-10-06 10:00") };
  assert.equal(stageOf(pending), "scheduled");
  assert.equal(stageOf({ ...pending, reportReadyAt: ist("2026-10-06 08:00") }), "due");
  assert.equal(stageOf({ ...pending, reportReadyAt: ist("2026-10-06 08:00") }, { flags: { ...flagsOn, sendingOn: false } }), "held");
  assert.equal(stageOf({ ...pending, reportReadyAt: ist("2026-10-04 08:00") }), "held");

  assert.equal(stageOf({ status: "QUEUED" }), "sending");
  assert.equal(stageOf({ status: "SENT", deliveryStatus: "sent" }), "sent");
  assert.equal(stageOf({ status: "SENT", deliveryStatus: "delivered" }), "delivered");
  assert.equal(stageOf({ status: "SENT", deliveryStatus: "read" }), "read");
  assert.equal(stageOf({ status: "FAILED", failureKind: "NOT_ON_WHATSAPP" }), "failed");
  assert.equal(stageOf({ status: "FAILED", failureKind: "NO_PHONE" }), "no_phone");
  assert.equal(stageOf({ status: "NEEDS_REVIEW" }), "review");
});
