/**
 * Private, expiring links for the lab report PDF sent on WhatsApp.
 *
 * The EMR's LabReport.aspx serves any report without a login, and its URL is
 * just Orderid + Procids — guessable. With PUBLIC_BASE_URL set, patients get
 * https://<whatsi>/api/public/report/<signed token>/Lab-Report-<order>.pdf
 * instead: the token names one queued report and when the link stops working,
 * and whatsi fetches the PDF from the EMR itself. Unset, the EMR URL is sent as before.
 *
 * WATI (WhatsApp) downloads the document from this link when sending, so the
 * address must be reachable from the internet.
 */
import crypto from "node:crypto";
import { config } from "../config.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function signingKey() {
  return crypto
    .createHmac("sha256", process.env.REPORT_LINK_SECRET || config.jwtSecret)
    .update("whatsi-report-link")
    .digest();
}

function sign(payload) {
  return crypto.createHmac("sha256", signingKey()).update(payload).digest("base64url").slice(0, 32);
}

export function reportLinksEnabled() {
  return Boolean(config.publicBaseUrl);
}

export function signReportToken(reportId, { now = Date.now(), days = config.reportLinkDays } = {}) {
  const payload = Buffer.from(JSON.stringify({ r: String(reportId), e: Math.floor((now + days * DAY_MS) / 1000) })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** { reportId } for a good token, { expired: true } for an old one, null for a bad one. */
export function readReportToken(token, { now = Date.now() } = {}) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const { r, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!/^[a-f0-9]{24}$/i.test(String(r))) return null;
    if (!Number.isFinite(e) || e * 1000 < now) return { expired: true };
    return { reportId: r };
  } catch {
    return null;
  }
}

/** The link to send for this report, or null when links are off (send the EMR URL). */
export function reportLinkFor(report, options) {
  if (!reportLinksEnabled()) return null;
  const orderId = String(report.reportId || "report").replace(/[^\w-]+/g, "");
  return `${config.publicBaseUrl}/api/public/report/${signReportToken(report._id, options)}/Lab-Report-${orderId}.pdf`;
}
