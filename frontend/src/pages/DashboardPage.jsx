import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { HisBadge } from "../components/Badge.jsx";
import EmptyState from "../components/EmptyState.jsx";
import PageHeader from "../components/PageHeader.jsx";
import PdfPreviewModal from "../components/PdfPreviewModal.jsx";
import {
  EMPTY_ADVANCED,
  SEARCH_FIELDS,
  buildFilterOptions,
  computeHisSummary,
  countActiveAdvanced,
  filterHisBoard,
} from "../lib/hisFilters.js";
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

function orderFingerprint(order) {
  return [
    order.orderId,
    order.readiness,
    order.hisStatus,
    order.approvedCount,
    order.procedureTotal,
    order.waTone || "",
    order.waLabel || "",
    order.phone || "",
    order.completedAt || "",
  ].join("|");
}

function diffChangedOrderIds(prevOrders, nextOrders) {
  const prevMap = new Map((prevOrders || []).map((o) => [String(o.orderId), orderFingerprint(o)]));
  const changed = [];
  for (const order of nextOrders || []) {
    const id = String(order.orderId);
    const nextFp = orderFingerprint(order);
    if (!prevMap.has(id) || prevMap.get(id) !== nextFp) {
      changed.push(id);
    }
  }
  return changed;
}


function WaBadge({ label, tone }) {
  if (!label || tone === "idle") {
    return <span className="wa-idle">{label || "Not queued"}</span>;
  }
  return <span className={`badge wa-badge wa-badge--${tone}`}>{label}</span>;
}

function SyncBar({ fetchedAt, loadingEmr, filteredCount, totalCount, isPastDate, source, refreshProgress }) {
  let dotClass = "sync-dot";
  let label = "Board not loaded — refresh from HIS";

  if (loadingEmr) {
    dotClass += " sync-dot--pulse";
    const chunksDone = refreshProgress?.chunksDone || 0;
    const chunksTotal = refreshProgress?.chunksTotal || 0;
    const orderCount = refreshProgress?.orderCount || totalCount || 0;
    if (chunksTotal > 0) {
      label = `Loading HIS chunk ${chunksDone}/${chunksTotal} · ${orderCount} orders so far…`;
    } else {
      label = isPastDate
        ? "Starting chunked HIS load (2-hour slices)…"
        : "Starting chunked HIS load…";
    }
  } else if (fetchedAt) {
    dotClass += " sync-dot--live";
    const src = source === "emr" ? "HIS" : "server";
    label = `${src} board · synced ${formatSyncedAt(fetchedAt)}`;
  }

  const progressPct =
    refreshProgress?.chunksTotal > 0
      ? Math.round((refreshProgress.chunksDone / refreshProgress.chunksTotal) * 100)
      : 0;

  return (
    <div className="sync-bar-wrap">
      <div className="sync-bar" role="status" aria-live="polite">
        <span className={dotClass} aria-hidden />
        <span>{label}</span>
        {totalCount > 0 ? (
          <span>
            · Showing <strong>{filteredCount}</strong> of <strong>{totalCount}</strong> orders
          </span>
        ) : null}
      </div>
      {loadingEmr && refreshProgress?.chunksTotal > 0 ? (
        <div
          className="sync-bar-progress"
          role="progressbar"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="sync-bar-progress__fill" style={{ width: `${progressPct}%` }} />
        </div>
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
          WATI {health?.wati?.ok ? "configured" : "not configured"}
        </span>
        <span className={`status-pill ${stats?.messageSendEnabled ? "warn" : "ok"}`}>
          Send {stats?.messageSendEnabled ? "enabled" : "disabled (safe)"}
        </span>
        <span className={`status-pill ${health?.emrPollEnabled ? "ok" : "neutral"}`}>
          EMR poll {health?.emrPollEnabled ? "on" : "off"}
        </span>
        <span className={`status-pill ${stats?.automationEnabled ? "ok" : "neutral"}`}>
          Queue sync {stats?.automationEnabled ? "on" : "off"}
        </span>
        {stats?.mode === "END_OF_DAY" || stats?.mode === "CUSTOM_SCHEDULE" ? (
          <span className="status-pill neutral">EOD {stats.endOfDayTime}</span>
        ) : stats ? (
          <span className="status-pill neutral">Send {stats.sendDelayHours ?? 3}h after approval</span>
        ) : null}
        {stats?.quietHoursEnabled ? (
          <span className="status-pill neutral">
            Night hold {stats.quietStart}–{stats.quietEnd}
          </span>
        ) : null}
        <span className="status-pill neutral">Board in MongoDB</span>
      </div>
    </div>
  );
}

const ADVANCED_LABELS = {
  department: "Dept",
  hisStatus: "HIS status",
  readiness: "Ready",
  whatsapp: "WhatsApp",
  patientType: "Patient type",
  tests: "Tests",
  mobile: "Mobile",
};

function SelectFilter({ label, value, options, onChange }) {
  // Keep a chosen value visible after a date change removes it from the day's options.
  const list =
    value && !options.some((o) => o.value === value) ? [...options, { value, count: 0 }] : options;
  return (
    <label className="field-label">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        {list.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label || o.value} ({o.count})
          </option>
        ))}
      </select>
    </label>
  );
}

function AdvancedFilters({ value, options, onChange, onReset }) {
  const set = (key) => (next) => onChange({ ...value, [key]: next });
  return (
    <div className="adv-filters" id="his-adv-filters">
      <SelectFilter label="Department" value={value.department} options={options.department} onChange={set("department")} />
      <SelectFilter label="HIS status" value={value.hisStatus} options={options.hisStatus} onChange={set("hisStatus")} />
      <SelectFilter label="Ready" value={value.readiness} options={options.readiness} onChange={set("readiness")} />
      <SelectFilter label="WhatsApp" value={value.whatsapp} options={options.whatsapp} onChange={set("whatsapp")} />
      <SelectFilter label="Tests approved" value={value.tests} options={options.tests} onChange={set("tests")} />
      <SelectFilter label="Mobile" value={value.mobile} options={options.mobile} onChange={set("mobile")} />
      {options.patientType.length > 1 || value.patientType ? (
        <SelectFilter label="Patient type" value={value.patientType} options={options.patientType} onChange={set("patientType")} />
      ) : null}
      <label className="field-label">
        Completed from
        <input type="time" value={value.timeFrom} onChange={(e) => set("timeFrom")(e.target.value)} />
      </label>
      <label className="field-label">
        Completed to
        <input type="time" value={value.timeTo} onChange={(e) => set("timeTo")(e.target.value)} />
      </label>
      <div className="adv-foot">
        <span>
          Tip: type several words in Search to narrow down, e.g. <code>latha cbc</code>. Counts are
          for the whole day.
        </span>
        <button type="button" className="filter-pill adv-reset" onClick={onReset}>
          Reset filters
        </button>
      </div>
    </div>
  );
}

function ActiveFilters({ chips, onClearAll }) {
  if (!chips.length) return null;
  return (
    <div className="active-filters" aria-label="Active filters">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className="filter-pill active-chip"
          onClick={chip.clear}
          aria-label={`Remove filter ${chip.label}`}
        >
          {chip.label}
          <span className="active-chip-x" aria-hidden>
            ×
          </span>
        </button>
      ))}
      {chips.length > 1 ? (
        <button type="button" className="filter-pill clear-all" onClick={onClearAll}>
          Clear all
        </button>
      ) : null}
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
  const [searchField, setSearchField] = useState("all");
  const [advanced, setAdvanced] = useState(EMPTY_ADVANCED);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [date, setDate] = useState(todayValue);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [changedIds, setChangedIds] = useState(() => new Set());
  const [error, setError] = useState("");
  const [loadingCache, setLoadingCache] = useState(true);
  const [loadingEmr, setLoadingEmr] = useState(false);
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");
  const [boardSource, setBoardSource] = useState("mongodb");
  const [refreshProgress, setRefreshProgress] = useState(null);
  const [previewOrder, setPreviewOrder] = useState(null);
  const ordersRef = useRef([]);
  const highlightTimerRef = useRef(null);
  const softRefreshBusyRef = useRef(false);

  const isToday = date === todayValue();
  const filteredOrders = useMemo(
    () => filterHisBoard(allOrders, { filter, query: search, field: searchField, advanced }),
    [allOrders, filter, search, searchField, advanced]
  );
  const summary = useMemo(() => computeHisSummary(allOrders), [allOrders]);
  const filterOptions = useMemo(() => buildFilterOptions(allOrders), [allOrders]);
  const advancedCount = countActiveAdvanced(advanced);
  const searchFieldLabel = SEARCH_FIELDS.find((f) => f.value === searchField)?.label;

  const activeChips = useMemo(() => {
    const chips = [];
    if (search.trim()) {
      chips.push({
        key: "search",
        label: `${searchField === "all" ? "Search" : searchFieldLabel}: "${search.trim()}"`,
        clear: () => setSearch(""),
      });
    }
    if (filter !== "all") {
      chips.push({
        key: "status",
        label: STATUS_FILTERS.find((f) => f.value === filter)?.label || filter,
        clear: () => setFilter("all"),
      });
    }
    for (const [key, name] of Object.entries(ADVANCED_LABELS)) {
      const value = advanced[key];
      if (!value) continue;
      const shown = filterOptions[key]?.find((o) => o.value === value)?.label || value;
      chips.push({
        key,
        label: `${name}: ${shown}`,
        clear: () => setAdvanced((prev) => ({ ...prev, [key]: "" })),
      });
    }
    if (advanced.timeFrom || advanced.timeTo) {
      chips.push({
        key: "time",
        label: `Completed ${advanced.timeFrom || "start"}–${advanced.timeTo || "end"}`,
        clear: () => setAdvanced((prev) => ({ ...prev, timeFrom: "", timeTo: "" })),
      });
    }
    return chips;
  }, [search, searchField, searchFieldLabel, filter, advanced, filterOptions]);

  function clearAllFilters() {
    setSearch("");
    setSearchField("all");
    setFilter("all");
    setAdvanced(EMPTY_ADVANCED);
  }

  const applyOrders = useCallback((orders, { highlight = true } = {}) => {
    const next = orders || [];
    if (highlight && ordersRef.current.length) {
      const changed = diffChangedOrderIds(ordersRef.current, next);
      if (changed.length) {
        setChangedIds(new Set(changed));
        if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = window.setTimeout(() => setChangedIds(new Set()), 4000);
      }
    }
    ordersRef.current = next;
    setAllOrders(next);
  }, []);

  const loadFromServer = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) {
      setError("");
      setLoadingCache(true);
    }
    try {
      const lab = await api.hisLabToday({ from: date, to: date });
      applyOrders(lab.orders || [], { highlight: quiet });
      setBoardSource(lab.source || "mongodb");
      setFetchedAt(lab.lastSyncAt ? new Date(lab.lastSyncAt).getTime() : null);
      if (lab.needsRefresh && !quiet) {
        setError("No board saved for this day yet — click Refresh from HIS once.");
      }
    } catch (e) {
      if (!quiet) setError(formatEmrError(e.message));
    } finally {
      if (!quiet) setLoadingCache(false);
    }
  }, [date, applyOrders]);

  const refreshFromHis = useCallback(
    async ({ silent = false } = {}) => {
      setError("");
      if (!silent) setLoadingEmr(true);
      setRefreshProgress({ chunksDone: 0, chunksTotal: 0, orderCount: 0 });

      try {
        await api.startHisBoardRefresh({ date });

        while (true) {
          const [lab, status] = await Promise.all([
            api.hisLabToday({ from: date, to: date }),
            api.hisBoardRefreshStatus({ date }),
          ]);

          applyOrders(lab.orders || [], { highlight: silent });
          setBoardSource(lab.source || "mongodb");
          setRefreshProgress(status.refreshProgress || null);
          setFetchedAt(
            lab.lastSyncAt ? new Date(lab.lastSyncAt).getTime() : Date.now()
          );

          if (status.refreshStatus !== "running") {
            if (status.refreshStatus === "error") {
              setError(formatEmrError(status.refreshError || "HIS refresh failed"));
            }
            break;
          }

          await new Promise((resolve) => window.setTimeout(resolve, 2000));
        }
      } catch (e) {
        setError(formatEmrError(e.message));
      } finally {
        if (!silent) setLoadingEmr(false);
        setRefreshProgress(null);
      }
    },
    [date, applyOrders]
  );

  useEffect(() => {
    ordersRef.current = [];
    setChangedIds(new Set());
    loadFromServer();
  }, [loadFromServer]);

  // Reload board often so queue/WhatsApp status updates show quickly
  useEffect(() => {
    if (loadingEmr) return undefined;
    const intervalId = window.setInterval(() => {
      if (document.hidden) return;
      loadFromServer({ quiet: true });
    }, 12000);
    return () => window.clearInterval(intervalId);
  }, [loadFromServer, loadingEmr]);

  // Soft pull from HIS so NEW / changed rows appear without clicking Refresh
  useEffect(() => {
    if (loadingEmr || !isToday) return undefined;

    async function softPull() {
      if (document.hidden || softRefreshBusyRef.current || loadingEmr) return;
      softRefreshBusyRef.current = true;
      try {
        await api.softHisBoardRefresh({ date });
        await loadFromServer({ quiet: true });
      } catch {
        // Keep board as-is; next tick retries
      } finally {
        softRefreshBusyRef.current = false;
      }
    }

    const intervalId = window.setInterval(softPull, 90000);
    const firstId = window.setTimeout(softPull, 15000);
    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(firstId);
    };
  }, [date, isToday, loadFromServer, loadingEmr]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    };
  }, []);

  useEffect(() => {
    api.stats().then(setStats).catch(() => {});
    api.health().then(setHealth).catch(() => {});
  }, []);

  async function syncQueue() {
    setError("");
    setSyncNotice("");
    setSyncingQueue(true);
    try {
      const result = await api.pollEmr({ from: date, to: date });
      const created = result.created ?? 0;
      const updated = result.updated ?? 0;
      const skipped = result.skipped ?? 0;
      setSyncNotice(
        `Queue sync for ${result.labDay || date}: ${created} added, ${updated} updated, ${skipped} skipped (${result.candidates ?? "—"} ready/partial on board).`
      );
      await refreshFromHis({ silent: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncingQueue(false);
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
            Completion status from EMR for <strong>{formatDisplayDate(date)}</strong>. Loaded in
            2-hour chunks — orders appear as each slice finishes. Filters work instantly from the
            server board.
          </>
        }
      />

      {syncNotice ? <p className="success-banner" role="status">{syncNotice}</p> : null}

      {error ? (
        <p className={allOrders.length ? "warn-banner" : "error"} role="alert">
          {error}
          {allOrders.length && fetchedAt
            ? ` Showing cached data from ${formatSyncedAt(fetchedAt)} — click Refresh to retry.`
            : null}
        </p>
      ) : null}

      <div className="cards cards--three">
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
      </div>

      <div className="panel">
        <div className="toolbar">
          <div className="toolbar-row">
            <label className="field-label field-label--grow">
              Search
              <input
                className="search-input"
                type="search"
                placeholder={
                  searchField === "all"
                    ? "Name, UHID, order, mobile, dept, test…"
                    : `Search ${searchFieldLabel.toLowerCase()}…`
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label={`Search orders by ${searchFieldLabel.toLowerCase()}`}
              />
            </label>
            <label className="field-label">
              Search in
              <select value={searchField} onChange={(e) => setSearchField(e.target.value)}>
                {SEARCH_FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary adv-toggle"
              type="button"
              aria-expanded={showAdvanced}
              aria-controls="his-adv-filters"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              Filters
              {advancedCount ? <span className="adv-count">{advancedCount}</span> : null}
            </button>
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
          {showAdvanced ? (
            <AdvancedFilters
              value={advanced}
              options={filterOptions}
              onChange={setAdvanced}
              onReset={() => setAdvanced(EMPTY_ADVANCED)}
            />
          ) : null}
          <ActiveFilters chips={activeChips} onClearAll={clearAllFilters} />
          <div className="toolbar-row toolbar-row--actions">
            <div className="toolbar-actions">
              <button type="button" onClick={() => refreshFromHis()} disabled={loadingEmr}>
                {loadingEmr ? "Refreshing…" : "Refresh from HIS"}
              </button>
              <button
                className="secondary"
                type="button"
                disabled={syncingQueue || loadingEmr}
                onClick={syncQueue}
              >
                {syncingQueue ? "Syncing…" : "Sync to queue"}
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
          source={boardSource}
          refreshProgress={refreshProgress}
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
            title={allOrders.length ? "No orders match these filters" : "No orders for this day"}
            hint={
              activeChips.length ? (
                <button type="button" className="secondary" onClick={clearAllFilters}>
                  Clear all filters
                </button>
              ) : (
                "Pick another date or refresh from HIS."
              )
            }
          />
        )}
      </div>

      <SystemStatus health={health} stats={stats} />
      <PdfPreviewModal order={previewOrder} onClose={() => setPreviewOrder(null)} />
    </div>
  );
}
