import { useCallback, useEffect, useState } from "react";
import { api, getToken } from "../api.js";
import { CloseIcon, ExternalLinkIcon, FilePdfIcon } from "../portal/Icons.jsx";

function buildPdfSrc(order) {
  const base = `/api/his/pdf/${order.orderId}`;
  if (!order.procIds?.length) return base;
  return `${base}?procIds=${order.procIds.join(",")}`;
}

export default function PdfPreviewModal({ order, onClose }) {
  const [blobUrl, setBlobUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [linkUrl, setLinkUrl] = useState("");
  const [savingLink, setSavingLink] = useState(false);
  const [previewOrder, setPreviewOrder] = useState(order);

  const loadPdf = useCallback(async (targetOrder) => {
    setLoading(true);
    setError("");
    setBlobUrl("");

    try {
      const token = getToken();
      const response = await fetch(buildPdfSrc(targetOrder), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Could not load PDF (HTTP ${response.status})`);
      }

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
              Lab report from AOSTA
            </p>
          </div>
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
              <p className="text-muted">
                The report's procedure IDs couldn't be read from AOSTA. Check the EMR login in <code>.env</code> (EMR_USERNAME / EMR_PASSWORD), or paste
                the report's EMR Print address below.
              </p>
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
            </div>
          ) : null}
          {blobUrl ? <iframe className="op-pdf-frame" src={blobUrl} title={title} /> : null}
        </div>
      </div>
    </div>
  );
}
