/**
 * Lab Finder: OP test results across patients — "everyone with HbA1c above 9
 * last month", "urine sugar positive in General Medicine". Searches the
 * approved RESULT values saved on the OP board (HisLabOrder.procedures), which
 * fill in as each lab day is loaded from HIS — no extra HIS calls.
 *
 * HIS rows carry no reference ranges, so there are no High / Low flags: use a
 * number range (min / max) or the result text instead.
 */
import { HisLabOrder } from "../models/index.js";
import { DELIVERY_OP_IP_TYPE } from "./emr.js";
import { splitTestName } from "../utils/emrParse.js";
import { addIstDays as addDaysToKey, reportDayKey } from "../utils/dates.js";

const MAX_ROWS = 5000;
const MAX_RANGE_DAYS = 366;
const DEFAULT_DAYS = 30;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const words = (text) =>
  String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
const num = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : Number(v));

const badRequest = (message) => Object.assign(new Error(message), { status: 400, expose: true });

/** The lab days to search: from / to (YYYY-MM-DD), default the last 30 days, at most a year. */
export function searchRange(q = {}) {
  const today = reportDayKey(new Date());
  const to = DAY_RE.test(q.to || "") ? q.to : today;
  const from = DAY_RE.test(q.from || "") ? q.from : addDaysToKey(to, -(DEFAULT_DAYS - 1));
  if (from > to) throw badRequest("“From” is after “To”");
  if (addDaysToKey(from, MAX_RANGE_DAYS) < to) throw badRequest("Search at most one year at a time");
  return { from, to };
}

/** The Mongo filters for a Lab Finder query: { order, line }. */
export function buildFilters(q = {}) {
  const { from, to } = searchRange(q);
  const order = { opIpType: DELIVERY_OP_IP_TYPE, labDay: { $gte: from, $lte: to } };
  const line = { "procedures.result": { $nin: ["", null] } };

  const testWords = words(q.test);
  if (testWords.length) {
    line.$and = testWords.map((w) => ({ "procedures.name": { $regex: escapeRegex(w), $options: "i" } }));
  }
  if (String(q.value || "").trim()) {
    line["procedures.result"] = { $regex: escapeRegex(String(q.value).trim()), $options: "i" };
  }
  const min = num(q.min);
  const max = num(q.max);
  if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max))) throw badRequest("Min and max must be numbers");
  if (min !== null || max !== null) {
    line["procedures.value"] = { ...(min !== null ? { $gte: min } : {}), ...(max !== null ? { $lte: max } : {}) };
  }

  const patient = String(q.patient || "").trim();
  if (patient) {
    const rx = { $regex: escapeRegex(patient), $options: "i" };
    const digits = patient.replace(/\D/g, "");
    order.$or = [{ patientName: rx }, { patientId: rx }, { orderId: rx }, ...(digits.length >= 6 ? [{ phone: { $regex: escapeRegex(digits) } }] : [])];
  }
  if (String(q.department || "").trim()) order.department = { $regex: escapeRegex(String(q.department).trim()), $options: "i" };
  if (/^(male|female)$/i.test(String(q.gender || ""))) order.gender = { $regex: `^${q.gender}$`, $options: "i" };
  if (!testWords.length && !line["procedures.value"] && !String(q.value || "").trim() && !patient) {
    throw badRequest("Enter a test name, a result or a patient to search for");
  }
  return { order, line, from, to };
}

function toRow(doc) {
  const p = doc.procedures;
  const { test, group } = splitTestName(p.name);
  return {
    labDay: doc.labDay,
    orderId: doc.orderId,
    patientId: doc.patientId,
    patientName: doc.patientName,
    age: doc.age || "",
    gender: doc.gender || "",
    phone: doc.phone || "",
    department: doc.department || "",
    doctor: doc.doctor || "",
    test,
    group,
    result: p.result,
    value: Number.isFinite(p.value) ? p.value : null,
    unit: p.unit || "",
    completedAt: p.completedAt || doc.completedAt || null,
    canPreview: doc.readiness === "READY" || doc.readiness === "PARTIAL",
  };
}

export async function searchLabResults(q = {}) {
  const { order, line, from, to } = buildFilters(q);
  const docs = await HisLabOrder.aggregate([
    { $match: order },
    { $unwind: "$procedures" },
    { $match: line },
    { $sort: { labDay: -1, "procedures.completedAt": -1 } },
    { $limit: MAX_ROWS + 1 },
    {
      $project: {
        _id: 0,
        labDay: 1,
        orderId: 1,
        patientId: 1,
        patientName: 1,
        age: 1,
        gender: 1,
        phone: 1,
        department: 1,
        doctor: 1,
        readiness: 1,
        completedAt: 1,
        procedures: 1,
      },
    },
  ]);
  const truncated = docs.length > MAX_ROWS;
  const rows = docs.slice(0, MAX_ROWS).map(toRow);
  return {
    from,
    to,
    rows,
    truncated,
    patients: new Set(rows.map((r) => r.patientId || r.orderId)).size,
    orders: new Set(rows.map((r) => r.orderId)).size,
  };
}

/** Test-name suggestions for the search box (last 90 days, with how often they appear). */
export async function suggestTests(text = "") {
  const since = addDaysToKey(reportDayKey(new Date()), -90);
  const w = words(text);
  const nameMatch = w.length ? { $and: w.map((x) => ({ "procedures.name": { $regex: escapeRegex(x), $options: "i" } })) } : {};
  const rows = await HisLabOrder.aggregate([
    { $match: { opIpType: DELIVERY_OP_IP_TYPE, labDay: { $gte: since } } },
    { $unwind: "$procedures" },
    { $match: { "procedures.result": { $nin: ["", null] }, ...nameMatch } },
    { $group: { _id: "$procedures.name", n: { $sum: 1 }, numeric: { $sum: { $cond: [{ $isNumber: "$procedures.value" }, 1, 0] } }, unit: { $last: "$procedures.unit" } } },
    { $sort: { n: -1 } },
    { $limit: 15 },
  ]);
  return rows.map((r) => ({ name: r._id, ...splitTestName(r._id), count: r.n, numeric: r.numeric > r.n / 2, unit: r.unit || "" }));
}

/** Which lab days have results saved (results fill in as each day is loaded from HIS). */
export async function labCoverage() {
  const [range] = await HisLabOrder.aggregate([
    { $match: { opIpType: DELIVERY_OP_IP_TYPE, "procedures.result": { $nin: ["", null] } } },
    { $group: { _id: null, first: { $min: "$labDay" }, last: { $max: "$labDay" }, orders: { $sum: 1 }, days: { $addToSet: "$labDay" } } },
  ]);
  return range ? { first: range.first, last: range.last, orders: range.orders, days: range.days.length } : { first: null, last: null, orders: 0, days: 0 };
}

const CSV_COLUMNS = [
  ["labDay", "Lab day"],
  ["orderId", "Order"],
  ["patientId", "UHID"],
  ["patientName", "Patient"],
  ["age", "Age"],
  ["gender", "Gender"],
  ["department", "Department"],
  ["doctor", "Doctor"],
  ["group", "Test"],
  ["test", "Parameter"],
  ["result", "Result"],
  ["value", "Value"],
  ["unit", "Unit"],
];

export async function exportLabResults(q = {}) {
  const { rows, from, to } = await searchLabResults(q);
  const quote = (v) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CSV_COLUMNS.map(([, l]) => quote(l)).join(","), ...rows.map((r) => CSV_COLUMNS.map(([k]) => quote(r[k])).join(","))];
  return { body: `﻿${lines.join("\r\n")}\r\n`, fileName: `lab-finder-${from}_to_${to}.csv`, contentType: "text/csv; charset=utf-8", count: rows.length };
}
