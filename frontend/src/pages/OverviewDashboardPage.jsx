import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { formatEmrError } from "../lib/emrErrors.js";

const QUICK_LINKS = [
  {
    to: "/his-lab-today",
    title: "HIS Lab Today",
    body: "Live board from EMR — sync ready reports to the queue.",
    tag: "EMR",
  },
  {
    to: "/lab-search",
    title: "Lab report search",
    body: "Find past reports by date and add one order at a time.",
    tag: "Search",
  },
  {
    to: "/reports",
    title: "WhatsApp Queue",
    body: "Send pending lab reports manually or in bulk.",
    tag: "Send",
  },
  {
    to: "/settings",
    title: "Settings",
    body: "Automation, test mode, and delivery rules.",
    tag: "System",
  },
];

const STAT_TONES = {
  total: "orders",
  ready: "ready",
  partial: "partial",
  approved: "approved",
  synced: "synced",
  pending: "pending",
  sent: "sent",
  failed: "failed",
};

function todayValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDayLabel(value) {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatScopeDate(value) {
  if (!value) return "Today";
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function StatBlock({ label, value, hint, tone = "orders", to, loading }) {
  const content = (
    <>
      <h3>{label}</h3>
      <div className="value" aria-live="polite">
        {loading ? <span className="dashboard-skeleton-value" /> : (value ?? "—")}
      </div>
      {hint ? <p className="stat-hint">{hint}</p> : null}
    </>
  );

  const className = `stat-card stat-card--${STAT_TONES[tone] || tone}${to ? " stat-card--link" : ""}`;

  if (to) {
    return (
      <Link to={to} className={className}>
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}

function StatSkeletonGrid({ count = 4, columns = 4 }) {
  return (
    <div className={`cards dashboard-stat-grid dashboard-stat-grid--${columns}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="stat-card stat-card--skeleton" aria-hidden>
          <div className="dashboard-skeleton-line dashboard-skeleton-line--sm" />
          <div className="dashboard-skeleton-line dashboard-skeleton-line--lg" />
        </div>
      ))}
    </div>
  );
}

export default function OverviewDashboardPage() {
  const [scope, setScope] = useState("today");
  const [date, setDate] = useState(todayValue());
  const [stats, setStats] = useState(null);
  const [his, setHis] = useState(null);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");
  const [hisError, setHisError] = useState("");
  const [loading, setLoading] = useState(true);
  const [hisLoading, setHisLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const activeDate = scope === "today" ? todayValue() : scope === "day" ? date : null;

  const loadQueueStats = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params =
        scope === "overall"
          ? { scope: "overall" }
          : { scope: "day", date: scope === "today" ? todayValue() : date };
      const [statsData, healthData] = await Promise.all([
        api.stats(params),
        api.health().catch(() => null),
      ]);
      setStats(statsData);
      setHealth(healthData);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [scope, date]);

  const loadHisStats = useCallback(async () => {
    if (scope === "overall" || !activeDate) {
      setHis(null);
      setHisError("");
      return;
    }
    setHisLoading(true);
    setHisError("");
    try {
      const hisData = await api.hisDayStats(activeDate);
      setHis(hisData);
    } catch (e) {
      setHis(null);
      setHisError(formatEmrError(e.message));
    } finally {
      setHisLoading(false);
    }
  }, [scope, activeDate]);

  useEffect(() => {
    loadQueueStats();
  }, [loadQueueStats]);

  useEffect(() => {
    loadHisStats();
  }, [loadHisStats]);

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([loadQueueStats(), loadHisStats()]);
    setRefreshing(false);
  }

  const queue = stats?.queue || {};
  const scopeLabel =
    scope === "overall" ? "All time" : scope === "today" ? "Today" : formatDayLabel(activeDate);
  const hisTotal = hisLoading ? null : his?.total ?? 0;
  const queueTotal = loading ? null : queue.total ?? 0;
  const showSyncGap =
    scope !== "overall" &&
    !hisLoading &&
    !loading &&
    hisTotal > 0 &&
    queueTotal === 0;

  return (
    <div className="dashboard-page">
      <header className="dashboard-hero">
        <div className="dashboard-hero__copy">
          <p className="dashboard-hero__eyebrow">Operations overview</p>
          <h1 className="dashboard-hero__title">
            {scope === "overall" ? "All synced reports" : formatScopeDate(activeDate)}
          </h1>
          <p className="dashboard-hero__lead">
            EMR lab volume vs reports in your WhatsApp queue. Nothing sends from this screen.
          </p>
        </div>
        <div className="dashboard-hero__metrics">
          {scope !== "overall" ? (
            <div className="dashboard-hero-metric dashboard-hero-metric--emr">
              <span className="dashboard-hero-metric__label">HIS orders</span>
              <span className="dashboard-hero-metric__value">
                {hisLoading ? "…" : (his?.total ?? "—")}
              </span>
              <span className="dashboard-hero-metric__source">Live from EMR</span>
            </div>
          ) : null}
          <div className="dashboard-hero-metric dashboard-hero-metric--queue">
            <span className="dashboard-hero-metric__label">In app queue</span>
            <span className="dashboard-hero-metric__value">
              {loading ? "…" : (queue.total ?? "—")}
            </span>
            <span className="dashboard-hero-metric__source">From MongoDB</span>
          </div>
          <div className="dashboard-hero-metric dashboard-hero-metric--sent">
            <span className="dashboard-hero-metric__label">Sent</span>
            <span className="dashboard-hero-metric__value">
              {loading ? "…" : (queue.sent ?? "—")}
            </span>
            <span className="dashboard-hero-metric__source">WhatsApp delivered</span>
          </div>
        </div>
      </header>

      {error ? <p className="error" role="alert">{error}</p> : null}

      <div className="dashboard-toolbar panel">
        <div className="dashboard-toolbar__row">
          <div className="filter-pills" role="tablist" aria-label="Date scope">
            <button
              type="button"
              role="tab"
              aria-selected={scope === "today"}
              className={`filter-pill${scope === "today" ? " is-active" : ""}`}
              onClick={() => setScope("today")}
            >
              Today
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === "day"}
              className={`filter-pill${scope === "day" ? " is-active" : ""}`}
              onClick={() => setScope("day")}
            >
              Pick date
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === "overall"}
              className={`filter-pill${scope === "overall" ? " is-active" : ""}`}
              onClick={() => setScope("overall")}
            >
              Overall
            </button>
          </div>
          {scope === "day" ? (
            <label className="field-label dashboard-date-field">
              <span className="sr-only">Lab day</span>
              <input
                type="date"
                value={date}
                max={todayValue()}
                onChange={(e) => setDate(e.target.value || todayValue())}
              />
            </label>
          ) : null}
          <button
            className="secondary dashboard-toolbar__refresh"
            type="button"
            disabled={refreshing || loading || hisLoading}
            onClick={handleRefresh}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {showSyncGap ? (
        <div className="dashboard-sync-alert" role="status">
          <strong>{hisTotal} HIS orders</strong> for this day, but{" "}
          <strong>none synced to the queue yet</strong>. Open{" "}
          <Link to="/his-lab-today">HIS Lab Today</Link> and use <em>Sync to queue</em>, or add
          reports from <Link to="/lab-search">Lab report search</Link>.
        </div>
      ) : null}

      <div className="dashboard-panels">
        {scope !== "overall" ? (
          <section className="dashboard-panel dashboard-panel--emr" aria-labelledby="his-panel-title">
            <div className="dashboard-panel__head">
              <div>
                <span className="dashboard-source-badge dashboard-source-badge--emr">EMR</span>
                <h2 id="his-panel-title" className="dashboard-panel__title">
                  Hospital lab board
                </h2>
                <p className="dashboard-panel__sub">
                  {hisLoading
                    ? "Fetching from HIS — busy days may take 1–2 minutes…"
                    : "All orders registered in EMR for this lab day"}
                </p>
              </div>
              <Link to="/his-lab-today" className="dashboard-panel__action">
                Open board →
              </Link>
            </div>
            {hisError ? <p className="warn-banner">{hisError}</p> : null}
            {hisLoading ? (
              <StatSkeletonGrid count={4} columns={4} />
            ) : (
              <div className="cards dashboard-stat-grid dashboard-stat-grid--4">
                <StatBlock
                  label="Total orders"
                  value={his?.total}
                  hint="Every lab order in EMR"
                  tone="total"
                />
                <StatBlock
                  label="Ready to send"
                  value={his?.ready}
                  hint="All tests approved"
                  tone="ready"
                />
                <StatBlock
                  label="Partial"
                  value={his?.partial}
                  hint="Some tests still pending"
                  tone="partial"
                />
                <StatBlock
                  label="Result approved"
                  value={his?.approved}
                  hint="At least one approved test"
                  tone="approved"
                />
              </div>
            )}
          </section>
        ) : null}

        <section
          className="dashboard-panel dashboard-panel--wa"
          aria-labelledby="queue-panel-title"
        >
          <div className="dashboard-panel__head">
            <div>
              <span className="dashboard-source-badge dashboard-source-badge--db">MongoDB</span>
              <h2 id="queue-panel-title" className="dashboard-panel__title">
                WhatsApp queue · {scopeLabel}
              </h2>
              <p className="dashboard-panel__sub">
                Reports synced into this app — send from the queue when ready
              </p>
            </div>
            <Link to="/reports" className="dashboard-panel__action">
              Open queue →
            </Link>
          </div>
          {loading ? (
            <StatSkeletonGrid count={5} columns={5} />
          ) : (
            <div className="cards dashboard-stat-grid dashboard-stat-grid--5">
              <StatBlock
                label="Synced"
                value={queue.total}
                hint="Added to app queue"
                tone="synced"
                to="/reports"
              />
              <StatBlock
                label="Ready"
                value={queue.ready}
                hint="Fully approved"
                tone="ready"
                to="/reports"
              />
              <StatBlock
                label="Pending"
                value={queue.pending}
                hint="Waiting to send"
                tone="pending"
                to="/reports"
              />
              <StatBlock
                label="Sent"
                value={queue.sent}
                hint={scope === "overall" ? "All time" : "This lab day"}
                tone="sent"
                to="/messages"
              />
              <StatBlock
                label="Failed"
                value={queue.failed}
                hint="Retry from queue"
                tone="failed"
                to="/reports"
              />
            </div>
          )}
        </section>
      </div>

      {scope === "overall" && stats?.queueDay ? (
        <section className="dashboard-panel dashboard-panel--compact">
          <h2 className="dashboard-panel__title">Today snapshot</h2>
          <div className="cards cards--compact dashboard-stat-grid dashboard-stat-grid--3">
            <StatBlock label="Synced today" value={stats.queueDay?.total} tone="synced" />
            <StatBlock label="Pending today" value={stats.queueDay?.pending} tone="pending" />
            <StatBlock label="Sent today" value={stats.queueDay?.sent} tone="sent" />
          </div>
        </section>
      ) : null}

      <section className="dashboard-panel">
        <div className="dashboard-panel__head">
          <div>
            <h2 className="dashboard-panel__title">Day-wise queue</h2>
            <p className="dashboard-panel__sub">
              Click a lab day to drill down — {stats?.byDay?.length || 0} days in the app
            </p>
          </div>
        </div>
        <div className="table-wrap dashboard-table-wrap">
          <table className="dashboard-day-table">
            <thead>
              <tr>
                <th>Lab day</th>
                <th>Synced</th>
                <th className="col-ready">Ready</th>
                <th className="col-partial">Partial</th>
                <th className="col-pending">Pending</th>
                <th className="col-sent">Sent</th>
                <th className="col-failed">Failed</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.byDay || []).length ? (
                stats.byDay.map((row) => (
                  <tr
                    key={row.date}
                    className={row.date === activeDate ? "dashboard-day-row--active" : ""}
                  >
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => {
                          setScope("day");
                          setDate(row.date);
                        }}
                      >
                        {formatDayLabel(row.date)}
                      </button>
                    </td>
                    <td>{row.total}</td>
                    <td className="col-ready">{row.ready}</td>
                    <td className="col-partial">{row.partial}</td>
                    <td className="col-pending">{row.pending}</td>
                    <td className="col-sent">{row.sent}</td>
                    <td className="col-failed">{row.failed}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="dashboard-table-empty">
                    {loading ? "Loading queue history…" : "No synced reports yet"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="dashboard-footer">
        <div className="dashboard-system-strip">
          <span className={`dashboard-system-dot ${health?.wati?.ok ? "ok" : "bad"}`} />
          <span>WATI {health?.wati?.ok ? "connected" : "offline"}</span>
          <span className="dashboard-system-sep">·</span>
          <span>Send {health?.watiSendEnabled ? "enabled" : "disabled"}</span>
          <span className="dashboard-system-sep">·</span>
          <span>Test {stats?.watiTestSendMode ? "on" : "off"}</span>
          <span className="dashboard-system-sep">·</span>
          <span>Automation {stats?.automationEnabled ? "on" : "off"}</span>
        </div>

        <div className="dashboard-quick-grid">
          {QUICK_LINKS.map((item) => (
            <Link key={item.to} to={item.to} className="dashboard-quick-card">
              <span className="dashboard-quick-card__tag">{item.tag}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <span className="dashboard-quick-card__arrow" aria-hidden>
                →
              </span>
            </Link>
          ))}
        </div>
      </footer>
    </div>
  );
}
