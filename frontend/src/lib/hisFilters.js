export function applyHisFilter(orders, filter = "all") {
  const list = orders || [];
  if (filter === "approved") {
    return list.filter((o) => o.statusCounts?.["RESULT APPROVED"]);
  }
  if (filter === "ready") {
    return list.filter((o) => o.readiness === "READY");
  }
  if (filter === "completed") {
    return list.filter(
      (o) => o.hisStatus === "RESULT APPROVED" || o.hisStatus === "COMPLETED"
    );
  }
  return list;
}

export function applyHisSearch(orders, query = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return orders || [];

  const digits = q.replace(/\D/g, "");
  return (orders || []).filter((order) => {
    const patientId = String(order.patientId || "").toLowerCase();
    const orderId = String(order.orderId || "").toLowerCase();
    const patientName = String(order.patientName || "").toLowerCase();
    const phone = String(order.phone || "").replace(/\D/g, "");

    if (patientId.includes(q) || orderId.includes(q) || patientName.includes(q)) return true;
    if (digits && (patientId.includes(digits) || orderId.includes(digits) || phone.includes(digits))) {
      return true;
    }
    return false;
  });
}

export function filterHisOrders(orders, { filter = "all", query = "" } = {}) {
  return applyHisSearch(applyHisFilter(orders, filter), query);
}

// ——— Advanced search & filters (HIS Lab Today) ———

export const SEARCH_FIELDS = [
  { value: "all", label: "All fields" },
  { value: "name", label: "Patient name" },
  { value: "uhid", label: "UHID" },
  { value: "order", label: "Order ID" },
  { value: "mobile", label: "Mobile" },
  { value: "dept", label: "Department" },
  { value: "test", label: "Test name" },
];

export const EMPTY_ADVANCED = {
  department: "",
  hisStatus: "",
  readiness: "",
  whatsapp: "",
  patientType: "",
  tests: "",
  mobile: "",
  timeFrom: "",
  timeTo: "",
};

export const TESTS_OPTIONS = [
  { value: "all", label: "All tests approved" },
  { value: "some", label: "Some approved" },
  { value: "none", label: "None approved" },
];

export const MOBILE_OPTIONS = [
  { value: "valid", label: "Valid number" },
  { value: "invalid", label: "Missing / placeholder" },
];

const lower = (v) => String(v || "").toLowerCase();
const digitsOf = (v) => String(v || "").replace(/\D/g, "");

/** A term like "98765", "+91 98765" or "(044)" is matched against digits only. */
const isNumericTerm = (term) => /^[\d+\-()]+$/.test(term) && /\d/.test(term);

/**
 * WhatsApp can only reach a real Indian mobile. HIS uses fillers such as
 * 919000000000 when the number is unknown, so those count as missing.
 */
export function isValidMobile(phone) {
  let d = digitsOf(phone);
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length !== 10 || !/^[6-9]/.test(d)) return false;
  return !/^(\d)\1{8}$/.test(d.slice(1));
}

function testNames(order) {
  return (order.procedures || []).map((p) => lower(p.name)).filter(Boolean);
}

function termMatches(order, term, field) {
  const numeric = isNumericTerm(term);
  const digits = numeric ? digitsOf(term) : "";
  const has = (value) => lower(value).includes(term);
  const hasDigits = (value) => digits && digitsOf(value).includes(digits);

  switch (field) {
    case "name":
      return has(order.patientName);
    case "uhid":
      return has(order.patientId) || hasDigits(order.patientId);
    case "order":
      return has(order.orderId) || hasDigits(order.orderId);
    case "mobile":
      return Boolean(hasDigits(order.phone));
    case "dept":
      return has(order.department);
    case "test":
      return testNames(order).some((name) => name.includes(term));
    default:
      if (numeric && (hasDigits(order.orderId) || hasDigits(order.patientId) || hasDigits(order.phone))) {
        return true;
      }
      // Statuses and patient type have their own dropdowns; matching them here
      // would make "general" hit every GENERAL-type patient.
      return (
        [order.orderId, order.patientId, order.patientName, order.department].some(has) ||
        testNames(order).some((name) => name.includes(term))
      );
  }
}

/** Every space-separated word must match, so "latha cbc" finds Latha's CBC order. */
export function searchHisOrders(orders, query = "", field = "all") {
  const terms = lower(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return orders || [];
  return (orders || []).filter((order) => terms.every((term) => termMatches(order, term, field)));
}

/** "HH:MM" of the order's completed time in the browser's clock (IST on site). */
function completedClock(order) {
  if (!order.completedAt) return "";
  const d = new Date(order.completedAt);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function applyAdvancedFilters(orders, adv = EMPTY_ADVANCED) {
  return (orders || []).filter((o) => {
    if (adv.department && o.department !== adv.department) return false;
    if (adv.hisStatus && o.hisStatus !== adv.hisStatus) return false;
    if (adv.readiness && o.readiness !== adv.readiness) return false;
    if (adv.whatsapp && (o.whatsappLabel || "Not queued") !== adv.whatsapp) return false;
    if (adv.patientType && o.patientType !== adv.patientType) return false;

    if (adv.tests) {
      const done = Number(o.approvedCount) || 0;
      const total = Number(o.procedureTotal) || 0;
      if (adv.tests === "all" && !(total > 0 && done >= total)) return false;
      if (adv.tests === "some" && !(done > 0 && done < total)) return false;
      if (adv.tests === "none" && done !== 0) return false;
    }

    if (adv.mobile) {
      const valid = isValidMobile(o.phone);
      if (adv.mobile === "valid" && !valid) return false;
      if (adv.mobile === "invalid" && valid) return false;
    }

    if (adv.timeFrom || adv.timeTo) {
      const clock = completedClock(o);
      if (!clock) return false;
      if (adv.timeFrom && clock < adv.timeFrom) return false;
      if (adv.timeTo && clock > adv.timeTo) return false;
    }
    return true;
  });
}

/** Status pill + search + advanced filters, in that order. */
export function filterHisBoard(orders, { filter = "all", query = "", field = "all", advanced = EMPTY_ADVANCED } = {}) {
  return applyAdvancedFilters(searchHisOrders(applyHisFilter(orders, filter), query, field), advanced);
}

export function countActiveAdvanced(adv = EMPTY_ADVANCED) {
  const keys = Object.keys(EMPTY_ADVANCED).filter((k) => k !== "timeFrom" && k !== "timeTo");
  return keys.filter((k) => adv[k]).length + (adv.timeFrom || adv.timeTo ? 1 : 0);
}

function valueCounts(orders, pick) {
  const counts = new Map();
  for (const o of orders || []) {
    const value = pick(o);
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** Dropdown choices built from the day's board, each with how many orders it has. */
export function buildFilterOptions(orders) {
  const fixedCounts = (key, choices) =>
    choices.map((c) => ({
      ...c,
      count: applyAdvancedFilters(orders, { ...EMPTY_ADVANCED, [key]: c.value }).length,
    }));
  return {
    department: valueCounts(orders, (o) => o.department),
    hisStatus: valueCounts(orders, (o) => o.hisStatus),
    readiness: valueCounts(orders, (o) => o.readiness),
    whatsapp: valueCounts(orders, (o) => o.whatsappLabel || "Not queued"),
    patientType: valueCounts(orders, (o) => o.patientType),
    tests: fixedCounts("tests", TESTS_OPTIONS),
    mobile: fixedCounts("mobile", MOBILE_OPTIONS),
  };
}

export function computeHisSummary(orders) {
  const list = orders || [];
  return {
    totalOrders: list.length,
    ready: list.filter((o) => o.readiness === "READY").length,
    partial: list.filter((o) => o.readiness === "PARTIAL").length,
    approved: list.filter((o) => o.hisStatus === "RESULT APPROVED").length,
    inProcess: list.filter((o) => o.statusCounts?.["IN PROCESS"]).length,
    sent: list.filter((o) => o.whatsappTone === "sent").length,
    pendingWhatsApp: list.filter(
      (o) => o.whatsappTone === "pending" || o.whatsappTone === "idle"
    ).length,
    testSent: list.filter((o) => o.whatsappTone === "test").length,
  };
}
