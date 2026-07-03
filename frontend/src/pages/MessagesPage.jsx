import { useEffect, useState } from "react";
import { api } from "../api.js";
import Badge from "../components/Badge.jsx";
import EmptyState from "../components/EmptyState.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { formatPatientName } from "../lib/format.js";

const STATUS_OPTIONS = [
  { value: "", label: "All messages" },
  { value: "SENT", label: "Sent" },
  { value: "FAILED", label: "Failed" },
];

export default function MessagesPage() {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api.messages(status ? { status } : {});
      setMessages(data.messages || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [status]);

  async function retry(id) {
    setRetryingId(id);
    setError("");
    try {
      await api.retryMessage(id);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Delivery log"
        title="WATI message log"
        lead="History of WhatsApp template messages sent through WATI."
      />

      {error ? <p className="error" role="alert">{error}</p> : null}

      <div className="panel">
        <div className="toolbar">
          <div className="toolbar-row">
            <label className="field-label">
              Filter
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value || "all"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {loading ? (
          <p className="muted panel-loading">Loading messages…</p>
        ) : messages.length ? (
          <div className="table-wrap">
            <table className="data-table messages-table">
              <colgroup>
                <col className="col-patient" />
                <col className="col-order" />
                <col className="col-phone" />
                <col className="col-status" />
                <col className="col-sent" />
                <col className="col-error" />
                <col className="col-action" />
              </colgroup>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Order</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Sent at</th>
                  <th>Error</th>
                  <th className="col-action">Action</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => (
                  <tr key={m._id}>
                    <td className="td-patient" title={formatPatientName(m.patientName)}>
                      {formatPatientName(m.patientName)}
                    </td>
                    <td className="td-mono">{m.reportId}</td>
                    <td className="td-mono">{m.phone}</td>
                    <td>
                      <Badge kind={m.status?.toLowerCase()}>{m.status}</Badge>
                    </td>
                    <td className="td-mono">
                      {m.sentAt
                        ? new Date(m.sentAt).toLocaleString("en-IN", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })
                        : "—"}
                    </td>
                    <td className="td-error" title={m.errorReason || undefined}>
                      {m.errorReason || "—"}
                    </td>
                    <td className="col-action td-action">
                      {m.status === "FAILED" ? (
                        <button
                          type="button"
                          className="btn-sm"
                          disabled={retryingId === m._id}
                          onClick={() => retry(m._id)}
                        >
                          {retryingId === m._id ? "Retrying…" : "Retry"}
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No messages yet"
            hint="Messages appear here after reports are sent via WhatsApp."
          />
        )}
      </div>
    </div>
  );
}
