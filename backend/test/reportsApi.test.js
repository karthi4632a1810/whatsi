import test from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "unit-test-secret-0123456789abcdef";
const { extractUhid, extractOrderId, extractFormat } = await import("../src/services/uhidReports.js");

test("extractUhid parses various casing and parameter names", () => {
  assert.equal(extractUhid({ query: { uhid: "6127148" } }), "6127148");
  assert.equal(extractUhid({ query: { UHID: "6127148" } }), "6127148");
  assert.equal(extractUhid({ query: { regNo: " 6127148 " } }), "6127148");
  assert.equal(extractUhid({ query: { patientId: "6127148" } }), "6127148");
  assert.equal(extractUhid({ body: { uhid: "6127148" } }), "6127148");
  assert.equal(extractUhid({ body: { UHID: "6127148" } }), "6127148");
  assert.equal(extractUhid({ params: { uhid: "6127148" } }), "6127148");
  assert.equal(extractUhid({ query: {} }), null);
});

test("extractOrderId parses various order parameter names", () => {
  assert.equal(extractOrderId({ query: { orderId: "399422" } }), "399422");
  assert.equal(extractOrderId({ query: { order: "399422" } }), "399422");
  assert.equal(extractOrderId({ query: { requestNo: "399422" } }), "399422");
  assert.equal(extractOrderId({ body: { orderId: "399422" } }), "399422");
  assert.equal(extractOrderId({ query: {} }), null);
});

test("extractFormat resolves pdf vs json appropriately", () => {
  // Default is pdf for lab report fetching
  assert.equal(extractFormat({ query: {}, headers: {} }), "pdf");

  // Explicit formats
  assert.equal(extractFormat({ query: { format: "json" } }), "json");
  assert.equal(extractFormat({ query: { format: "pdf" } }), "pdf");
  assert.equal(extractFormat({ body: { format: "json" } }), "json");

  // Download flag forces pdf
  assert.equal(extractFormat({ query: { download: "true" } }), "pdf");
  assert.equal(extractFormat({ query: { direct: "1" } }), "pdf");

  // Base64 flag implies json
  assert.equal(extractFormat({ query: { base64: "true" } }), "json");

  // Accept header
  assert.equal(extractFormat({ query: {}, headers: { accept: "application/json" } }), "json");
  assert.equal(extractFormat({ query: {}, headers: { accept: "application/pdf" } }), "pdf");
  assert.equal(extractFormat({ query: { format: "pdf" }, headers: { accept: "application/json" } }), "pdf");
});

