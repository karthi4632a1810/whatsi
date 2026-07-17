import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import Badge from "../components/Badge.jsx";
import EmptyState from "../components/EmptyState.jsx";
import PageHeader from "../components/PageHeader.jsx";
import PdfPreviewModal from "../components/PdfPreviewModal.jsx";
import WatiTestSendModal from "../components/WatiTestSendModal.jsx";
import { formatPatientName } from "../lib/format.js";
import { displayPhone } from "../lib/phone.js";

function todayValue() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatSyncedAt(value) {
  if (!value) return null;
  return new Date(value).toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDisplayDate(value) {
  if (!value) return "today";
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function queueStatus(report, testSendMode) {
  if (testSendMode) return report.status;
  if (report.status === "SENT" && report.lastAttempt?.testSend) return "PENDING";
  if (report.status === "FAILED" && report.lastAttempt?.testSend) return "PENDING";
  return report.status;
}

function formatStatusLabel(report, testSendMode) {
  if (!testSendMode) return queueStatus(report, testSendMode);
  const attempt = report?.lastAttempt;
  if (attempt?.testSend && attempt.status === "SENT") return "TEST SENT";
  if (attempt?.testSend && attempt.status === "FAILED") return "TEST FAILED";
  return report.status;
}

function formatStatusNote(report, testSendMode) {
  if (!testSendMode) return null;
  const attempt = report?.lastAttempt;
  if (!attempt?.testSend) return null;

  if (attempt.status === "SENT" && attempt.sentTo) {
    return `Test → ${displayPhone(attempt.sentTo)} (patient not sent)`;
  }
  if (attempt.status === "FAILED") {
    return attempt.errorReason || report.lastError || "Test send failed";
  }
  return null;
}

function formatReadinessLabel(report) {
  const total = report.procedureTotal || 0;
  const approved = report.approvedCount || 0;
  if (total > 0 && report.readiness === "PARTIAL") {
    return `${report.readiness} ${approved}/${total}`;
  }
  return report.readiness;
}

function canPreviewReport(report) {
  return report?.readiness !== "WAITING";
}

function toPreviewOrder(report) {
  return {
    orderId: report.reportId,
    patientId: report.patientId,
    patientName: report.patientName,
    procIds: report.procIds || [],
    hisReportUrl: report.hisReportUrl || "",
  };
}

function formatWatiRecipients(phones = [], contactMap) {
  return phones
    .map((phone) => {
      const contact = contactMap.get(phone);
      return contact ? `${contact.name} (${phone})` : phone;
    })
    .join(", ");
}

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "PENDING", label: "Pending" },
  { value: "QUEUED", label: "Queued" },
  { value: "SENT", label: "Sent" },
  { value: "FAILED", label: "Failed" },
];

export default function ReportsPage() {
  const [reports, setReports] = useState([]);
  const [settings, setSettings] = useState(null);
  const [stats, setStats] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [date, setDate] = useState(todayValue);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [previewOrder, setPreviewOrder] = useState(null);
  const [sendModal, setSendModal] = useState(null);

  const testSendMode = Boolean(settings?.watiTestSendMode);
  const testPhones = settings?.watiTestContactPhones || [];
  const queue = stats?.queue || {};
  const isToday = date === todayValue();
  const dayLabel = isToday ? "today" : formatDisplayDate(date);

  const contactMap = useMemo(() => new Map(), []);

  const testContactOptions = useMemo(
    () =>
      testPhones.map((phone) => {
        const contact = contactMap.get(phone);
        return contact || { phone, name: displayPhone(phone) || phone };
      }),
    [testPhones, contactMap]
  );

  const testRecipientLabel = useMemo(
    () => formatWatiRecipients(testPhones, contactMap),
    [testPhones, contactMap]
  );

  async function loadDashboard(forDay = date) {
    const day = forDay || todayValue();
    const [statsData, lab] = await Promise.all([
      api.stats({ scope: "day", date: day }).catch(() => null),
      api.hisLabToday({ from: day, to: day }).catch(() => null),
    ]);
    if (statsData) setStats(statsData);
    setLastSyncAt(lab?.lastSyncAt ? new Date(lab.lastSyncAt).getTime() : null);
  }

  async function load() {
    setLoading(true);
    setSelected(new Set());
    try {
      const params = { reportDay: date };
      if (status) params.status = status;
      if (q) params.q = q;
      const data = await api.reports(params);
      setReports(data.reports || []);
      await loadDashboard(date);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    api.settings().then((d) => setSettings(d.settings)).catch(() => {});
  }, [status, date]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.hidden) return;
      loadDashboard(date).catch(() => {});
    }, 20000);
    return () => window.clearInterval(intervalId);
  }, [date]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(checked) {
    if (checked) setSelected(new Set(reports.map((r) => r._id)));
    else setSelected(new Set());
  }

  function openTestSendModal({ type, reportId = null, reportName = "" }) {
    if (!testPhones.length) {
      setError("Test send mode is on — add WATI contacts in Settings first.");
      return;
    }
    setSendModal({ type, reportId, reportName });
  }

  async function confirmTestSend(testContactPhones) {
    if (!sendModal) return;

    setBusy(true);
    setError("");
    try {
      if (sendModal.type === "one") {
        await api.sendReport(sendModal.reportId, { testContactPhones });
      } else {
        await api.bulkSend([...selected], testContactPhones);
        setSelected(new Set());
      }
      setSendModal(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendOne(id, reportName) {
    if (testSendMode) {
      openTestSendModal({ type: "one", reportId: id, reportName });
      return;
    }

    setBusy(true);
    setError("");
    try {
      await api.sendReport(id);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function bulkSend() {
    if (testSendMode) {
      openTestSendModal({
        type: "bulk",
        reportName: `${selected.size} report${selected.size === 1 ? "" : "s"}`,
      });
      return;
    }

    setBusy(true);
    setError("");
    try {
      await api.bulkSend([...selected]);
      setSelected(new Set());
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const allSelected = reports.length > 0 && selected.size === reports.length;
  const sendLabel = testSendMode ? "Test send" : "Send";

  return (
    <div>
      <PageHeader
        eyebrow="Outbound queue"
        title={isToday ? "WhatsApp send queue" : `WhatsApp queue · ${formatDisplayDate(date)}`}
        lead={`Reports synced from HIS for ${formatDisplayDate(date)}. Change the date to review backlog from earlier lab days.`}
      />

      <div className={`cards cards--queue-dash${testSendMode ? " cards--queue-dash-test" : ""}`}>
        <div className="stat-card stat-card--synced">
          <h3>Total in queue</h3>
          <div className="value">{queue.total ?? "—"}</div>
          <p className="stat-hint">Synced reports · {dayLabel}</p>
        </div>
        <div className="stat-card stat-card--ready">
          <h3>Pending</h3>
          <div className="value">{queue.pending ?? "—"}</div>
          <p className="stat-hint">Waiting to send</p>
        </div>
        <div className="stat-card stat-card--sent">
          <h3>Sent</h3>
          <div className="value">{queue.sent ?? "—"}</div>
          <p className="stat-hint">Patient sends · {dayLabel}</p>
        </div>
        {testSendMode ? (
          <div className="stat-card stat-card--orders">
            <h3>Test sent</h3>
            <div className="value">{queue.testSent ?? "—"}</div>
            <p className="stat-hint">Test mode only · {dayLabel}</p>
          </div>
        ) : null}
        <div className="stat-card stat-card--approved">
          <h3>Failed</h3>
          <div className="value">{queue.failed ?? "—"}</div>
          <p className="stat-hint">Need retry</p>
        </div>
        <div className="stat-card stat-card--partial">
          <h3>Last synced</h3>
          <div className="value value--time">
            {lastSyncAt ? formatSyncedAt(lastSyncAt) : "—"}
          </div>
          <p className="stat-hint">HIS board · {dayLabel}</p>
        </div>
      </div>

      <div className="sync-bar-wrap" style={{ marginBottom: 14 }}>
        <div className="sync-bar" role="status">
          <span className={`sync-dot${lastSyncAt ? " sync-dot--live" : ""}`} aria-hidden />
          <span>
            {lastSyncAt
              ? `Queue · ${formatDisplayDate(date)} · HIS last synced ${formatSyncedAt(lastSyncAt)}`
              : `Queue · ${formatDisplayDate(date)} · HIS sync time unavailable`}
          </span>
          {queue.total != null ? (
            <span>
              · <strong>{queue.pending ?? 0}</strong> pending of <strong>{queue.total}</strong>{" "}
              {dayLabel}
            </span>
          ) : null}
          {stats?.messageSendEnabled === false ? (
            <span className="muted"> · Send disabled in Settings</span>
          ) : null}
          {testSendMode ? <span className="muted"> · Test send mode ON</span> : null}
        </div>
      </div>

      {testSendMode ? (
        <div className="test-send-banner" role="status">
          <strong>Test send mode is ON</strong>
          <span>
            {testPhones.length
              ? `Manual test send only — pick one contact per report. Available: ${testRecipientLabel}`
              : "No WATI contacts configured — add contacts in Settings"}
          </span>
        </div>
      ) : null}

      {error ? <p className="error" role="alert">{error}</p> : null}

      <div className="panel">
        <div className="toolbar">
          <div className="toolbar-row toolbar-row--spread">
            <label className="field-label">
              Lab day
              <input
                type="date"
                value={date}
                max={todayValue()}
                onChange={(e) => setDate(e.target.value || todayValue())}
                aria-label="Filter queue by lab day"
              />
            </label>
            {!isToday ? (
              <button type="button" className="secondary" onClick={() => setDate(todayValue())}>
                Today
              </button>
            ) : null}
            <label className="field-label field-label--grow">
              Search
              <input
                className="search-input"
                placeholder="Name, UHID, or order ID"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") load().catch((err) => setError(err.message));
                }}
              />
            </label>
            <label className="field-label">
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                aria-label="Filter by status"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value || "all"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => load().catch((e) => setError(e.message))}>
              Search
            </button>
            <div className="toolbar-actions toolbar-actions--inline">
              <button type="button" disabled={!selected.size || busy} onClick={bulkSend}>
                {testSendMode ? "Test send" : "Send"} selected ({selected.size})
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <p className="muted panel-loading">Loading queue…</p>
        ) : reports.length ? (
          <div className="table-wrap">
            <table className="data-table queue-table">
              <colgroup>
                <col className="col-check" />
                <col className="col-order" />
                <col className="col-patient" />
                <col className="col-phone" />
                {testSendMode ? <col className="col-wati" /> : null}
                <col className="col-opip" />
                <col className="col-readiness" />
                <col className="col-status" />
                <col className="col-ready-at" />
                <col className="col-pdf" />
                <col className="col-action" />
              </colgroup>
              <thead>
                <tr>
                  <th className="col-check">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allSelected}
                      onChange={(e) => toggleAll(e.target.checked)}
                    />
                  </th>
                  <th>Order</th>
                  <th>Patient</th>
                  <th>{testSendMode ? "Patient phone" : "Phone"}</th>
                  {testSendMode ? <th>WATI to</th> : null}
                  <th>OP/IP</th>
                  <th>Readiness</th>
                  <th>Status</th>
                  <th>Ready at</th>
                  <th className="col-pdf">PDF</th>
                  <th className="col-action">Action</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r._id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(r._id)}
                        onChange={() => toggle(r._id)}
                        aria-label={`Select ${formatPatientName(r.patientName)}`}
                      />
                    </td>
                    <td className="td-mono">{r.reportId}</td>
                    <td className="td-patient" title={formatPatientName(r.patientName)}>
                      {formatPatientName(r.patientName)}
                    </td>
                    <td className="td-mono">{r.phone || "—"}</td>
                    {testSendMode ? (
                      <td className="td-wati-recipient">
                        <span className="muted">Choose on send</span>
                      </td>
                    ) : null}
                    <td>{r.opIpType}</td>
                    <td>
                      <div className="status-cell">
                        <Badge kind={r.readiness?.toLowerCase()}>{formatReadinessLabel(r)}</Badge>
                        {r.readiness === "PARTIAL" && r.lastError?.includes("New test") ? (
                          <span className="status-cell__note muted" title={r.lastError}>
                            {r.lastError}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div className="status-cell">
                        {(() => {
                          const statusLabel = formatStatusLabel(r, testSendMode);
                          const statusKind =
                            statusLabel === "TEST SENT"
                              ? "sent"
                              : statusLabel === "TEST FAILED"
                                ? "failed"
                                : queueStatus(r, testSendMode)?.toLowerCase();
                          const statusNote = formatStatusNote(r, testSendMode);
                          return (
                            <>
                              <Badge kind={statusKind}>{statusLabel}</Badge>
                              {statusNote ? (
                                <span className="status-cell__note muted" title={statusNote}>
                                  {statusNote}
                                </span>
                              ) : null}
                            </>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="td-mono">
                      {r.reportReadyAt
                        ? new Date(r.reportReadyAt).toLocaleString("en-IN", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })
                        : "—"}
                    </td>
                    <td className="col-pdf">
                      {canPreviewReport(r) ? (
                        <button
                          type="button"
                          className="btn-sm secondary"
                          onClick={() => setPreviewOrder(toPreviewOrder(r))}
                        >
                          Preview
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="col-action td-action">
                      {(queueStatus(r, testSendMode) === "PENDING" ||
                        queueStatus(r, testSendMode) === "FAILED") ? (
                        <button
                          type="button"
                          className={`btn-sm${testSendMode ? " btn-sm--test" : ""}`}
                          disabled={busy || (testSendMode && !testPhones.length)}
                          onClick={() => sendOne(r._id, formatPatientName(r.patientName))}
                        >
                          {sendLabel}
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
            title="No reports for this day"
            hint={`Nothing in the WhatsApp queue for ${formatDisplayDate(date)}. Pick another lab day, or sync from HIS Lab Today.`}
          />
        )}
      </div>

      <PdfPreviewModal order={previewOrder} onClose={() => setPreviewOrder(null)} />
      <WatiTestSendModal
        open={Boolean(sendModal)}
        onClose={() => !busy && setSendModal(null)}
        onConfirm={confirmTestSend}
        contacts={testContactOptions}
        reportLabel={sendModal?.reportName || ""}
        busy={busy}
      />
    </div>
  );
}
