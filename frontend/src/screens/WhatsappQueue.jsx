import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import PageHeader from "../components/PageHeader.jsx";
import PdfPreviewModal from "../components/PdfPreviewModal.jsx";
import WatiTestSendModal from "../components/WatiTestSendModal.jsx";
import { formatPatientName } from "../lib/format.js";
import { displayPhone } from "../lib/phone.js";
import { track } from "../portal/audit.js";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, FilePdfIcon, PhoneIcon, RefreshIcon, SearchIcon, SendIcon } from "../portal/Icons.jsx";
import { CopyableChip, Empty, Loading, QueuePill, ReadyPill, Toast, fmtDateTime, fmtTime, prettyPhone, useToast } from "./ui.jsx";

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "PENDING", label: "Pending" },
  { value: "QUEUED", label: "Sending" },
  { value: "SENT", label: "Sent" },
  { value: "FAILED", label: "Failed" },
  { value: "NEEDS_REVIEW", label: "Check needed" },
];

function todayValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function shiftDay(value, days) {
  const [y, m, d] = value.split("-").map(Number);
  const n = new Date(y, m - 1, d + days);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}
function humanDay(value) {
  if (value === todayValue()) return "Today";
  if (value === shiftDay(todayValue(), -1)) return "Yesterday";
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

/** In test send mode a patient send shows as pending until it really goes to the patient. */
function queueStatus(report, testSendMode) {
  if (testSendMode) return report.status;
  if ((report.status === "SENT" || report.status === "FAILED") && report.lastAttempt?.testSend) return "PENDING";
  return report.status;
}

function statusNote(report, testSendMode) {
  if (!testSendMode) return report.scheduleNote || (report.status === "FAILED" ? report.lastError : "") || "";
  const a = report?.lastAttempt;
  if (!a?.testSend) return "";
  if (a.status === "SENT" && a.sentTo) return `Test → ${displayPhone(a.sentTo)} (patient not sent)`;
  if (a.status === "FAILED") return a.errorReason || report.lastError || "Test send failed";
  return "";
}

const DELIVERY = { read: "Read", delivered: "Delivered", sent: "Sent", failed: "Failed" };

/** OP Lab Reports → WhatsApp queue: the reports of a lab day and their sends. */
export default function WhatsappQueue({ canSend = false }) {
  const [reports, setReports] = useState([]);
  const [settings, setSettings] = useState(null);
  const [stats, setStats] = useState(null);
  const [date, setDate] = useState(todayValue);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [previewOrder, setPreviewOrder] = useState(null);
  const [sendModal, setSendModal] = useState(null);
  const [toast, showToast, hideToast] = useToast();

  const testSendMode = Boolean(settings?.watiTestSendMode);
  const testPhones = useMemo(() => settings?.watiTestContactPhones || [], [settings]);
  const testContacts = useMemo(() => testPhones.map((phone) => ({ phone, name: displayPhone(phone) || phone })), [testPhones]);
  const queue = stats?.queue || {};
  const isToday = date === todayValue();

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setLoading(true);
      try {
        const params = { reportDay: date };
        if (status) params.status = status;
        if (q.trim()) params.q = q.trim();
        const [data, statsData] = await Promise.all([api.reports(params), api.stats({ scope: "day", date }).catch(() => null)]);
        setReports(data.reports || []);
        if (statsData) setStats(statsData);
        if (!quiet) setSelected(new Set());
        setError("");
      } catch (e) {
        setError(e.message);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [date, status, q]
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, status]);

  useEffect(() => {
    api.settings().then((d) => setSettings(d.settings)).catch(() => {});
  }, []);

  useEffect(() => {
    const id = setInterval(() => !document.hidden && load({ quiet: true }), 20_000);
    return () => clearInterval(id);
  }, [load]);

  const sendable = (r) => ["PENDING", "FAILED", "NEEDS_REVIEW"].includes(queueStatus(r, testSendMode));
  const selectable = reports.filter(sendable);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r._id));

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function sendOne(r) {
    const name = formatPatientName(r.patientName);
    if (testSendMode) {
      if (!testPhones.length) return setError("Test send mode is on — add test contacts in Settings → Sending schedule first.");
      return setSendModal({ type: "one", reportId: r._id, reportName: name });
    }
    // Stopped mid-send by a restart: WATI may already have it, so ask first.
    const force = r.status === "NEEDS_REVIEW";
    if (force && !window.confirm("This send was interrupted — check the Message log first. Send it again?")) return;
    setBusy(true);
    setError("");
    try {
      await api.sendReport(r._id, { force });
      showToast(`Sent the report of ${name}`);
      await load({ quiet: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function bulkSend() {
    if (testSendMode) {
      if (!testPhones.length) return setError("Test send mode is on — add test contacts in Settings → Sending schedule first.");
      return setSendModal({ type: "bulk", reportName: `${selected.size} report${selected.size === 1 ? "" : "s"}` });
    }
    setBusy(true);
    setError("");
    try {
      const r = await api.bulkSend([...selected]);
      showToast(`Sent ${r.sent ?? selected.size} of ${selected.size}`);
      setSelected(new Set());
      await load({ quiet: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmTestSend(phones) {
    if (!sendModal) return;
    setBusy(true);
    setError("");
    try {
      if (sendModal.type === "one") await api.sendReport(sendModal.reportId, { testContactPhones: phones });
      else {
        await api.bulkSend([...selected], phones);
        setSelected(new Set());
      }
      setSendModal(null);
      showToast(`Test sent to ${displayPhone(phones[0])}`);
      await load({ quiet: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function changeDate(next) {
    setDate(next);
    track("date_change", { screen: "reports", details: { date: next } });
  }

  return (
    <div className="discharge-reports-page op-queue">
      <Toast toast={toast} onDismiss={hideToast} />
      <PageHeader
        title={isToday ? "WhatsApp queue" : `WhatsApp queue · ${humanDay(date)}`}
        lead="Reports of the lab day waiting to go out, sent, or needing a look. Change the day to review earlier backlog."
      />

      <div className="automation-card modern-telemetry-card">
        <div className="automation-status-col">
          <div className={`automation-dot-ring ${stats?.messageSendEnabled ? "checking" : "idle"}`}>
            <div className="automation-dot-core" />
          </div>
          <div className="automation-meta-text">
            <div className="automation-headline">
              {stats?.messageSendEnabled === false ? "Sending is off — nothing goes to patients" : testSendMode ? "Test send mode — sends go to test contacts" : "Sending is on"}
            </div>
            <div className="automation-last-run">
              {stats?.mode === "END_OF_DAY" ? `Daily at ${stats.endOfDayTime}` : `${stats?.sendDelayHours ?? 3} h after the last result is approved`}
              {stats?.quietHoursEnabled ? ` · night hold ${stats.quietStart}–${stats.quietEnd}` : ""}
            </div>
          </div>
        </div>
        <div className="automation-stats-chips">
          <span className="stat-chip chip-found">
            <strong>{queue.total ?? 0}</strong> in queue
          </span>
          <span className="stat-chip chip-existing">
            <strong>{queue.pending ?? 0}</strong> pending
          </span>
          <span className="stat-chip chip-generated">
            <strong>{queue.sent ?? 0}</strong> sent
          </span>
          {testSendMode && (
            <span className="stat-chip chip-nodata">
              <strong>{queue.testSent ?? 0}</strong> test sent
            </span>
          )}
          {(queue.failed ?? 0) > 0 && (
            <span className="stat-chip chip-failed">
              <strong>{queue.failed}</strong> failed
            </span>
          )}
        </div>
        <button type="button" className="btn btn-secondary btn-check-now" onClick={() => load()} disabled={loading}>
          <RefreshIcon spinning={loading} size={15} />
          <span>Refresh</span>
        </button>
      </div>

      <div className="reports-toolbar modern-toolbar op-toolbar">
        <div className="date-stepper-group">
          <button type="button" className="btn btn-stepper" onClick={() => changeDate(shiftDay(date, -1))}>
            <ChevronLeftIcon size={16} />
            <span className="hide-on-mobile">Prev</span>
          </button>
          <div className="toolbar-date-input-wrap">
            <CalendarIcon size={16} className="date-input-icon" />
            <input type="date" value={date} max={todayValue()} onChange={(e) => changeDate(e.target.value || todayValue())} className="toolbar-date-input" aria-label="Lab day" />
            <span className={`date-human-pill ${isToday ? "is-today" : ""}`}>{humanDay(date)}</span>
          </div>
          <button type="button" className="btn btn-stepper" onClick={() => changeDate(shiftDay(date, 1))} disabled={isToday}>
            <span className="hide-on-mobile">Next</span>
            <ChevronRightIcon size={16} />
          </button>
          <button type="button" className={`btn btn-stepper-today ${isToday ? "active" : ""}`} onClick={() => changeDate(todayValue())}>
            Today
          </button>
        </div>
        <form
          className="in-table-filter"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <SearchIcon size={16} className="filter-input-icon" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, UHID or order — Enter to search" className="filter-text-input" aria-label="Search the queue" />
          {q && (
            <button
              type="button"
              className="filter-clear-btn"
              onClick={() => {
                setQ("");
                setTimeout(() => load(), 0);
              }}
            >
              ×
            </button>
          )}
        </form>
        {canSend && (
          <button type="button" className="btn btn-primary op-bulk-send" disabled={!selected.size || busy} onClick={bulkSend}>
            <SendIcon size={15} /> {testSendMode ? "Test send" : "Send"} selected ({selected.size})
          </button>
        )}
      </div>

      {testSendMode && (
        <div className="op-warn">
          <b>Test send mode is on.</b> Each send goes to one test contact you pick — not to the patient.
          {!testPhones.length && " No test contacts yet: add them in Settings → Sending schedule."}
        </div>
      )}
      {error && <div className="error">{error}</div>}

      <div className="category-filter-chips no-print">
        {STATUS_FILTERS.map((f) => (
          <button key={f.value || "all"} type="button" className={`cat-chip ${status === f.value ? "active" : ""}`} onClick={() => setStatus(f.value)}>
            <span>{f.label}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <Loading>Loading the queue…</Loading>
      ) : !reports.length ? (
        <Empty title={`Nothing in the queue for ${humanDay(date)}`}>Reports join the queue when all their results are approved in HIS (or with Sync to queue on the HIS board).</Empty>
      ) : (
        <div className="results-container">
          <div className="results-meta-bar">
            <div className="result-count-badge">
              <strong>{reports.length}</strong> {reports.length === 1 ? "report" : "reports"}
            </div>
          </div>
          <div className="table-wrap modern-table-wrap">
            <table className="results modern-results-table op-queue-table">
              <thead>
                <tr>
                  {canSend && (
                    <th className="op-col-check">
                      <input type="checkbox" aria-label="Select all sendable" checked={allSelected} disabled={!selectable.length} onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((r) => r._id)) : new Set())} />
                    </th>
                  )}
                  <th>Order</th>
                  <th>Patient</th>
                  <th>Mobile</th>
                  <th>Ready</th>
                  <th>Status</th>
                  <th>Ready at</th>
                  <th>Sent</th>
                  <th className="th-action">Report</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => {
                  const st = queueStatus(r, testSendMode);
                  const note = statusNote(r, testSendMode);
                  const partial = r.readiness === "PARTIAL" && r.procedureTotal ? `${r.approvedCount}/${r.procedureTotal}` : "";
                  return (
                    <tr key={r._id}>
                      {canSend && (
                        <td className="op-col-check">
                          {sendable(r) && <input type="checkbox" checked={selected.has(r._id)} onChange={() => toggle(r._id)} aria-label={`Select ${formatPatientName(r.patientName)}`} />}
                        </td>
                      )}
                      <td>
                        <CopyableChip value={r.reportId} label="Order" className="code-chip code-chip-ip" onToast={showToast} />
                      </td>
                      <td className="op-cell-patient">
                        <span className="op-name">{formatPatientName(r.patientName)}</span>
                        <small>UHID {r.patientId}</small>
                      </td>
                      <td>
                        {r.phone ? (
                          <a href={`tel:${String(r.phone).replace(/\D/g, "")}`} className="tel-link">
                            <PhoneIcon size={12} />
                            <span>{prettyPhone(r.phone)}</span>
                          </a>
                        ) : (
                          <span className="text-muted">No number</span>
                        )}
                      </td>
                      <td>
                        <ReadyPill readiness={r.readiness} extra={partial} />
                      </td>
                      <td className="op-cell-status">
                        <QueuePill status={st} />
                        {r.deliveryStatus && st === "SENT" && !note && <small className="op-tick">{DELIVERY[r.deliveryStatus]}</small>}
                        {note && (
                          <small className="op-note" title={note}>
                            {note}
                          </small>
                        )}
                      </td>
                      <td className="op-cell-time">{fmtDateTime(r.reportReadyAt)}</td>
                      <td className="op-cell-time">{r.sentAt ? fmtTime(r.sentAt) : "—"}</td>
                      <td className="cell-action">
                        <div className="action-btn-group">
                          {r.readiness !== "WAITING" && (
                            <button
                              type="button"
                              className="btn btn-view-pdf"
                              onClick={() => setPreviewOrder({ orderId: r.reportId, patientId: r.patientId, patientName: r.patientName, procIds: r.procIds || [], hisReportUrl: r.hisReportUrl || "" })}
                            >
                              <FilePdfIcon size={15} />
                              <span>PDF</span>
                            </button>
                          )}
                          {canSend && sendable(r) && (
                            <button type="button" className="btn btn-primary op-send-btn" disabled={busy || (testSendMode && !testPhones.length)} onClick={() => sendOne(r)}>
                              <SendIcon size={14} /> {testSendMode ? "Test" : st === "FAILED" ? "Retry" : "Send"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PdfPreviewModal order={previewOrder} onClose={() => setPreviewOrder(null)} />
      <WatiTestSendModal open={Boolean(sendModal)} onClose={() => !busy && setSendModal(null)} onConfirm={confirmTestSend} contacts={testContacts} reportLabel={sendModal?.reportName || ""} busy={busy} />
    </div>
  );
}
