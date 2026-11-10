import { HisLabOrder, Report, Patient } from "../models/index.js";
import { fetchLabRowsForRegNo, looksLikeEmrOrderId, DELIVERY_OP_IP_TYPE } from "./emr.js";
import { getOrderPdf } from "./reportPdf.js";
import { parseQueryDate, reportDayKey } from "../utils/dates.js";

/** Extract UHID / Patient ID from request (query, body, or params) */
export function extractUhid(req) {
  const val =
    req.params?.uhid ||
    req.query?.uhid ||
    req.query?.UHID ||
    req.query?.patientId ||
    req.query?.patient_id ||
    req.query?.regNo ||
    req.query?.reg_no ||
    req.body?.uhid ||
    req.body?.UHID ||
    req.body?.patientId ||
    req.body?.patient_id ||
    req.body?.regNo ||
    req.body?.reg_no;
  return val ? String(val).trim() : null;
}

/** Extract Order ID if specified */
export function extractOrderId(req) {
  const val =
    req.params?.orderId ||
    req.query?.orderId ||
    req.query?.order_id ||
    req.query?.order ||
    req.query?.requestNo ||
    req.query?.request_no ||
    req.body?.orderId ||
    req.body?.order_id ||
    req.body?.order ||
    req.body?.requestNo;
  return val ? String(val).trim() : null;
}

/** Determine whether client wants PDF or JSON */
export function extractFormat(req) {
  const explicit = String(req.query?.format || req.body?.format || "").trim().toLowerCase();
  if (explicit === "json") return "json";
  if (explicit === "pdf") return "pdf";

  const download = String(req.query?.download || req.query?.direct || req.body?.download || "").toLowerCase();
  if (["true", "1", "yes"].includes(download)) return "pdf";

  const base64 = String(req.query?.base64 || req.body?.base64 || "").toLowerCase();
  if (["true", "1", "yes"].includes(base64)) return "json";

  const accept = String(req.headers?.accept || "").toLowerCase();
  if (accept.includes("application/json") && !accept.includes("application/pdf")) {
    return "json";
  }

  // Default to streaming the lab report PDF
  return "pdf";
}

export function extractBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  }
  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${protocol}://${host}`;
}

function cleanPatientName(name) {
  return String(name || "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\s,;:]+$/, "")
    .trim();
}

/**
 * Find all lab orders for a given UHID across Mongo & EMR,
 * and select the best order (or the specifically requested orderId).
 */
export async function findOrdersByUhid({
  uhid,
  orderId = null,
  date = null,
  from = null,
  to = null,
  fresh = false,
}) {
  const cleanUhid = String(uhid).trim();
  if (!cleanUhid) {
    throw Object.assign(new Error("UHID is required"), { status: 400, expose: true });
  }

  // Parse date filters if provided
  let filterDay = null;
  let fromDate = null;
  let toDate = null;

  if (date) {
    try {
      filterDay = reportDayKey(parseQueryDate(date, false));
    } catch {
      // keep raw string if parsing fails
      filterDay = String(date).trim();
    }
  }
  if (from) {
    try {
      fromDate = parseQueryDate(from, false);
    } catch {
      // ignore
    }
  }
  if (to) {
    try {
      toDate = parseQueryDate(to, true);
    } catch {
      // ignore
    }
  }

  // 1. Check HisLabOrder in MongoDB
  const query = { patientId: cleanUhid };
  if (filterDay) query.labDay = filterDay;
  if (orderId && looksLikeEmrOrderId(orderId)) query.orderId = String(orderId);

  const [hisOrders, mongoReports, patientContact] = await Promise.all([
    HisLabOrder.find(query).sort({ labDay: -1, orderId: -1 }).lean(),
    Report.find(query).sort({ reportDay: -1, reportId: -1 }).lean(),
    Patient.findOne({ patientId: cleanUhid }).lean().catch(() => null),
  ]);

  const ordersMap = new Map();

  for (const o of hisOrders) {
    ordersMap.set(String(o.orderId), {
      orderId: String(o.orderId),
      labDay: o.labDay,
      patientId: o.patientId || cleanUhid,
      patientName: cleanPatientName(o.patientName),
      phone: o.phone || "",
      department: o.department || "",
      doctor: o.doctor || "",
      age: o.age || "",
      gender: o.gender || "",
      readiness: o.readiness || "WAITING",
      hisStatus: o.hisStatus || "",
      procedureTotal: o.procedureTotal || (o.procedures || []).length || 0,
      approvedCount: o.approvedCount || 0,
      procIds: o.procIds || [],
      requestDate: o.requestDate || null,
      completedAt: o.completedAt || null,
      procedures: (o.procedures || []).map((p) => ({
        name: p.name,
        status: p.status,
        result: p.result,
        procId: p.procId,
        completedAt: p.completedAt,
      })),
      source: "mongodb-board",
    });
  }

  for (const r of mongoReports) {
    const id = String(r.reportId);
    if (!ordersMap.has(id)) {
      ordersMap.set(id, {
        orderId: id,
        labDay: r.reportDay || "",
        patientId: r.patientId || cleanUhid,
        patientName: cleanPatientName(r.patientName),
        phone: r.phone || "",
        department: r.department || "",
        doctor: "",
        age: "",
        gender: "",
        readiness: r.readiness || "WAITING",
        hisStatus: r.emrStatus || "",
        procedureTotal: r.procedureTotal || 0,
        approvedCount: r.approvedCount || 0,
        procIds: r.procIds || [],
        requestDate: r.createdAt || null,
        completedAt: r.reportReadyAt || null,
        procedures: (r.procedureNames || []).map((name, i) => ({
          name,
          procId: r.procIds?.[i],
          status: "RESULT APPROVED",
        })),
        source: "mongodb-report",
      });
    }
  }

  // 2. If no orders found in Mongo or explicitly requested fresh, query EMR
  if (!ordersMap.size || fresh) {
    try {
      const emrRows = await fetchLabRowsForRegNo({
        regNo: cleanUhid,
        from: fromDate,
        to: toDate,
      });

      for (const row of emrRows) {
        if (!row.orderId) continue;
        const id = String(row.orderId);
        if (orderId && id !== String(orderId)) continue;

        if (!ordersMap.has(id)) {
          ordersMap.set(id, {
            orderId: id,
            labDay: row.requestDate ? reportDayKey(row.requestDate) : "",
            patientId: row.regNo || cleanUhid,
            patientName: cleanPatientName(row.patientName),
            phone: row.mobile || "",
            department: row.department || "",
            doctor: row.doctor || "",
            age: row.age || "",
            gender: row.gender || "",
            readiness: row.status === "RESULT APPROVED" ? "READY" : "WAITING",
            hisStatus: row.status || "",
            procedureTotal: 0,
            approvedCount: 0,
            procIds: [],
            requestDate: row.requestDate || null,
            completedAt: row.completedAt || null,
            procedures: [],
            source: "emr",
          });
        }

        const entry = ordersMap.get(id);
        if (row.procId && !entry.procIds.includes(row.procId)) {
          entry.procIds.push(row.procId);
        }
        entry.procedureTotal += 1;
        if (row.status === "RESULT APPROVED") {
          entry.approvedCount += 1;
        }
        if (row.completedAt && (!entry.completedAt || row.completedAt > entry.completedAt)) {
          entry.completedAt = row.completedAt;
        }
        entry.procedures.push({
          name: row.procedureName,
          status: row.status,
          procId: row.procId,
          result: row.result,
          completedAt: row.completedAt,
        });

        if (entry.approvedCount > 0 && entry.approvedCount === entry.procedureTotal) {
          entry.readiness = "READY";
        } else if (entry.approvedCount > 0) {
          entry.readiness = "PARTIAL";
        }
      }
    } catch (emrErr) {
      console.warn(`[uhidReports] EMR fallback error for UHID ${cleanUhid}:`, emrErr.message);
    }
  }

  const allOrders = Array.from(ordersMap.values());

  if (!allOrders.length) {
    return {
      uhid: cleanUhid,
      patient: patientContact
        ? {
            uhid: cleanUhid,
            name: cleanPatientName(patientContact.name),
            phone: patientContact.phone || patientContact.phoneOverride || "",
          }
        : { uhid: cleanUhid },
      orders: [],
      selectedOrder: null,
    };
  }

  // Sort orders: READY first, then by date/orderId descending
  allOrders.sort((a, b) => {
    // If orderId was specifically requested, put it first
    if (orderId && a.orderId === String(orderId)) return -1;
    if (orderId && b.orderId === String(orderId)) return 1;

    // Prefer orders that have approved results / are READY
    const scoreA = a.readiness === "READY" ? 2 : a.approvedCount > 0 ? 1 : 0;
    const scoreB = b.readiness === "READY" ? 2 : b.approvedCount > 0 ? 1 : 0;
    if (scoreA !== scoreB) return scoreB - scoreA;

    // Then newest date / orderId
    const dateA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
    const dateB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
    if (dateA !== dateB) return dateB - dateA;

    return Number(b.orderId || 0) - Number(a.orderId || 0);
  });

  const selectedOrder =
    (orderId ? allOrders.find((o) => o.orderId === String(orderId)) : null) ||
    allOrders[0];

  const firstWithDetails = allOrders.find((o) => o.patientName || o.phone) || selectedOrder;
  const patient = {
    uhid: cleanUhid,
    name: firstWithDetails?.patientName || cleanPatientName(patientContact?.name) || "",
    gender: firstWithDetails?.gender || "",
    age: firstWithDetails?.age || "",
    phone: firstWithDetails?.phone || patientContact?.phone || patientContact?.phoneOverride || "",
    department: firstWithDetails?.department || "",
    doctor: firstWithDetails?.doctor || "",
  };

  return {
    uhid: cleanUhid,
    patient,
    orders: allOrders,
    selectedOrder,
  };
}

/**
 * Fetch the PDF for the selected order using the robust pdfCache / AOSTA system
 */
export async function getUhidReportPdf({
  uhid,
  orderId = null,
  date = null,
  fresh = false,
}) {
  const result = await findOrdersByUhid({ uhid, orderId, date, fresh });
  if (!result.selectedOrder) {
    throw Object.assign(new Error(`No lab reports found for UHID: ${uhid}`), {
      status: 404,
      expose: true,
      code: "NO_REPORTS_FOUND",
    });
  }

  const order = result.selectedOrder;
  const pdf = await getOrderPdf(order.orderId, {
    day: order.labDay,
    procIds: order.procIds,
    fresh,
  });

  return {
    patient: result.patient,
    selectedOrder: order,
    allOrders: result.orders,
    pdf,
  };
}

