import { useCallback, useEffect, useState } from "react";
import { api, getToken } from "../api.js";
import { CloseIcon, ExternalLinkIcon, FilePdfIcon, RefreshIcon } from "../portal/Icons.jsx";
import { fmtDateTime } from "../screens/ui.jsx";

function buildPdfSrc(order, { fresh = false } = {}) {
  const params = new URLSearchParams();
  if (order.procIds?.length) params.set("procIds", order.procIds.join(","));
  const day = order.labDay || order.reportDay;
  if (day) params.set("day", day);
  if (fresh) params.set("fresh", "1");
  const qs = params.toString();
  return `/api/his/pdf/${order.orderId}${qs ? `?${qs}` : ""}`;
}

/** Where the PDF on screen came from (X-Pdf-* headers from GET /api/his/pdf). */
function PdfSource({ source }) {
  if (!source?.kind) return null;
  const when = source.fetchedAt ? fmtDateTime(source.fetchedAt) : "";
  switch (source.kind) {
    case "cache":
      return (
        <span className="op-pdf-source is-cache" title="A copy saved on the server — AOSTA wasn't asked">
          <b>Saved copy</b>
          {when && ` · fetched ${when}`}
        </span>
      );
    case "fresh":
      return (
        <span className="op-pdf-source is-fresh" title="Fetched from AOSTA just now and saved for next time">
          <b>Fresh from AOSTA</b>
          {when && ` · ${when}`}
        </span>
      );
    case "live":
      return (
        <span className="op-pdf-source is-live" title="Not every result is approved yet, so this report isn't saved">
          <b>Live from AOSTA</b> · partly approved, not saved
        </span>
      );
    case "stale-cache":
      return (
        <span className="op-pdf-source is-stale" title="AOSTA didn't answer, so the last saved copy is shown">
          <b>Saved copy from {when || "earlier"}</b> · AOSTA didn’t answer
          {source.stale ? " — results have changed since" : ""}
        </span>
      );
    default:
      return null;
  }
}

export default function PdfPreviewModal({ order, onClose, canRefresh = false }) {
  const [blobUrl, setBlobUrl] = useState("");
  const [error, setError] = useState("");
  const [errorKind, setErrorKind] = useState("");
  const [source, setSource] = useState(null);
  const [loading, setLoading] = useState(true);
  const [linkUrl, setLinkUrl] = useState("");
  const [savingLink, setSavingLink] = useState(false);
  const [previewOrder, setPreviewOrder] = useState(order);

  const loadPdf = useCallback(async (targetOrder, { fresh = false } = {}) => {
    setLoading(true);
    setError("");
    setErrorKind("");
    setSource(null);
    setBlobUrl("");

    try {
      const token = getToken();
      const response = await fetch(buildPdfSrc(targetOrder, { fresh }), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        // 502/503: AOSTA down or answered with an error page, and no saved copy yet.
        setErrorKind(response.status === 403 ? "denied" : response.status >= 502 ? "aosta" : "link");
        throw new Error(payload.error || `Could not load PDF (HTTP ${response.status})`);
      }

      setSource({
        kind: response.headers.get("X-Pdf-Source") || "",
        fetchedAt: response.headers.get("X-Pdf-Fetched-At") || "",
        stale: response.headers.get("X-Pdf-Stale") === "1",
      });
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return objectUrl;
      });
    } catch (err) {
      setError(err.message || "Failed to load PDF preview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!order) {
      setPreviewOrder(null);
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return "";
      });
      setError("");
      setLoading(false);
      return undefined;
    }

    setPreviewOrder(order);
    setLinkUrl(order.hisReportUrl || "");
    loadPdf(order);

    return () => {
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return "";
      });
    };
  }, [order, loadPdf]);

  useEffect(() => {
    if (!order) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [order, onClose]);

  function handleClose() {
    setPreviewOrder(null);
    setBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return "";
    });
    onClose?.();
  }

  async function saveEmrLink(event) {
    event.preventDefault();
    if (!previewOrder || !linkUrl.trim()) return;

    setSavingLink(true);
    setError("");
    try {
      const { meta } = await api.saveOrderPdfMeta(previewOrder.orderId, {
        patientId: previewOrder.patientId,
        labReportUrl: linkUrl.trim(),
      });
      const nextOrder = {
        ...previewOrder,
        procIds: meta.procIds,
        hisReportUrl: meta.hisReportUrl,
        hasPdfLink: true,
      };
      setPreviewOrder(nextOrder);
      await loadPdf(nextOrder);
    } catch (err) {
      setError(err.message || "Could not save EMR print link");
    } finally {
      setSavingLink(false);
    }
  }

  if (!previewOrder) return null;

  const title = `${previewOrder.patientName || "Patient"} · Order ${previewOrder.orderId}`;
  const regLine = previewOrder.patientId ? `Reg ${previewOrder.patientId}` : null;

  return (
    <div className="um-modal-backdrop op-pdf-backdrop" role="presentation" onMouseDown={handleClose}>
      <div
        className="op-pdf-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Lab report preview for order ${previewOrder.orderId}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="op-pdf-head">
          <span className="op-pdf-icon">
            <FilePdfIcon size={18} />
          </span>
          <div className="op-pdf-title">
            <h3>{title}</h3>
            <p>
              {regLine ? `${regLine} · ` : ""}
              {source?.kind ? <PdfSource source={source} /> : "Lab report from AOSTA"}
            </p>
          </div>
          {canRefresh && (source?.kind === "cache" || source?.kind === "stale-cache") && !loading ? (
            <button
              type="button"
              className="btn btn-secondary op-pdf-fresh"
              onClick={() => loadPdf(previewOrder, { fresh: true })}
              title="Skip the saved copy and fetch the report from AOSTA again"
            >
              <RefreshIcon size={14} /> <span>{source.kind === "stale-cache" ? "Try AOSTA again" : "Get fresh from AOSTA"}</span>
            </button>
          ) : null}
          {blobUrl ? (
            <a className="btn btn-secondary" href={blobUrl} target="_blank" rel="noreferrer">
              <ExternalLinkIcon size={14} /> Open in tab
            </a>
          ) : null}
          <button type="button" className="um-icon-btn" onClick={handleClose} aria-label="Close">
            <CloseIcon size={18} />
          </button>
        </header>
        <div className="op-pdf-body">
          {loading ? (
            <div className="loading modern-loading">
              <div className="spinner" />
              <div>Loading the PDF…</div>
            </div>
          ) : null}
          {error ? (
            <div className="op-pdf-error">
              <div className="lock-error" role="alert">
                <span>{error}</span>
              </div>
              {errorKind === "aosta" ? (
                <p className="text-muted">
                  AOSTA didn’t send the report and there’s no saved copy of it yet. Try again in a few minutes.
                </p>
              ) : errorKind === "link" ? (
                <p className="text-muted">
                  The report's procedure IDs couldn't be read from AOSTA. Check the EMR login in <code>.env</code> (EMR_USERNAME / EMR_PASSWORD), or paste
                  the report's EMR Print address below.
                </p>
              ) : null}
              {errorKind === "aosta" ? (
                <div>
                  <button type="button" className="btn btn-secondary" onClick={() => loadPdf(previewOrder)}>
                    <RefreshIcon size={14} /> Try again
                  </button>
                </div>
              ) : null}
              {errorKind === "link" ? (
                <form className="op-pdf-link" onSubmit={saveEmrLink}>
                  <label htmlFor="emr-print-url">EMR Print URL</label>
                  <div className="op-pdf-link-row">
                    <input
                      id="emr-print-url"
                      type="url"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      placeholder="https://emr.mapims.edu.in/.../LabReport.aspx?action=Search&Orderid=..."
                    />
                    <button type="submit" className="btn btn-primary" disabled={savingLink || !linkUrl.trim()}>
                      {savingLink ? "Saving…" : "Save & preview"}
                    </button>
                  </div>
                </form>
              ) : null}
            </div>
          ) : null}
          {blobUrl ? <iframe className="op-pdf-frame" src={blobUrl} title={title} /> : null}
        </div>
      </div>
    </div>
  );
}
