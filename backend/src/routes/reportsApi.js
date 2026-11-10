import express from "express";
import cors from "cors";
import {
  extractUhid,
  extractOrderId,
  extractFormat,
  extractBaseUrl,
  findOrdersByUhid,
  getUhidReportPdf,
} from "../services/uhidReports.js";

const router = express.Router();

// Enable CORS so this report fetch API can be called from any frontend, mobile app, or external system
router.use(cors({ origin: true, credentials: true }));

/**
 * Handle report request by UHID
 */
async function handleUhidReport(req, res, forceDownload = false) {
  const uhid = extractUhid(req);
  if (!uhid) {
    return res.status(400).json({
      ok: false,
      error: "UHID parameter is required (e.g. ?uhid=6127148)",
      code: "MISSING_UHID",
    });
  }

  const orderId = extractOrderId(req);
  const date = req.query?.date || req.query?.day || req.body?.date || req.body?.day || null;
  const from = req.query?.from || req.query?.fromDate || req.body?.from || req.body?.fromDate || null;
  const to = req.query?.to || req.query?.toDate || req.body?.to || req.body?.toDate || null;
  const fresh =
    req.query?.fresh === "true" ||
    req.query?.fresh === "1" ||
    req.body?.fresh === true;
  const base64 =
    req.query?.base64 === "true" ||
    req.query?.base64 === "1" ||
    req.body?.base64 === true;
  const download =
    forceDownload ||
    req.query?.download === "true" ||
    req.query?.download === "1" ||
    req.query?.direct === "true" ||
    req.body?.download === true;

  const format = forceDownload ? "pdf" : extractFormat(req);

  try {
    const reportData = await getUhidReportPdf({
      uhid,
      orderId,
      date,
      fresh,
    });

    const { patient, selectedOrder, allOrders, pdf } = reportData;
    res.locals.pdfSource = pdf.source;

    // PDF Binary Stream Response
    if (format === "pdf") {
      const filename = `Lab-Report-${selectedOrder.orderId}.pdf`;
      const disposition = download ? "attachment" : "inline";

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Length", pdf.buffer.length);
      res.setHeader("Content-Disposition", `${disposition}; filename="${filename}"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Pdf-Source", pdf.source);
      res.setHeader("X-Order-Id", String(selectedOrder.orderId));
      res.setHeader("X-Patient-Id", String(uhid));
      res.setHeader("X-Readiness", selectedOrder.readiness || "");
      if (pdf.fetchedAt) res.setHeader("X-Pdf-Fetched-At", new Date(pdf.fetchedAt).toISOString());
      if (pdf.stale) res.setHeader("X-Pdf-Stale", "1");

      if (req.method === "HEAD") return res.end();
      return res.end(pdf.buffer);
    }

    // JSON Metadata Response
    const baseUrl = extractBaseUrl(req);
    const downloadUrl = `${baseUrl}/api/reports?uhid=${encodeURIComponent(uhid)}&orderId=${selectedOrder.orderId}&format=pdf`;
    const directDownloadUrl = `${baseUrl}/api/reports/download?uhid=${encodeURIComponent(uhid)}&orderId=${selectedOrder.orderId}`;

    return res.json({
      ok: true,
      patient,
      selectedOrder: {
        ...selectedOrder,
        downloadUrl,
        directDownloadUrl,
        pdf: {
          available: true,
          name: `Lab-Report-${selectedOrder.orderId}.pdf`,
          mimeType: "application/pdf",
          size: pdf.buffer.length,
          source: pdf.source,
          fetchedAt: pdf.fetchedAt || null,
          stale: Boolean(pdf.stale),
          base64: base64 ? pdf.buffer.toString("base64") : undefined,
        },
      },
      orders: allOrders.map((o) => ({
        ...o,
        downloadUrl: `${baseUrl}/api/reports?uhid=${encodeURIComponent(uhid)}&orderId=${o.orderId}&format=pdf`,
        directDownloadUrl: `${baseUrl}/api/reports/download?uhid=${encodeURIComponent(uhid)}&orderId=${o.orderId}`,
      })),
      downloadUrl: `${baseUrl}/api/reports?uhid=${encodeURIComponent(uhid)}&format=pdf`,
      directDownloadUrl: `${baseUrl}/api/reports/download?uhid=${encodeURIComponent(uhid)}`,
    });
  } catch (error) {
    const status = error.status || (error.code === "NO_REPORTS_FOUND" ? 404 : 500);
    return res.status(status).json({
      ok: false,
      error: error.message || "Failed to retrieve lab report",
      code: error.code || "REPORT_FETCH_ERROR",
      uhid,
      orderId: orderId || undefined,
    });
  }
}

/**
 * Service status check
 */
router.get("/status", (_req, res) => {
  res.json({ ok: true, service: "whatsi-lab-reports-api" });
});

/**
 * Direct file download streaming endpoint (as attachment)
 */
router.get("/download", (req, res) => {
  return handleUhidReport(req, res, true);
});

/**
 * Direct PDF streaming endpoint (inline)
 */
router.get("/pdf", (req, res) => {
  req.query.format = "pdf";
  return handleUhidReport(req, res, false);
});

/**
 * Convenience routes by path param: /api/reports/by-uhid/:uhid and /api/reports/by-uhid/:uhid/pdf
 */
router.get("/by-uhid/:uhid/pdf", (req, res) => {
  req.query.format = "pdf";
  return handleUhidReport(req, res, false);
});

router.get("/by-uhid/:uhid", (req, res) => {
  return handleUhidReport(req, res, false);
});

/**
 * Main GET /api/reports handler:
 * - If UHID is supplied, fetch the lab report PDF (or JSON if requested).
 * - If NO UHID is supplied, pass to next() (internal staff queue management).
 */
router.get("/", (req, res, next) => {
  if (extractUhid(req)) {
    return handleUhidReport(req, res, false);
  }
  return next();
});

/**
 * Main POST /api/reports handler:
 * - Accepts JSON payload with { uhid, orderId, format, base64, ... }
 */
router.post("/", (req, res, next) => {
  if (extractUhid(req)) {
    return handleUhidReport(req, res, false);
  }
  return next();
});

export default router;

