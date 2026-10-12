import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { formatPatientName } from "../lib/format.js";
import { HistoryIcon, RefreshIcon, RotateCcwIcon } from "../portal/Icons.jsx";
import { CopyableChip, Empty, Loading, Pill, Toast, fmtDateTime, prettyPhone, useToast } from "./ui.jsx";

const FILTERS = [
  { value: "", label: "All messages" },
  { value: "SENT", label: "Sent" },
  { value: "FAILED", label: "Failed" },
];

/** Monitor → Message log: every WhatsApp template message handed to WATI, newest first. */
export default function MessageLog({ canRetry = false }) {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState(null);
  const [toast, showToast, hideToast] = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMessages((await api.messages(status ? { status } : {})).messages || []);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  async function retry(m) {
    setRetryingId(m._id);
    setError("");
    try {
      await api.retryMessage(m._id);
      showToast(`Retried the report of ${formatPatientName(m.patientName)}`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <div className="al-page wa-page op-log">
      <Toast toast={toast} onDismiss={hideToast} />
      <header className="al-hero">
        <div className="al-hero-icon">
          <HistoryIcon size={24} />
        </div>
        <div className="al-hero-text">
          <h2>Message log</h2>
          <p>Every WhatsApp template message handed to WATI — sent or failed, newest first.</p>
        </div>
        <div className="al-hero-actions">
          <button type="button" className="al-hero-btn" onClick={load} disabled={loading}>
            <RefreshIcon size={15} spinning={loading} /> Refresh
          </button>
        </div>
      </header>

      <div className="category-filter-chips no-print">
        {FILTERS.map((f) => (
          <button key={f.value || "all"} type="button" className={`cat-chip ${status === f.value ? "active" : ""}`} onClick={() => setStatus(f.value)}>
            <span>{f.label}</span>
          </button>
        ))}
      </div>

      {error && <div className="error">{error}</div>}

      {loading ? (
        <Loading>Loading messages…</Loading>
      ) : messages.length ? (
        <div className="table-wrap modern-table-wrap">
          <table className="results modern-results-table op-board-table">
            <thead>
              <tr>
                <th>Sent</th>
                <th>Patient</th>
                <th>Order</th>
                <th>To</th>
                <th>Status</th>
                <th>Reason</th>
                {canRetry && <th className="th-action">Action</th>}
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m._id}>
                  <td className="op-cell-time">{fmtDateTime(m.sentAt || m.createdAt)}</td>
                  <td className="op-cell-patient">
                    <span className="op-name">{formatPatientName(m.patientName)}</span>
                  </td>
                  <td>
                    <CopyableChip value={m.reportId} label="Order" className="code-chip code-chip-ip" onToast={showToast} screen="monitor" />
                  </td>
                  <td>{prettyPhone(m.phone) || "—"}</td>
                  <td>
                    <Pill tone={m.status === "SENT" ? "wa" : m.status === "FAILED" ? "bad" : "muted"}>{String(m.status || "—").toLowerCase()}</Pill>
                  </td>
                  <td className="op-reason" title={m.errorReason || undefined}>
                    {m.errorReason || <span className="text-muted">—</span>}
                  </td>
                  {canRetry && (
                    <td className="cell-action">
                      {m.status === "FAILED" ? (
                        <button type="button" className="btn btn-secondary op-send-btn" disabled={retryingId === m._id} onClick={() => retry(m)}>
                          <RotateCcwIcon size={13} /> {retryingId === m._id ? "Retrying…" : "Retry"}
                        </button>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No messages yet">Messages appear here once reports are sent on WhatsApp.</Empty>
      )}
    </div>
  );
}
