import test from "node:test";
import assert from "node:assert/strict";

process.env.PUBLIC_BASE_URL = "https://whatsi.example.org/";
process.env.REPORT_LINK_DAYS = "2";
process.env.JWT_SECRET = "unit-test-secret-0123456789abcdef";
const { readReportToken, reportLinkFor, signReportToken } = await import("../src/services/reportLinks.js");

const id = "6ac47b2110dac536975ed281";

test("a signed link names the report and works for 2 days", () => {
  const now = Date.now();
  const token = signReportToken(id, { now });
  assert.deepEqual(readReportToken(token, { now }), { reportId: id });
  assert.deepEqual(readReportToken(token, { now: now + 47 * 3600e3 }), { reportId: id });
  assert.deepEqual(readReportToken(token, { now: now + 49 * 3600e3 }), { expired: true });
});

test("a changed token is rejected (another report, longer expiry, junk)", () => {
  const token = signReportToken(id);
  const [payload, signature] = token.split(".");
  const other = Buffer.from(JSON.stringify({ r: "6ac47b2110dac536975ed999", e: 9999999999 })).toString("base64url");
  assert.equal(readReportToken(`${other}.${signature}`), null);
  const flipped = signature.slice(0, -1) + (signature.endsWith("x") ? "y" : "x");
  assert.equal(readReportToken(`${payload}.${flipped}`), null);
  assert.equal(readReportToken("nonsense"), null);
  assert.equal(readReportToken(""), null);
});

test("the WhatsApp link uses the public address and a readable file name", () => {
  const link = reportLinkFor({ _id: id, reportId: "382260" });
  assert.match(link, /^https:\/\/whatsi\.example\.org\/api\/public\/report\/[\w-]+\.[\w-]+\/Lab-Report-382260\.pdf$/);
  const token = link.split("/report/")[1].split("/")[0];
  assert.deepEqual(readReportToken(token), { reportId: id });
});
