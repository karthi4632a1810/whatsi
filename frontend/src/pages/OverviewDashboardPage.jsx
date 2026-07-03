import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import PageHeader from "../components/PageHeader.jsx";
import { formatEmrError } from "../lib/emrErrors.js";

const QUICK_LINKS = [
  {
    to: "/his-lab-today",
    title: "HIS Lab Today",
    body: "Live lab board from EMR for today or a selected date.",
  },
  {
    to: "/lab-search",
    title: "Lab report search",
    body: "Search previous reports by date range and add to queue manually.",
  },
  {
    to: "/reports",
    title: "WhatsApp Queue",
    body: "Pending reports ready to send — manual or scheduled delivery.",
  },
  {
    to: "/settings",
    title: "Settings",
    body: "Automation, test send mode, templates, and delivery rules.",
  },
];

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

function StatBlock({ label, value, hint }) {
  return (
    <div className="stat-card">
      <h3>{label}</h3>
      <div className="value">{value ?? "—"}</div>
      {hint ? <p className="stat-hint">{hint}</p> : null}
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

  const queue = stats?.queue || {};
  const scopeLabel =
    scope === "overall" ? "Overall" : scope === "today" ? "Today" : formatDayLabel(activeDate);

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        lead="HIS lab totals, queue status, and day-wise breakdown. Nothing sends automatically from here."
      />

      {error ? <p className="error" role="alert">{error}</p> : null}

      <div className="panel dashboard-scope-panel">
        <div className="toolbar-row">
          <div className="filter-pills">
            <button
              type="button"
              className={`filter-pill${scope === "today" ? " is-active" : ""}`}
              onClick={() => setScope("today")}
            >
              Today
            </button>
            <button
              type="button"
              className={`filter-pill${scope === "day" ? " is-active" : ""}`}
              onClick={() => setScope("day")}
            >
              Pick date
            </button>
            <button
              type="button"
              className={`filter-pill${scope === "overall" ? " is-active" : ""}`}
              onClick={() => setScope("overall")}
            >
              Overall
            </button>
          </div>
          {scope === "day" ? (
            <label className="field-label">
              Date
              <input
                type="date"
                value={date}
                max={todayValue()}
                onChange={(e) => setDate(e.target.value || todayValue())}
              />
            </label>
          ) : null}
          <button className="secondary" type="button" onClick={() => { loadQueueStats(); loadHisStats(); }}>
            Refresh
          </button>
        </div>
        <p className="muted dashboard-scope-note">
          Showing <strong>{scopeLabel}</strong>
          {scope === "overall"
            ? " — all synced reports in the app"
            : " — HIS from EMR + WhatsApp queue for that lab day"}
        </p>
      </div>

      {scope !== "overall" ? (
        <section className="dashboard-section">
          <h2 className="dashboard-section-title">HIS lab · {scopeLabel}</h2>
          {hisError ? <p className="warn-banner">{hisError}</p> : null}
          <div className="cards">
            <StatBlock
              label="Total HIS orders"
              value={hisLoading ? "…" : his?.total}
              hint="All lab orders from EMR for this day"
            />
            <StatBlock
              label="Ready to send"
              value={hisLoading ? "…" : his?.ready}
              hint="All tests approved"
            />
            <StatBlock
              label="Partial"
              value={hisLoading ? "…" : his?.partial}
              hint="Some tests still pending"
            />
            <StatBlock
              label="Result approved"
              value={hisLoading ? "…" : his?.approved}
              hint="At least one approved test"
            />
          </div>
          {hisLoading ? (
            <p className="muted">Loading HIS from EMR — may take 1–2 min for busy days…</p>
          ) : null}
        </section>
      ) : null}

      <section className="dashboard-section">
        <h2 className="dashboard-section-title">
          WhatsApp queue · {scopeLabel}
        </h2>
        <div className="cards">
          <StatBlock
            label="Synced to queue"
            value={loading ? "…" : queue.total}
            hint="Reports added to the app queue"
          />
          <StatBlock
            label="Ready"
            value={loading ? "…" : queue.ready}
            hint="Fully approved in queue"
          />
          <StatBlock
            label="In queue (pending)"
            value={loading ? "…" : queue.pending}
            hint="Waiting to send"
          />
          <StatBlock
            label="Sent"
            value={loading ? "…" : queue.sent}
            hint={scope === "overall" ? "All time in app" : "Sent for this lab day"}
          />
          <StatBlock
            label="Failed"
            value={loading ? "…" : queue.failed}
            hint="Send failed — retry from queue"
          />
        </div>
      </section>

      {scope === "overall" && stats?.queueOverall ? (
        <section className="dashboard-section">
          <h2 className="dashboard-section-title">Today snapshot</h2>
          <div className="cards cards--compact">
            <StatBlock label="Queue today" value={stats.queueDay?.total} />
            <StatBlock label="Pending today" value={stats.queueDay?.pending} />
            <StatBlock label="Sent today" value={stats.queueDay?.sent} />
          </div>
        </section>
      ) : null}

      <section className="dashboard-section">
        <h2 className="dashboard-section-title">Day-wise queue</h2>
        <p className="muted dashboard-section-lead">
          Synced reports grouped by lab day — last {stats?.byDay?.length || 0} days in the app.
        </p>
        <div className="table-wrap">
          <table className="dashboard-day-table">
            <thead>
              <tr>
                <th>Lab day</th>
                <th>Synced</th>
                <th>Ready</th>
                <th>Partial</th>
                <th>In queue</th>
                <th>Sent</th>
                <th>Failed</th>
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
                    <td>{row.ready}</td>
                    <td>{row.partial}</td>
                    <td>{row.pending}</td>
                    <td>{row.sent}</td>
                    <td>{row.failed}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="muted">
                    {loading ? "Loading…" : "No synced reports yet"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3 className="panel-title">System</h3>
        <div className="status-pills">
          <span className={`status-pill ${health?.wati?.ok ? "ok" : "bad"}`}>
            WATI {health?.wati?.ok ? "connected" : "error"}
          </span>
          <span className={`status-pill ${health?.watiSendEnabled ? "warn" : "ok"}`}>
            Send {health?.watiSendEnabled ? "enabled" : "disabled (safe)"}
          </span>
          <span className={`status-pill ${stats?.watiTestSendMode ? "warn" : "neutral"}`}>
            Test mode {stats?.watiTestSendMode ? "on" : "off"}
          </span>
          <span className={`status-pill ${stats?.automationEnabled ? "ok" : "neutral"}`}>
            Automation {stats?.automationEnabled ? "on" : "off"}
          </span>
          <span className={`status-pill ${health?.emrPollEnabled ? "ok" : "neutral"}`}>
            EMR poll {health?.emrPollEnabled ? "on" : "off"}
          </span>
        </div>
      </div>

      <div className="dashboard-links">
        {QUICK_LINKS.map((item) => (
          <Link key={item.to} to={item.to} className="dashboard-link-card">
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
