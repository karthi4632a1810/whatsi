import test from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "unit-test-secret-0123456789abcdef";

const { checkRoute } = await import("../src/services/accessControl.js");
const { normalizePermissions, scheduleAllows, describeSchedule, publicUser, PRESETS } = await import("../src/services/users.js");
const { parseLabResult, splitTestName } = await import("../src/utils/emrParse.js");
const { buildFilters } = await import("../src/services/labResults.js");

const staff = (screens, extra = {}) => ({ role: "staff", permissions: { screens, schedule: { enabled: false } }, ...extra });
const admin = { role: "admin" };

test("super admin can call anything, including unlisted routes", () => {
  assert.equal(checkRoute(admin, "GET", "/api/users"), true);
  assert.equal(checkRoute(admin, "PUT", "/api/settings"), true);
  assert.equal(checkRoute(admin, "POST", "/api/some/new/route"), true);
});

test("unlisted routes are super-admin only", () => {
  const u = staff({ reports: "write", monitor: "write" });
  assert.match(String(checkRoute(u, "POST", "/api/some/new/route")), /super admin/);
  assert.match(String(checkRoute(u, "GET", "/api/users")), /super admin/);
  assert.match(String(checkRoute(u, "PUT", "/api/settings/automation")), /super admin/);
});

test("view-only can read OP reports but not send", () => {
  const u = staff({ reports: "read" });
  assert.equal(checkRoute(u, "GET", "/api/his/lab-today"), true);
  assert.equal(checkRoute(u, "GET", "/api/reports"), true);
  assert.equal(checkRoute(u, "GET", "/api/his/pdf/386209"), true);
  assert.match(String(checkRoute(u, "POST", "/api/reports/65f0a1b2c3d4e5f6a7b8c9d0/send")), /view-only/);
  assert.match(String(checkRoute(u, "POST", "/api/op/orders/386209/send")), /view-only/);
  assert.match(String(checkRoute(u, "POST", "/api/his/lab-today/refresh")), /view-only/);
  assert.match(String(checkRoute(u, "GET", "/api/his/lab-search")), /no access to Lab Search/);
});

test("write access sends; screens without access are blocked", () => {
  const u = staff({ reports: "write" });
  assert.equal(checkRoute(u, "POST", "/api/op/orders/386209/send"), true);
  assert.equal(checkRoute(u, "POST", "/api/reports/bulk-send"), true);
  assert.equal(checkRoute(u, "PUT", "/api/patients/by-uhid/6190347"), true);
  assert.match(String(checkRoute(u, "GET", "/api/monitor/summary")), /no access/);
  assert.match(String(checkRoute(u, "GET", "/api/audit/events")), /no access/);
});

test("everyone signed in reaches their profile, stats and audit events", () => {
  const u = staff({});
  for (const [m, p] of [["GET", "/api/me"], ["POST", "/api/me/password"], ["GET", "/api/stats"], ["POST", "/api/audit/events"], ["GET", "/api/settings/health"]]) {
    assert.equal(checkRoute(u, m, p), true, `${m} ${p}`);
  }
});

test("WhatsApp monitor read vs write; exports need the downloads switch", () => {
  const u = staff({ monitor: "read" });
  assert.equal(checkRoute(u, "GET", "/api/monitor/summary"), true);
  assert.equal(checkRoute(u, "GET", "/api/monitor/export"), true);
  assert.match(String(checkRoute(u, "POST", "/api/monitor/messages/abc/retry")), /view-only/);
});

test("permissions are normalised: unknown levels fall back, view-only screens never write", () => {
  const p = normalizePermissions({ screens: { reports: "write", search: "write", audit: "write", wati: "bogus" } });
  assert.equal(p.screens.reports, "write");
  assert.equal(p.screens.search, "read");
  assert.equal(p.screens.audit, "read");
  assert.equal(p.screens.wati, "none");
  assert.deepEqual(p.schedule.days, [1, 2, 3, 4, 5]);
  for (const preset of PRESETS) assert.ok(normalizePermissions(preset.permissions).screens);
});

test("access hours in India time, incl. overnight", () => {
  const weekdays = { enabled: true, days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00" };
  // Monday 12 Oct 2026, 10:00 IST = 04:30 UTC
  assert.equal(scheduleAllows(weekdays, new Date("2026-10-12T04:30:00Z")), true);
  // Monday 19:00 IST
  assert.equal(scheduleAllows(weekdays, new Date("2026-10-12T13:30:00Z")), false);
  // Sunday
  assert.equal(scheduleAllows(weekdays, new Date("2026-10-11T04:30:00Z")), false);
  const night = { enabled: true, days: [1], from: "20:00", to: "08:00" };
  // Tuesday 02:00 IST belongs to Monday night
  assert.equal(scheduleAllows(night, new Date("2026-10-12T20:30:00Z")), true);
  assert.equal(describeSchedule(weekdays), "Mon–Fri, 09:00–18:00");
  assert.equal(describeSchedule({ enabled: false }), "Any time");
});

test("publicUser never leaks the password hash", () => {
  const u = publicUser({ _id: "x", username: "nurse1", passwordHash: "secret", role: "staff", permissions: {} });
  assert.equal(u.passwordHash, undefined);
  assert.equal(u.isSuperAdmin, false);
  assert.equal(u.username, "nurse1");
});

test("HIS RESULT column parsing", () => {
  assert.deepEqual(parseLabResult(" 2.25 10*3/µl"), { result: "2.25 10*3/µl", value: 2.25, unit: "10*3/µl" });
  assert.deepEqual(parseLabResult(" 31.2 %"), { result: "31.2 %", value: 31.2, unit: "%" });
  assert.deepEqual(parseLabResult(" --"), { result: "", value: null, unit: "" });
  assert.deepEqual(parseLabResult("Negative"), { result: "Negative", value: null, unit: "" });
  assert.deepEqual(parseLabResult("<0.5 mg/dl"), { result: "<0.5 mg/dl", value: 0.5, unit: "mg/dl" });
  assert.deepEqual(splitTestName("DC - LYMPHOCYTES [COMPLETE BLOOD COUNT]"), { test: "DC - LYMPHOCYTES", group: "COMPLETE BLOOD COUNT" });
  assert.deepEqual(splitTestName("APPEARANCE. [URINE COMPLETE]"), { test: "APPEARANCE", group: "URINE COMPLETE" });
});

test("Lab Finder filters", () => {
  const f = buildFilters({ test: "hba1c", min: "9", from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(f.order.labDay, { $gte: "2026-09-01", $lte: "2026-09-30" });
  assert.deepEqual(f.line["procedures.value"], { $gte: 9 });
  assert.equal(f.line.$and.length, 1);
  assert.throws(() => buildFilters({ from: "2026-09-01", to: "2026-09-30" }), /test name/);
  assert.throws(() => buildFilters({ test: "x", from: "2026-10-01", to: "2026-09-01" }), /after/);
  assert.throws(() => buildFilters({ test: "x", from: "2024-01-01", to: "2026-01-01" }), /one year/);
  assert.throws(() => buildFilters({ test: "x", min: "abc" }), /numbers/);
});
