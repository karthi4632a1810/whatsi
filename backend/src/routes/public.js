import express from "express";
import { Report } from "../models/index.js";
import { DELIVERY_OP_IP_TYPE, isEmrReportUrl } from "../services/emr.js";
import { readReportToken } from "../services/reportLinks.js";
import { getReportPdf } from "../services/reportPdf.js";

const router = express.Router();

const text = (res, status, message) => res.status(status).type("text/plain").send(message);

/**
 * The lab report PDF behind a signed WhatsApp link (no login — WATI and the
 * patient's phone open it). The token decides which report; nothing else in
 * the request does. Served from whatsi's saved copy when there is one
 * (services/reportPdf.js) — the folder itself is never exposed.
 */
async function servePdf(req, res) {
  const claim = readReportToken(req.params.token);
  if (!claim) return text(res, 404, "Report not found");
  if (claim.expired) {
    return text(res, 410, "This link has expired. Please ask the hospital to send your lab report again.");
  }

  const report = await Report.findById(claim.reportId)
    .select("reportId reportDay hisReportUrl opIpType procIds readiness approvedCount procedureTotal")
    .lean();
  if (!report || report.opIpType !== DELIVERY_OP_IP_TYPE || !isEmrReportUrl(report.hisReportUrl)) {
    return text(res, 404, "Report not found");
  }

  // The saved copy when current, else AOSTA (saved when READY); AOSTA down → the saved copy.
  let buffer;
  try {
    buffer = (await getReportPdf(report)).buffer;
  } catch {
    return text(res, 503, "The report is temporarily unavailable. Please try again in a few minutes.");
  }

  const name = `Lab-Report-${String(report.reportId).replace(/[^\w-]+/g, "")}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Length", buffer.length);
  res.setHeader("Content-Disposition", `inline; filename="${name}"`);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.method === "HEAD") return res.end();
  res.end(buffer);
}

// (Express answers HEAD with the GET handler.)
router.get("/report/:token/:filename", servePdf);

export default router;
