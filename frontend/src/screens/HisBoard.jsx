import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import PageHeader from "../components/PageHeader.jsx";
import PdfPreviewModal from "../components/PdfPreviewModal.jsx";
import {
  EMPTY_ADVANCED,
  SEARCH_FIELDS,
  applyHisFilter,
  buildFilterOptions,
  computeHisSummary,
  countActiveAdvanced,
  filterHisBoard,
  isValidMobile,
} from "../lib/hisFilters.js";
import { formatEmrError } from "../lib/emrErrors.js";
import { formatPatientName } from "../lib/format.js";
import { track } from "../portal/audit.js";
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FilePdfIcon,
  FilterIcon,
  PhoneIcon,
  RefreshIcon,
  RotateCcwIcon,
  SearchIcon,
  SendIcon,
} from "../portal/Icons.jsx";
import { CopyableChip, Empty, HisStatusPill, Loading, ReadyPill, Toast, WaPill, fmtTime, prettyPhone, useToast } from "./ui.jsx";
import { SendWhatsAppButton } from "./SendWhatsApp.jsx";
import { OrderInfoButton } from "./OrderInfo.jsx";

/** Status chips above the table; `value` is the hisFilters.js filter id. */
const STATUS_FILTERS = [
  { value: "all", label: "All orders" },
  { value: "completed", label: "All results approved" },
  { value: "approved", label: "Some approved" },
  { value: "ready", label: "Ready to send" },
];
const ADVANCED_LABELS = { department: "Dept", hisStatus: "HIS status", readiness: "Ready", whatsapp: "WhatsApp", patientType: "Patient type", tests: "Tests", mobile: "Mobile" };
const PAGE_SIZES = [50, 100, "all"];

function todayValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftDay(value, days) {
  const [y, m, d] = value.split("-").map(Number);
  const next = new Date(y, m - 1, d + days);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
}

function humanDay(value) {
  const today = todayValue();
  if (value === today) return "Today";
  if (value === shiftDay(today, -1)) return "Yesterday";
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

function orderFingerprint(o) {
  return [o.orderId, o.readiness, o.hisStatus, o.approvedCount, o.procedureTotal, o.whatsappTone || "", o.whatsappLabel || "", o.phone || "", o.completedAt || ""].join("|");
}

function changedOrderIds(prev, next) {
  const before = new Map((prev || []).map((o) => [String(o.orderId), orderFingerprint(o)]));
  return (next || []).filter((o) => before.get(String(o.orderId)) !== orderFingerprint(o)).map((o) => String(o.orderId));
}

/** The portal's telemetry card: where the board stands, the day's counts, and the two actions. */
function BoardStatus({ fetchedAt, loadingEmr, progress, summary, stats, canSend, onRefresh, onSync, syncing }) {
  const pct = progress?.chunksTotal ? Math.round((progress.chunksDone / progress.chunksTotal) * 100) : 0;
  return (
    <div className="automation-card modern-telemetry-card op-board-status">
      <div className="automation-status-col">
        <div className={`automation-dot-ring ${loadingEmr ? "checking" : "idle"}`}>
          <div className="automation-dot-core" />
        </div>
        <div className="automation-meta-text">
          <div className="automation-headline">
            {loadingEmr ? (
              <span className="automation-checking-text">
                {progress?.chunksTotal ? `Loading from HIS — slice ${progress.chunksDone} of ${progress.chunksTotal} · ${progress.orderCount || 0} orders so far` : "Starting the HIS load…"}
              </span>
            ) : fetchedAt ? (
              <>Board synced at {fmtTime(fetchedAt)}</>
            ) : (
              "Board not loaded for this day yet"
            )}
          </div>
          <div className="automation-last-run">
            {loadingEmr && progress?.chunksTotal ? (
              <span className="op-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <i style={{ width: `${pct}%` }} />
              </span>
            ) : (
              <>
                Sending {stats?.messageSendEnabled ? "on" : "off (safe)"} · {stats?.mode === "END_OF_DAY" ? `daily at ${stats.endOfDayTime}` : `${stats?.sendDelayHours ?? 3} h after approval`}
                {stats?.quietHoursEnabled ? ` · night hold ${stats.quietStart}–${stats.quietEnd}` : ""}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="automation-stats-chips">
        <span className="stat-chip chip-found" title="OP orders in HIS for this day">
          <strong>{summary.totalOrders}</strong> orders
        </span>
        <span className="stat-chip chip-existing" title="Every result approved">
          <strong>{summary.approved}</strong> approved
        </span>
        <span className="stat-chip chip-generated" title="Ready to send on WhatsApp">
          <strong>{summary.ready}</strong> ready
        </span>
        {summary.partial > 0 && (
          <span className="stat-chip chip-nodata" title="Some results still waiting">
            <strong>{summary.partial}</strong> partial
          </span>
        )}
        <span className="stat-chip chip-generated" title="Sent on WhatsApp">
          <strong>{summary.sent}</strong> sent
        </span>
      </div>

      {canSend && (
        <div className="op-board-actions">
          <button type="button" className="btn btn-secondary btn-check-now" onClick={onSync} disabled={syncing || loadingEmr} title="Add ready and partial reports of this day to the WhatsApp queue">
            <SendIcon size={15} />
            <span>{syncing ? "Syncing…" : "Sync to queue"}</span>
          </button>
          <button type="button" className="btn btn-primary btn-check-now" onClick={onRefresh} disabled={loadingEmr} title="Load this day again from HIS">
            <RefreshIcon spinning={loadingEmr} size={15} />
            <span>{loadingEmr ? "Refreshing…" : "Refresh from HIS"}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function SelectField({ id, label, value, options, onChange }) {
  // Keep a chosen value visible after a date change removes it from the day's options.
  const list = value && !options.some((o) => o.value === value) ? [...options, { value, count: 0 }] : options;
  return (
    <div className="enhanced-field">
      <label htmlFor={id}>{label}</label>
      <div className="field-input-box">
        <select id={id} className="filter-control" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Any</option>
          {list.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label || o.value} ({o.count})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function AdvancedFilters({ value, options, onChange, onReset }) {
  const set = (key) => (next) => onChange({ ...value, [key]: next });
  return (
    <div className="advanced-search-container enhanced-search-panel op-adv" id="his-adv-filters">
      <div className="advanced-search-header-bar">
        <div className="search-panel-title-wrap">
          <div className="panel-badge-icon">
            <FilterIcon size={20} />
          </div>
          <div>
            <h3 className="panel-title">Filter the day's orders</h3>
            <p className="panel-subtitle">Counts are for the whole day. Type several words in Search to narrow down, e.g. “latha cbc”.</p>
          </div>
        </div>
        <button type="button" className="btn-panel-reset" onClick={onReset}>
          <RotateCcwIcon size={13} />
          <span>Reset filters</span>
        </button>
      </div>
      <div className="filter-card-section">
        <div className="filter-input-grid">
          <SelectField id="f-dept" label="Department" value={value.department} options={options.department} onChange={set("department")} />
          <SelectField id="f-his" label="HIS status" value={value.hisStatus} options={options.hisStatus} onChange={set("hisStatus")} />
          <SelectField id="f-ready" label="Ready" value={value.readiness} options={options.readiness} onChange={set("readiness")} />
          <SelectField id="f-wa" label="WhatsApp" value={value.whatsapp} options={options.whatsapp} onChange={set("whatsapp")} />
          <SelectField id="f-tests" label="Tests approved" value={value.tests} options={options.tests} onChange={set("tests")} />
          <SelectField id="f-mobile" label="Mobile" value={value.mobile} options={options.mobile} onChange={set("mobile")} />
          {(options.patientType.length > 1 || value.patientType) && (
            <SelectField id="f-ptype" label="Patient type" value={value.patientType} options={options.patientType} onChange={set("patientType")} />
          )}
          <div className="enhanced-field">
            <label htmlFor="f-from">Completed from</label>
            <div className="field-input-box">
              <input id="f-from" className="filter-control" type="time" value={value.timeFrom} onChange={(e) => set("timeFrom")(e.target.value)} />
            </div>
          </div>
          <div className="enhanced-field">
            <label htmlFor="f-to">Completed to</label>
            <div className="field-input-box">
              <input id="f-to" className="filter-control" type="time" value={value.timeTo} onChange={(e) => set("timeTo")(e.target.value)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActiveFilters({ chips, onClearAll }) {
  if (!chips.length) return null;
  return (
    <div className="op-active-filters" aria-label="Active filters">
      {chips.map((chip) => (
        <button key={chip.key} type="button" className="op-active-chip" onClick={chip.clear} aria-label={`Remove filter ${chip.label}`}>
          {chip.label}
          <span aria-hidden>×</span>
        </button>
      ))}
      {chips.length > 1 && (
        <button type="button" className="op-clear-all" onClick={onClearAll}>
          Clear all
        </button>
      )}
    </div>
  );
}

function BoardTable({ orders, changedIds, onPreview, onToast, canSend, delivery, canChangeMode, onSent }) {
  return (
    <div className="table-wrap modern-table-wrap">
      <table className="results modern-results-table op-board-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Patient</th>
            <th>UHID</th>
            <th>Mobile</th>
            <th>Department</th>
            <th>Tests</th>
            <th>HIS status</th>
            <th>Ready</th>
            <th>WhatsApp</th>
            <th>Completed</th>
            <th className="th-action">Report</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const validMobile = isValidMobile(o.phone);
            const pct = o.procedureTotal ? Math.round((o.approvedCount / o.procedureTotal) * 100) : 0;
            return (
              <tr key={o.orderId} className={changedIds.has(String(o.orderId)) ? "op-row-updated" : undefined}>
                <td>
                  <CopyableChip value={o.orderId} label="Order" className="code-chip code-chip-ip" onToast={onToast} />
                </td>
                <td className="op-cell-patient">
                  <span className="op-name">{formatPatientName(o.patientName)}</span>
                  {(o.age || o.gender) && <small>{[o.age, o.gender].filter(Boolean).join(" · ")}</small>}
                </td>
                <td>
                  <CopyableChip value={o.patientId} label="UHID" className="code-chip code-chip-reg" onToast={onToast} />
                </td>
                <td>
                  {o.phone ? (
                    <div className="mobile-interactive-wrap">
                      <a href={`tel:${String(o.phone).replace(/\D/g, "")}`} className={`tel-link ${validMobile ? "" : "is-invalid"}`} title={validMobile ? "Call" : "Missing or placeholder number — WhatsApp can't reach it"}>
                        <PhoneIcon size={12} />
                        <span>{prettyPhone(o.phone)}</span>
                      </a>
                    </div>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="op-cell-dept" title={o.department}>
                  {o.department || "—"}
                </td>
                <td className="op-cell-tests">
                  <span>
                    {o.approvedCount}/{o.procedureTotal}
                  </span>
                  <span className="op-mini-bar" aria-hidden>
                    <i style={{ width: `${pct}%` }} />
                  </span>
                </td>
                <td>
                  <HisStatusPill status={o.hisStatus} />
                </td>
                <td>
                  <ReadyPill readiness={o.readiness} />
                </td>
                <td>
                  <WaPill label={o.whatsappLabel} tone={o.whatsappTone} />
                </td>
                <td className="op-cell-time">{fmtTime(o.completedAt)}</td>
                <td className="cell-action">
                  <div className="action-btn-group">
                    {o.canPreview && (
                      <button type="button" className="btn btn-view-pdf" onClick={() => onPreview(o)} title={`Open the lab report of ${formatPatientName(o.patientName)}`}>
                        <FilePdfIcon size={15} />
                        <span>PDF</span>
                      </button>
                    )}
                    {o.canPreview && canSend && <SendWhatsAppButton order={o} delivery={delivery} canChangeMode={canChangeMode} onSent={onSent} />}
                    <OrderInfoButton order={o} canCheck={canSend} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** OP Lab Reports → HIS board: every OP lab order of a day from HIS, with readiness and WhatsApp state. */
export default function HisBoard({ canSend = false, canChangeMode = false, refreshSeconds = 15 }) {
  const [stats, setStats] = useState(null);
  const [delivery, setDelivery] = useState(null);
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
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState(null);
  const [previewOrder, setPreviewOrder] = useState(null);
  const [pageSize, setPageSize] = useState(50);
  const [toast, showToast, hideToast] = useToast();
  const ordersRef = useRef([]);
  const highlightTimer = useRef(null);
  const softBusy = useRef(false);
  const searchRef = useRef(null);

  const isToday = date === todayValue();
  const filteredOrders = useMemo(() => filterHisBoard(allOrders, { filter, query: search, field: searchField, advanced }), [allOrders, filter, search, searchField, advanced]);
  const summary = useMemo(() => computeHisSummary(allOrders), [allOrders]);
  const filterOptions = useMemo(() => buildFilterOptions(allOrders), [allOrders]);
  const statusCounts = useMemo(() => Object.fromEntries(STATUS_FILTERS.map((f) => [f.value, applyHisFilter(allOrders, f.value).length])), [allOrders]);
  const advancedCount = countActiveAdvanced(advanced);
  const searchFieldLabel = SEARCH_FIELDS.find((f) => f.value === searchField)?.label;
  const shownOrders = pageSize === "all" ? filteredOrders : filteredOrders.slice(0, pageSize);

  const activeChips = useMemo(() => {
    const chips = [];
    if (search.trim()) chips.push({ key: "search", label: `${searchField === "all" ? "Search" : searchFieldLabel}: “${search.trim()}”`, clear: () => setSearch("") });
    for (const [key, name] of Object.entries(ADVANCED_LABELS)) {
      const value = advanced[key];
      if (!value) continue;
      const shown = filterOptions[key]?.find((o) => o.value === value)?.label || value;
      chips.push({ key, label: `${name}: ${shown}`, clear: () => setAdvanced((prev) => ({ ...prev, [key]: "" })) });
    }
    if (advanced.timeFrom || advanced.timeTo) {
      chips.push({ key: "time", label: `Completed ${advanced.timeFrom || "start"}–${advanced.timeTo || "end"}`, clear: () => setAdvanced((prev) => ({ ...prev, timeFrom: "", timeTo: "" })) });
    }
    return chips;
  }, [search, searchField, searchFieldLabel, advanced, filterOptions]);

  function clearAllFilters() {
    setSearch("");
    setSearchField("all");
    setFilter("all");
    setAdvanced(EMPTY_ADVANCED);
  }

  const applyOrders = useCallback((orders, { highlight = true } = {}) => {
    const next = orders || [];
    if (highlight && ordersRef.current.length) {
      const changed = changedOrderIds(ordersRef.current, next);
      if (changed.length) {
        setChangedIds(new Set(changed));
        clearTimeout(highlightTimer.current);
        highlightTimer.current = setTimeout(() => setChangedIds(new Set()), 4000);
      }
    }
    ordersRef.current = next;
    setAllOrders(next);
  }, []);

  const loadFromServer = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) {
        setError("");
        setLoadingCache(true);
      }
      try {
        const lab = await api.hisLabToday({ from: date, to: date });
        applyOrders(lab.orders || [], { highlight: quiet });
        setFetchedAt(lab.lastSyncAt ? new Date(lab.lastSyncAt).getTime() : null);
        if (lab.needsRefresh && !quiet) setError(canSend ? "No board saved for this day yet — press Refresh from HIS once." : "No board saved for this day yet.");
      } catch (e) {
        if (!quiet) setError(formatEmrError(e.message));
      } finally {
        if (!quiet) setLoadingCache(false);
      }
    },
    [date, applyOrders, canSend]
  );

  const refreshFromHis = useCallback(
    async ({ silent = false } = {}) => {
      setError("");
      if (!silent) setLoadingEmr(true);
      setProgress({ chunksDone: 0, chunksTotal: 0, orderCount: 0 });
      try {
        await api.startHisBoardRefresh({ date });
        for (;;) {
          const [lab, status] = await Promise.all([api.hisLabToday({ from: date, to: date }), api.hisBoardRefreshStatus({ date })]);
          applyOrders(lab.orders || [], { highlight: silent });
          setProgress(status.refreshProgress || null);
          setFetchedAt(lab.lastSyncAt ? new Date(lab.lastSyncAt).getTime() : Date.now());
          if (status.refreshStatus !== "running") {
            if (status.refreshStatus === "error") setError(formatEmrError(status.refreshError || "HIS refresh failed"));
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (e) {
        setError(formatEmrError(e.message));
      } finally {
        if (!silent) setLoadingEmr(false);
        setProgress(null);
      }
    },
    [date, applyOrders]
  );

  useEffect(() => {
    ordersRef.current = [];
    setChangedIds(new Set());
    loadFromServer();
  }, [loadFromServer]);

  // Re-read the saved board (Master Settings → refresh seconds) so queue / WhatsApp changes show quickly.
  useEffect(() => {
    if (loadingEmr) return undefined;
    const id = setInterval(() => !document.hidden && loadFromServer({ quiet: true }), Math.max(10, refreshSeconds) * 1000);
    return () => clearInterval(id);
  }, [loadFromServer, loadingEmr, refreshSeconds]);

  // A light pull from HIS so new / changed orders appear without pressing Refresh.
  useEffect(() => {
    if (loadingEmr || !isToday) return undefined;
    async function softPull() {
      if (document.hidden || softBusy.current) return;
      softBusy.current = true;
      try {
        await api.softHisBoardRefresh({ date });
        await loadFromServer({ quiet: true });
      } catch {
        // keep the board as it is; the next tick retries
      } finally {
        softBusy.current = false;
      }
    }
    const every = setInterval(softPull, 90_000);
    const first = setTimeout(softPull, 15_000);
    return () => {
      clearInterval(every);
      clearTimeout(first);
    };
  }, [date, isToday, loadFromServer, loadingEmr]);

  useEffect(() => () => clearTimeout(highlightTimer.current), []);

  useEffect(() => {
    api.stats().then(setStats).catch(() => {});
  }, []);

  // Off / Test / Live for the WhatsApp buttons (WATI Settings → Delivery); re-read now and then.
  useEffect(() => {
    if (!canSend) return undefined;
    const read = () => api.watiDelivery().then(setDelivery).catch(() => {});
    read();
    const id = setInterval(() => !document.hidden && read(), 60_000);
    return () => clearInterval(id);
  }, [canSend]);

  // "/" jumps to the search box, as in the portal.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function changeDate(next) {
    setDate(next);
    track("date_change", { screen: "reports", details: { date: next } });
  }

  async function syncQueue() {
    setError("");
    setSyncing(true);
    try {
      const r = await api.pollEmr({ from: date, to: date });
      showToast(`Queue for ${humanDay(date)}: ${r.created ?? 0} added, ${r.updated ?? 0} updated, ${r.skipped ?? 0} skipped`);
      await refreshFromHis({ silent: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  const showLoading = loadingCache && !allOrders.length;

  return (
    <div className="discharge-reports-page op-board">
      <Toast toast={toast} onDismiss={hideToast} />

      <PageHeader
        title={isToday ? "Today's OP lab reports" : `OP lab reports · ${humanDay(date)}`}
        lead="Every OP lab order in HIS for the day — how far the results are, whether the report is ready, and where its WhatsApp message stands."
      />

      <BoardStatus
        fetchedAt={fetchedAt}
        loadingEmr={loadingEmr}
        progress={progress}
        summary={summary}
        stats={stats}
        canSend={canSend}
        onRefresh={() => refreshFromHis()}
        onSync={syncQueue}
        syncing={syncing}
      />

      <div className="reports-toolbar modern-toolbar op-toolbar">
        <div className="date-stepper-group">
          <button type="button" className="btn btn-stepper" onClick={() => changeDate(shiftDay(date, -1))} title="Previous day">
            <ChevronLeftIcon size={16} />
            <span className="hide-on-mobile">Prev</span>
          </button>
          <div className="toolbar-date-input-wrap">
            <CalendarIcon size={16} className="date-input-icon" />
            <input type="date" value={date} max={todayValue()} onChange={(e) => changeDate(e.target.value || todayValue())} className="toolbar-date-input" aria-label="Lab day" />
            <span className={`date-human-pill ${isToday ? "is-today" : ""}`}>{humanDay(date)}</span>
          </div>
          <button type="button" className="btn btn-stepper" onClick={() => changeDate(shiftDay(date, 1))} disabled={isToday} title="Next day">
            <span className="hide-on-mobile">Next</span>
            <ChevronRightIcon size={16} />
          </button>
          <button type="button" className={`btn btn-stepper-today ${isToday ? "active" : ""}`} onClick={() => changeDate(todayValue())}>
            Today
          </button>
        </div>

        <div className="in-table-filter">
          <SearchIcon size={16} className="filter-input-icon" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchField === "all" ? "Name, UHID, order, mobile, department, test… (press /)" : `Search ${searchFieldLabel.toLowerCase()}…`}
            className="filter-text-input"
            aria-label="Search orders"
          />
          {search && (
            <button type="button" className="filter-clear-btn" onClick={() => setSearch("")} title="Clear search">
              ×
            </button>
          )}
        </div>

        <select className="op-search-in" value={searchField} onChange={(e) => setSearchField(e.target.value)} aria-label="Search in">
          {SEARCH_FIELDS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.value === "all" ? "Search in: all fields" : `Search in: ${f.label}`}
            </option>
          ))}
        </select>

        <button type="button" className={`btn-layout-toggle op-filters-btn ${showAdvanced ? "active" : ""}`} aria-expanded={showAdvanced} aria-controls="his-adv-filters" onClick={() => setShowAdvanced((v) => !v)}>
          <FilterIcon size={16} />
          <span>Filters</span>
          {advancedCount ? <span className="cat-count-badge">{advancedCount}</span> : null}
        </button>
      </div>

      {showAdvanced && <AdvancedFilters value={advanced} options={filterOptions} onChange={setAdvanced} onReset={() => setAdvanced(EMPTY_ADVANCED)} />}

      {error && <div className={allOrders.length ? "op-warn" : "error"}>{error}</div>}

      {showLoading ? (
        <Loading>Loading the OP board…</Loading>
      ) : allOrders.length === 0 ? (
        <Empty title={`No OP lab orders for ${humanDay(date)}`}>
          {canSend ? "Press Refresh from HIS to load this day." : "Orders appear here as HIS is checked during the day."}
        </Empty>
      ) : (
        <div className="results-container">
          <div className="category-filter-chips no-print">
            {STATUS_FILTERS.map((f) => (
              <button key={f.value} type="button" className={`cat-chip ${filter === f.value ? "active" : ""}`} onClick={() => setFilter(f.value)}>
                <span>{f.label}</span>
                <span className="cat-count-badge">{statusCounts[f.value]}</span>
              </button>
            ))}
          </div>

          <ActiveFilters chips={activeChips} onClearAll={clearAllFilters} />

          <div className="results-meta-bar">
            <div className="result-count-badge">
              <strong>{filteredOrders.length}</strong> {filteredOrders.length === 1 ? "order" : "orders"}
              {filteredOrders.length !== allOrders.length && <span className="text-muted"> (of {allOrders.length})</span>}
            </div>
            <div className="meta-size-pill-wrap no-print">
              <span className="meta-size-label">Rows:</span>
              {PAGE_SIZES.map((n) => (
                <button key={n} type="button" className={`meta-size-btn ${pageSize === n ? "active" : ""}`} onClick={() => setPageSize(n)}>
                  {n === "all" ? "All" : n}
                </button>
              ))}
            </div>
          </div>

          {filteredOrders.length === 0 ? (
            <Empty
              icon="🔍"
              title="No orders match these filters"
              actions={
                <button type="button" className="btn btn-secondary" onClick={clearAllFilters}>
                  Clear filters
                </button>
              }
            />
          ) : (
            <>
              <BoardTable
                orders={shownOrders}
                changedIds={changedIds}
                onPreview={setPreviewOrder}
                onToast={showToast}
                canSend={canSend}
                delivery={delivery}
                canChangeMode={canChangeMode}
                onSent={(message) => {
                  showToast(message);
                  loadFromServer({ quiet: true });
                }}
              />
              {shownOrders.length < filteredOrders.length && (
                <button type="button" className="btn btn-secondary op-more" onClick={() => setPageSize("all")}>
                  Show all {filteredOrders.length} orders
                </button>
              )}
            </>
          )}
        </div>
      )}

      <PdfPreviewModal order={previewOrder} onClose={() => setPreviewOrder(null)} canRefresh={canSend} />
    </div>
  );
}
