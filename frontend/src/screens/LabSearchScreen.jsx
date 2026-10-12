import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import PageHeader from "../components/PageHeader.jsx";
import PdfPreviewModal from "../components/PdfPreviewModal.jsx";
import { filterHisOrders } from "../lib/hisFilters.js";
import { formatEmrError } from "../lib/emrErrors.js";
import { formatPatientName } from "../lib/format.js";
import { CalendarIcon, CloseIcon, FilePdfIcon, PhoneIcon, PlusIcon, SearchIcon } from "../portal/Icons.jsx";
import { CopyableChip, Empty, HisStatusPill, Loading, ReadyPill, Toast, WaPill, fmtDateTime, prettyPhone, useToast } from "./ui.jsx";

const STATUS_FILTERS = [
  { value: "ready", label: "Ready to send" },
  { value: "completed", label: "All results approved" },
  { value: "approved", label: "Some approved" },
  { value: "all", label: "All orders" },
];

function dayValue(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const dmy = (iso) => String(iso || "").split("-").reverse().join("-");

/**
 * Lab Search: OP lab orders across a date range — saved boards first, HIS for
 * days not loaded yet. One order can be added to the WhatsApp queue by hand.
 */
export default function LabSearchScreen({ canQueue = false }) {
  const [from, setFrom] = useState(dayValue(7));
  const [to, setTo] = useState(dayValue(0));
  const [filter, setFilter] = useState("ready");
  const [search, setSearch] = useState("");
  const [orders, setOrders] = useState([]);
  const [meta, setMeta] = useState(null);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [queueingId, setQueueingId] = useState("");
  const [previewOrder, setPreviewOrder] = useState(null);
  const [toast, showToast, hideToast] = useToast();

  const shown = useMemo(() => filterHisOrders(orders, { filter: "all", query: search }), [orders, search]);

  function preset(days) {
    setFrom(dayValue(days));
    setTo(dayValue(days === 1 ? 1 : 0));
  }

  async function runSearch(nextFilter = filter) {
    setError("");
    setLoading(true);
    setSearched(true);
    setFilter(nextFilter);
    try {
      const data = await api.hisLabSearch({ from, to, filter: nextFilter, q: search.trim() || undefined });
      setOrders(data.orders || []);
      setMeta({ total: data.summary?.totalOrders, days: data.daysLoaded || 0, emrDays: data.emrDaysLoaded || 0, source: data.source });
    } catch (e) {
      setError(formatEmrError(e.message));
      setOrders([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }

  async function addToQueue(order) {
    setError("");
    setQueueingId(order.orderId);
    try {
      await api.syncOrderToQueue({ orderId: order.orderId, from, to, reportDay: order.reportDay });
      setOrders((prev) => prev.map((row) => (row.orderId === order.orderId ? { ...row, synced: true, whatsappLabel: "Queued", whatsappTone: "pending", canQueue: false } : row)));
      showToast(`Order ${order.orderId} is in the WhatsApp queue`);
    } catch (e) {
      setError(e.message);
    } finally {
      setQueueingId("");
    }
  }

  return (
    <div className="search-view-container op-lab-search">
      <Toast toast={toast} onDismiss={hideToast} />
      <PageHeader title="Lab Search" lead="Find OP lab reports from earlier days by patient, UHID, order or mobile — open the report, or add it to the WhatsApp queue by hand." />

      <div className="search-card-container">
        <div className="search-card-header">
          <div className="search-card-title-group">
            <div className="search-icon-badge">
              <SearchIcon size={20} />
            </div>
            <div>
              <h3 className="search-card-heading">OP lab report lookup</h3>
              <p className="search-card-subheading">Saved HIS boards are searched first (fast); days not loaded yet come from HIS, two at a time.</p>
            </div>
          </div>
          <div className="preset-chips-wrap">
            <span className="preset-label">Quick presets:</span>
            <button type="button" className="preset-chip" onClick={() => preset(0)}>
              Today
            </button>
            <button type="button" className="preset-chip" onClick={() => preset(1)}>
              Yesterday
            </button>
            <button type="button" className="preset-chip" onClick={() => preset(7)}>
              Last 7 days
            </button>
            <button type="button" className="preset-chip" onClick={() => preset(30)}>
              Last 30 days
            </button>
          </div>
        </div>

        <form
          className="searchbar modern-searchbar"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
          }}
        >
          <div className="field input-with-icon">
            <label htmlFor="ls-q">Patient, UHID, order or mobile</label>
            <div className="input-group">
              <span className="input-affix-icon">
                <SearchIcon size={16} />
              </span>
              <input id="ls-q" type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. 6190347, 386209, Latha" className="styled-input with-prefix" autoFocus />
              {search && (
                <button type="button" className="input-clear-btn" onClick={() => setSearch("")} aria-label="Clear">
                  <CloseIcon size={14} />
                </button>
              )}
            </div>
            <span className="field-micro-hint">Empty = every OP order in the range</span>
          </div>
          <div className="field date-range">
            <label htmlFor="ls-from">From lab day</label>
            <div className="input-group">
              <span className="input-affix-icon">
                <CalendarIcon size={16} />
              </span>
              <input id="ls-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} required className="styled-input with-prefix" />
            </div>
          </div>
          <div className="field date-range">
            <label htmlFor="ls-to">To lab day</label>
            <div className="input-group">
              <span className="input-affix-icon">
                <CalendarIcon size={16} />
              </span>
              <input id="ls-to" type="date" value={to} min={from} max={dayValue(0)} onChange={(e) => setTo(e.target.value)} required className="styled-input with-prefix" />
            </div>
          </div>
          <div className="search-actions modern-search-actions">
            <button type="submit" className="btn btn-primary btn-search-main" disabled={loading || !from || !to}>
              <SearchIcon size={18} />
              <span>{loading ? "Searching…" : "Search"}</span>
            </button>
          </div>
        </form>
      </div>

      {error && <div className="error">{error}</div>}

      {searched && (
        <div className="category-filter-chips no-print">
          {STATUS_FILTERS.map((f) => (
            <button key={f.value} type="button" className={`cat-chip ${filter === f.value ? "active" : ""}`} onClick={() => runSearch(f.value)} disabled={loading}>
              <span>{f.label}</span>
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <Loading>{search.trim() ? "Searching saved boards…" : "Searching saved boards, and HIS for days not loaded yet…"}</Loading>
      ) : !searched ? (
        <div className="search-welcome-dashboard">
          <div className="search-guidance-grid">
            <div className="guidance-card">
              <div className="guidance-icon-box bg-blue-subtle">🆔</div>
              <h4>Any identifier</h4>
              <p>
                Search by <strong>UHID</strong> (e.g. <code>6190347</code>), <strong>order number</strong>, patient name or mobile — or leave it empty to list the
                whole range.
              </p>
            </div>
            <div className="guidance-card">
              <div className="guidance-icon-box bg-emerald-subtle">📄</div>
              <h4>The report from AOSTA</h4>
              <p>Open the same lab report PDF the patient receives on WhatsApp, straight from the EMR.</p>
            </div>
            <div className="guidance-card">
              <div className="guidance-icon-box bg-indigo-subtle">💬</div>
              <h4>Send a missed one</h4>
              <p>
                <strong>Add to queue</strong> puts an older report in the <Link to="/reports/queue">WhatsApp queue</Link>, where you send it by hand.
              </p>
            </div>
          </div>
        </div>
      ) : shown.length ? (
        <div className="results-container">
          <div className="results-meta-bar">
            <div className="result-count-badge">
              <strong>{shown.length}</strong> {shown.length === 1 ? "order" : "orders"} · {dmy(from)} to {dmy(to)}
              {meta?.emrDays ? <span className="text-muted"> · {meta.emrDays} day(s) loaded from HIS</span> : null}
            </div>
          </div>
          <div className="table-wrap modern-table-wrap">
            <table className="results modern-results-table op-board-table">
              <thead>
                <tr>
                  <th>Lab day</th>
                  <th>Order</th>
                  <th>Patient</th>
                  <th>UHID</th>
                  <th>Mobile</th>
                  <th>Department</th>
                  <th>HIS status</th>
                  <th>Ready</th>
                  <th>WhatsApp</th>
                  <th>Completed</th>
                  <th className="th-action">Report</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((o) => (
                  <tr key={`${o.reportDay}-${o.orderId}`}>
                    <td className="op-cell-time">{dmy(o.reportDay)}</td>
                    <td>
                      <CopyableChip value={o.orderId} label="Order" className="code-chip code-chip-ip" onToast={showToast} screen="search" />
                    </td>
                    <td className="op-cell-patient">
                      <span className="op-name">{formatPatientName(o.patientName)}</span>
                    </td>
                    <td>
                      <CopyableChip value={o.patientId} label="UHID" className="code-chip code-chip-reg" onToast={showToast} screen="search" />
                    </td>
                    <td>
                      {o.phone ? (
                        <a href={`tel:${String(o.phone).replace(/\D/g, "")}`} className="tel-link">
                          <PhoneIcon size={12} />
                          <span>{prettyPhone(o.phone)}</span>
                        </a>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="op-cell-dept" title={o.department}>
                      {o.department || "—"}
                    </td>
                    <td>
                      <HisStatusPill status={o.hisStatus} />
                    </td>
                    <td>
                      <ReadyPill readiness={o.readiness} extra={o.readiness === "PARTIAL" ? `${o.approvedCount}/${o.procedureTotal}` : ""} />
                    </td>
                    <td>
                      <WaPill label={o.whatsappLabel} tone={o.whatsappTone} />
                    </td>
                    <td className="op-cell-time">{fmtDateTime(o.completedAt)}</td>
                    <td className="cell-action">
                      <div className="action-btn-group">
                        {o.canPreview && (
                          <button type="button" className="btn btn-view-pdf" onClick={() => setPreviewOrder(o)}>
                            <FilePdfIcon size={15} />
                            <span>PDF</span>
                          </button>
                        )}
                        {canQueue && o.readiness !== "WAITING" && (
                          <button type="button" className="btn btn-secondary op-send-btn" disabled={!o.canQueue || queueingId === o.orderId} onClick={() => addToQueue(o)}>
                            {queueingId === o.orderId ? (
                              "Adding…"
                            ) : o.synced && o.whatsappTone === "sent" ? (
                              "Sent"
                            ) : o.synced ? (
                              "In queue"
                            ) : (
                              <>
                                <PlusIcon size={13} /> Add to queue
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <Empty icon="🔍" title="No matching reports">
          Try a wider date range, another filter, or clear the search box.
        </Empty>
      )}

      <PdfPreviewModal order={previewOrder} onClose={() => setPreviewOrder(null)} />
    </div>
  );
}
