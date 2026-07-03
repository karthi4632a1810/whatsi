import { useCallback, useEffect, useState } from "react";
import { api, getToken } from "../api.js";

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
    <div className="modal-backdrop" role="presentation" onClick={handleClose}>
      <div
        className="modal-panel modal-panel--pdf"
        role="dialog"
        aria-modal="true"
        aria-label={`Lab report preview for order ${previewOrder.orderId}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h3 className="modal-title">{title}</h3>
            <p className="muted modal-subtitle">
              {regLine ? `${regLine} · ` : ""}
              EMR lab report PDF
            </p>
          </div>
          <div className="modal-actions">
            {blobUrl ? (
              <a className="button secondary" href={blobUrl} target="_blank" rel="noreferrer">
                Open in tab
              </a>
            ) : null}
            <button type="button" className="secondary" onClick={handleClose}>
              Close
            </button>
          </div>
        </header>
        <div className="modal-body">
          {loading ? <p className="muted pdf-status">Loading PDF…</p> : null}
          {error ? (
            <div className="pdf-error">
              <p>{error}</p>
              <p className="muted">
                Procedure IDs could not be loaded from EMR. Check that{" "}
                <code>EMR_USERNAME</code> / <code>EMR_PASSWORD</code> are set in <code>.env</code> and
                restart the backend — or paste the EMR Print URL below.
              </p>
              <form className="pdf-link-form" onSubmit={saveEmrLink}>
                <label className="pdf-link-label" htmlFor="emr-print-url">
                  EMR Print URL
                </label>
                <input
                  id="emr-print-url"
                  className="pdf-link-input"
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://emr.mapims.edu.in/.../LabReport.aspx?action=Search&Orderid=..."
                />
                <button type="submit" className="btn-sm" disabled={savingLink || !linkUrl.trim()}>
                  {savingLink ? "Saving…" : "Save & preview"}
                </button>
              </form>
            </div>
          ) : null}
          {blobUrl ? <iframe className="pdf-frame" src={blobUrl} title={title} /> : null}
        </div>
      </div>
    </div>
  );
}
