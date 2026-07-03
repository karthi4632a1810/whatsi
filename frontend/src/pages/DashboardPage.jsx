import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { HisBadge } from "../components/Badge.jsx";
import EmptyState from "../components/EmptyState.jsx";
import PageHeader from "../components/PageHeader.jsx";
import PdfPreviewModal from "../components/PdfPreviewModal.jsx";
import {
  HIS_CACHE_STALE_MS,
  isHisCacheStale,
  loadBoardFromCache,
  mergeBoardIntoCache,
} from "../lib/hisCache.js";
import { applyHisFilter, computeHisSummary, filterHisOrders } from "../lib/hisFilters.js";
import { formatEmrError } from "../lib/emrErrors.js";
import { formatPatientName } from "../lib/format.js";

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "completed", label: "Approved" },
  { value: "approved", label: "Partial" },
  { value: "ready", label: "Ready" },
];

function todayValue() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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

function formatSyncedAt(value) {
  if (!value) return null;
  return new Date(value).toLocaleTimeString("en-IN", {
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

function SyncBar({ fetchedAt, loadingEmr, filteredCount, totalCount, isPastDate }) {
  let dotClass = "sync-dot";
  let label = "Not synced yet";

  if (loadingEmr) {
    dotClass += " sync-dot--pulse";
    label = isPastDate
      ? "Loading EMR in chunks (may take 1–2 min)…"
      : "Fetching from EMR…";
  } else if (fetchedAt) {
    const stale = isHisCacheStale(fetchedAt);
    dotClass += stale ? " sync-dot--stale" : " sync-dot--live";
    label = stale
      ? `Cached · last synced ${formatSyncedAt(fetchedAt)} · refresh recommended`
      : `Live cache · synced ${formatSyncedAt(fetchedAt)}`;
  }

  return (
    <div className="sync-bar" role="status" aria-live="polite">
      <span className={dotClass} aria-hidden />
      <span>{label}</span>
      {totalCount > 0 && !loadingEmr ? (
        <span>
          · Showing <strong>{filteredCount}</strong> of <strong>{totalCount}</strong> orders
        </span>
      ) : null}
    </div>
  );
}

function SystemStatus({ health, stats }) {
  if (!health && !stats) return null;

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <h3 className="panel-title">System</h3>
      <div className="status-pills">
        <span className={`status-pill ${health?.wati?.ok ? "ok" : "bad"}`}>
          WATI {health?.wati?.ok ? "connected" : "error"}
        </span>
        <span className={`status-pill ${health?.watiSendEnabled ? "warn" : "ok"}`}>
          Send {health?.watiSendEnabled ? "enabled" : "disabled (safe)"}
        </span>
        <span className={`status-pill ${health?.emrPollEnabled ? "ok" : "neutral"}`}>
          EMR poll {health?.emrPollEnabled ? "on" : "off"}
        </span>
        <span className={`status-pill ${stats?.automationEnabled ? "ok" : "neutral"}`}>
          Automation {stats?.automationEnabled ? "on" : "off"}
        </span>
        {stats?.endOfDayTime ? (
          <span className="status-pill neutral">EOD {stats.endOfDayTime}</span>
        ) : null}
        <span className="status-pill neutral">
          Cache {Math.round(HIS_CACHE_STALE_MS / 60000)} min
        </span>
      </div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {Array.from({ length: 11 }).map((_, i) => (
              <th key={i}>—</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }).map((_, row) => (
            <tr key={row} className="skeleton-row">
              {Array.from({ length: 11 }).map((_, col) => (
                <td key={col}>
                  <div className="skeleton" style={{ width: col === 1 ? "80%" : "60%" }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [health, setHealth] = useState(null);
  const [allOrders, setAllOrders] = useState([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [date, setDate] = useState(todayValue);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [changedIds, setChangedIds] = useState(() => new Set());
  const [error, setError] = useState("");
  const [loadingCache, setLoadingCache] = useState(true);
  const [loadingEmr, setLoadingEmr] = useState(false);
  const [previewOrder, setPreviewOrder] = useState(null);

  const isToday = date === todayValue();
  const filteredOrders = useMemo(
    () => filterHisOrders(allOrders, { filter, query: search }),
    [allOrders, filter, search]
  );
  const summary = useMemo(() => computeHisSummary(allOrders), [allOrders]);

  const refreshFromHis = useCallback(
    async ({ silent = false } = {}) => {
      setError("");
      if (!silent) setLoadingEmr(true);
      try {
        const lab = await api.hisLabToday({ from: date, to: date });
        const merged = await mergeBoardIntoCache(date, lab.orders || []);
        setAllOrders(merged.orders);
        setFetchedAt(merged.fetchedAt);

        if (merged.changedOrderIds.length) {
          setChangedIds(new Set(merged.changedOrderIds));
          window.setTimeout(() => setChangedIds(new Set()), 3000);
        }
      } catch (e) {
        setError(formatEmrError(e.message));
      } finally {
        if (!silent) setLoadingEmr(false);
      }
    },
    [date]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadDate() {
      setLoadingCache(true);
      setError("");

      let cachedOrders = [];
      let cachedFetchedAt = null;

      try {
        const cached = await loadBoardFromCache(date);
        if (cancelled) return;

        if (cached?.orders?.length) {
          cachedOrders = cached.orders;
          cachedFetchedAt = cached.fetchedAt;
          setAllOrders(cached.orders);
          setFetchedAt(cached.fetchedAt);
        } else {
          setAllOrders([]);
          setFetchedAt(null);
        }
      } catch (e) {
        if (!cancelled) setError(formatEmrError(e.message));
      } finally {
        if (!cancelled) setLoadingCache(false);
      }

      if (cancelled) return;

      const shouldRefresh =
        !cachedFetchedAt || isHisCacheStale(cachedFetchedAt) || !cachedOrders.length;
      if (shouldRefresh) {
        refreshFromHis({ silent: Boolean(cachedOrders.length) });
      }
    }

    loadDate();
    return () => {
      cancelled = true;
    };
  }, [date, refreshFromHis]);

  useEffect(() => {
    api.stats().then(setStats).catch(() => {});
    api.health().then(setHealth).catch(() => {});
  }, []);

  async function syncQueue() {
    try {
      await api.pollEmr({ from: date, to: date });
      await refreshFromHis();
    } catch (e) {
      setError(e.message);
    }
  }

  const showTableLoading = loadingCache && !allOrders.length;

  return (
    <div>
      <PageHeader
        eyebrow="HIS lab board"
        title={isToday ? "Today's lab reports" : `Lab reports · ${formatDisplayDate(date)}`}
        lead={
          <>
            Completion status from EMR for <strong>{formatDisplayDate(date)}</strong>. Search
            and status filters apply instantly from cache — use Refresh to pull new data from HIS.
          </>
        }
      />

      {error ? (
        <p className={allOrders.length ? "warn-banner" : "error"} role="alert">
          {error}
          {allOrders.length && fetchedAt
            ? ` Showing cached data from ${formatSyncedAt(fetchedAt)} — click Refresh to retry.`
            : null}
        </p>
      ) : null}

      <div className="cards">
        <div className="stat-card stat-card--orders">
          <h3>HIS orders</h3>
          <div className="value">{summary.totalOrders || "—"}</div>
        </div>
        <div className="stat-card stat-card--approved">
          <h3>Result approved</h3>
          <div className="value">{summary.approved || "—"}</div>
        </div>
        <div className="stat-card stat-card--ready">
          <h3>Ready to send</h3>
          <div className="value">{summary.ready || "—"}</div>
        </div>
        <div className="stat-card stat-card--sent">
          <h3>WhatsApp sent</h3>
          <div className="value">{summary.sent || stats?.sentToday || "—"}</div>
        </div>
      </div>

      <div className="panel">
        <div className="toolbar">
          <div className="toolbar-row">
            <label className="field-label field-label--grow">
              Search UHID / order
              <input
                className="search-input"
                type="search"
                placeholder="UHID, order ID, name, or mobile"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search by UHID, order ID, patient name, or mobile"
              />
            </label>
            <label className="field-label">
              Date
              <input
                type="date"
                value={date}
                max={todayValue()}
                onChange={(e) => setDate(e.target.value || todayValue())}
              />
            </label>
            <button
              className="secondary"
              type="button"
              disabled={isToday}
              onClick={() => setDate(todayValue())}
            >
              Today
            </button>
            <div className="filter-pills" role="group" aria-label="HIS status filter">
              {STATUS_FILTERS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`filter-pill${filter === opt.value ? " is-active" : ""}`}
                  aria-pressed={filter === opt.value}
                  onClick={() => setFilter(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="toolbar-row toolbar-row--actions">
            <div className="toolbar-actions">
              <button type="button" onClick={() => refreshFromHis()} disabled={loadingEmr}>
                {loadingEmr ? "Refreshing…" : "Refresh from HIS"}
              </button>
              <button className="secondary" type="button" onClick={syncQueue}>
                Sync to queue
              </button>
            </div>
          </div>
        </div>

        <SyncBar
          fetchedAt={fetchedAt}
          loadingEmr={loadingEmr}
          filteredCount={filteredOrders.length}
          totalCount={allOrders.length}
          isPastDate={!isToday}
        />

        {showTableLoading ? (
          <TableSkeleton />
        ) : filteredOrders.length ? (
          <div className="table-wrap">
            <table className="his-table">
              <colgroup>
                <col className="col-order" />
                <col className="col-patient" />
                <col className="col-uhid" />
                <col className="col-mobile" />
                <col className="col-dept" />
                <col className="col-opip" />
                <col className="col-his-status" />
                <col className="col-tests" />
                <col className="col-completed" />
                <col className="col-ready" />
                <col className="col-wa" />
                <col className="col-pdf" />
              </colgroup>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Patient</th>
                  <th>UHID</th>
                  <th>Mobile</th>
                  <th>Dept</th>
                  <th>OP/IP</th>
                  <th>HIS status</th>
                  <th>Tests</th>
                  <th>Completed</th>
                  <th className="col-ready">Ready</th>
                  <th className="col-wa">WhatsApp</th>
                  <th className="col-pdf">PDF</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <tr
                    key={order.orderId}
                    className={changedIds.has(order.orderId) ? "row-updated" : undefined}
                  >
                    <td className="td-mono">{order.orderId}</td>
                    <td className="td-patient" title={formatPatientName(order.patientName)}>
                      {formatPatientName(order.patientName)}
                    </td>
                    <td className="td-mono">{order.patientId}</td>
                    <td className="td-mono">{order.phone}</td>
                    <td className="td-dept" title={order.department}>
                      {order.department}
                    </td>
                    <td>{order.opIpType}</td>
                    <td className="td-status">
                      <HisBadge status={order.hisStatus} />
                    </td>
                    <td className="col-tests">
                      {order.approvedCount}/{order.procedureTotal}
                    </td>
                    <td className="td-mono col-completed">
                      {order.completedAt
                        ? new Date(order.completedAt).toLocaleString("en-IN", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })
                        : "—"}
                    </td>
                    <td className="td-ready col-ready">
                      <span className={`badge ${order.readiness?.toLowerCase()}`}>
                        {order.readiness}
                      </span>
                    </td>
                    <td className="td-wa col-wa">
                      <WaBadge label={order.whatsappLabel} tone={order.whatsappTone} />
                    </td>
                    <td className="col-pdf">
                      {order.canPreview ? (
                        <button
                          type="button"
                          className="btn-sm secondary"
                          onClick={() => setPreviewOrder(order)}
                        >
                          Preview
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
            title="No orders match this filter"
            hint={
              search.trim()
                ? "Try a different UHID, order ID, or clear the search box."
                : "Try a different status filter or pick another date."
            }
          />
        )}
      </div>

      <SystemStatus health={health} stats={stats} />
      <PdfPreviewModal order={previewOrder} onClose={() => setPreviewOrder(null)} />
    </div>
  );
}
