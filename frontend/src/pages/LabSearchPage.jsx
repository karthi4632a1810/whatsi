import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { HisBadge } from "../components/Badge.jsx";
import EmptyState from "../components/EmptyState.jsx";
import PageHeader from "../components/PageHeader.jsx";
import PdfPreviewModal from "../components/PdfPreviewModal.jsx";
import { filterHisOrders } from "../lib/hisFilters.js";
import { formatEmrError } from "../lib/emrErrors.js";
import { formatPatientName } from "../lib/format.js";

const STATUS_FILTERS = [
  { value: "ready", label: "Ready" },
  { value: "completed", label: "Approved" },
  { value: "approved", label: "Partial" },
  { value: "all", label: "All" },
];

function todayValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysAgoValue(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateTime(value) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function WaBadge({ label, tone }) {
  if (!label || tone === "idle") {
    return <span className="wa-idle">{label || "Not queued"}</span>;
  }
  return <span className={`badge wa-badge wa-badge--${tone}`}>{label}</span>;
}

function readinessLabel(order) {
  if (order.readiness === "PARTIAL") {
    return `PARTIAL ${order.approvedCount}/${order.procedureTotal}`;
  }
  return order.readiness || "—";
}

export default function LabSearchPage() {
  const [from, setFrom] = useState(daysAgoValue(7));
  const [to, setTo] = useState(todayValue());
  const [filter, setFilter] = useState("ready");
  const [search, setSearch] = useState("");
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState(null);
  const [daysLoaded, setDaysLoaded] = useState(0);
  const [searchMeta, setSearchMeta] = useState(null);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [queueingId, setQueueingId] = useState("");
  const [previewOrder, setPreviewOrder] = useState(null);

  const filteredOrders = useMemo(
    () => filterHisOrders(orders, { filter: "all", query: search }),
    [orders, search]
  );

  async function runSearch(nextFilter = filter) {
    setError("");
    setNotice("");
    setLoading(true);
    setSearched(true);
    if (nextFilter !== filter) setFilter(nextFilter);
    try {
      const data = await api.hisLabSearch({
        from,
        to,
        filter: nextFilter,
        q: search.trim() || undefined,
      });
      setOrders(data.orders || []);
      setSummary(data.summary || null);
      setDaysLoaded(data.daysLoaded || 0);
      setSearchMeta({
        source: data.source,
        cachedDays: data.cachedDays,
        emrDaysLoaded: data.emrDaysLoaded,
        missingDays: data.missingDays,
      });
    } catch (e) {
      setError(formatEmrError(e.message));
      setOrders([]);
      setSummary(null);
      setSearchMeta(null);
    } finally {
      setLoading(false);
    }
  }

  async function addToQueue(order) {
    setError("");
    setNotice("");
    setQueueingId(order.orderId);
    try {
      await api.syncOrderToQueue({
        orderId: order.orderId,
        from,
        to,
        reportDay: order.reportDay,
      });
      setOrders((prev) =>
        prev.map((row) =>
          row.orderId === order.orderId
            ? {
                ...row,
                synced: true,
                whatsappLabel: "Queued",
                whatsappTone: "pending",
                canQueue: false,
              }
            : row
        )
      );
      setNotice(`Order ${order.orderId} added to WhatsApp queue. Send manually from the queue page.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setQueueingId("");
    }
  }

  return (
    <>
      <PageHeader
        title="Lab report search"
        subtitle="Search previous lab reports by date range and add individual orders to the WhatsApp queue. Manual only — nothing sends automatically."
      />

      <div className="warn-banner" style={{ marginBottom: 16 }}>
        Manual search only. Use <strong>Add to queue</strong> per report, then send from{" "}
        <Link to="/reports">WhatsApp Queue</Link>. Automation is not used here.
      </div>

      {error ? (
        <p className={orders.length ? "warn-banner" : "error"} role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="notice-banner" role="status">
          {notice}
        </p>
      ) : null}

      <div className="panel">
        <div className="toolbar">
          <div className="toolbar-row">
            <label className="field-label">
              From
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="field-label">
              To
              <input type="date" value={to} min={from} max={todayValue()} onChange={(e) => setTo(e.target.value)} />
            </label>
            <label className="field-label field-label--grow">
              Search
              <input
                className="search-input"
                type="search"
                placeholder="UHID, order ID, name, or mobile"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runSearch();
                }}
              />
            </label>
            <button className="primary" type="button" disabled={loading || !from || !to} onClick={runSearch}>
              {loading ? "Searching…" : "Search"}
            </button>
          </div>
          <div className="toolbar-row">
            <div className="status-pills">
              {STATUS_FILTERS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`status-pill ${filter === item.value ? "active" : ""}`}
                  onClick={() => {
                    if (searched) runSearch(item.value);
                    else setFilter(item.value);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {searched && !loading ? (
              <span className="muted">
                {summary?.totalOrders ?? filteredOrders.length} orders
                {daysLoaded > 1 ? ` · ${daysLoaded} days` : ""}
                {searchMeta?.source === "mongodb" ? " · saved boards" : ""}
                {searchMeta?.emrDaysLoaded
                  ? ` · ${searchMeta.emrDaysLoaded} day(s) from EMR`
                  : ""}
              </span>
            ) : null}
          </div>
        </div>

        {loading ? (
          <p className="muted" style={{ padding: "24px 0" }}>
            {search.trim()
              ? "Searching saved boards on the server…"
              : "Searching saved boards, loading missing days from EMR if needed (2 days at a time)…"}
          </p>
        ) : !searched ? (
          <EmptyState
            title="Pick a date range and search"
            body="Searches saved HIS boards first (fast). EMR is only used for days not yet synced on HIS Lab Today."
          />
        ) : filteredOrders.length ? (
          <div className="table-wrap">
            <table className="his-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Patient</th>
                  <th>UHID</th>
                  <th>Phone</th>
                  <th>Dept</th>
                  <th>Lab day</th>
                  <th>HIS status</th>
                  <th>Readiness</th>
                  <th>Completed</th>
                  <th>Queue</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <tr key={`${order.reportDay}-${order.orderId}`}>
                    <td>{order.orderId}</td>
                    <td>{formatPatientName(order.patientName)}</td>
                    <td>{order.patientId || "—"}</td>
                    <td>{order.phone || "—"}</td>
                    <td>{order.department || "—"}</td>
                    <td>{order.reportDay || "—"}</td>
                    <td>
                      <HisBadge status={order.hisStatus} />
                    </td>
                    <td>
                      <span className={`badge ${String(order.readiness || "").toLowerCase()}`}>
                        {readinessLabel(order)}
                      </span>
                    </td>
                    <td>{formatDateTime(order.completedAt)}</td>
                    <td>
                      <WaBadge label={order.whatsappLabel} tone={order.whatsappTone} />
                    </td>
                    <td>
                      <div className="row-actions">
                        {order.canPreview ? (
                          <button
                            type="button"
                            className="secondary btn-sm"
                            onClick={() => setPreviewOrder(order)}
                          >
                            Preview
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="primary btn-sm"
                          disabled={
                            !order.canQueue ||
                            queueingId === order.orderId ||
                            order.readiness === "WAITING"
                          }
                          onClick={() => addToQueue(order)}
                        >
                          {queueingId === order.orderId
                            ? "Adding…"
                            : order.synced && order.whatsappTone === "sent"
                              ? "Sent"
                              : order.synced
                                ? "In queue"
                                : "Add to queue"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No matching reports"
            body="Try a wider date range, a different filter, or clear the search box."
          />
        )}
      </div>

      {previewOrder ? (
        <PdfPreviewModal order={previewOrder} onClose={() => setPreviewOrder(null)} />
      ) : null}
    </>
  );
}
