import { useEffect, useState } from "react";
import { api } from "../api.js";
import PageHeader from "../components/PageHeader.jsx";
import { cacheStatusLabel } from "../lib/watiCache.js";

export default function WatiOverviewPage() {
  const [data, setData] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [contactsMeta, setContactsMeta] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactsRefreshing, setContactsRefreshing] = useState(false);

  useEffect(() => {
    api.watiOverview()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    loadContacts(false);
  }, []);

  async function loadContacts(refresh = false) {
    if (refresh) setContactsRefreshing(true);
    else setContactsLoading(true);
    try {
      const contactData = await api.watiContacts({ refresh });
      setContacts(contactData.contacts || []);
      setContactsMeta(contactData);
    } catch {
      setContacts([]);
    } finally {
      setContactsLoading(false);
      setContactsRefreshing(false);
    }
  }

  if (loading) return <p className="muted panel-loading">Loading WATI overview…</p>;

  return (
    <div>
      <PageHeader
        eyebrow="WATI connection"
        title="WATI overview"
        lead="Live send stats from MongoDB — failed reports stay queued for retry on the next day."
      />

      {error ? <p className="error" role="alert">{error}</p> : null}

      <div className="cards">
        <div className="stat-card stat-card--sent">
          <h3>Sent today</h3>
          <div className="value">{data?.today?.sent ?? "—"}</div>
        </div>
        <div className="stat-card stat-card--orders">
          <h3>Failed today</h3>
          <div className="value">{data?.today?.failed ?? "—"}</div>
        </div>
        <div className="stat-card stat-card--ready">
          <h3>Pending queue</h3>
          <div className="value">{data?.allTime?.pending ?? "—"}</div>
        </div>
        <div className="stat-card stat-card--approved">
          <h3>Failed backlog</h3>
          <div className="value">{data?.allTime?.failed ?? "—"}</div>
        </div>
      </div>

      <div className="settings-grid">
        <section className="panel settings-section">
          <h3 className="panel-title">Connection</h3>
          <div className="status-pills">
            <span className={`status-pill ${data?.connection?.ok ? "ok" : "bad"}`}>
              WATI {data?.connection?.ok ? "connected" : "error"}
            </span>
            {data?.connection?.error ? (
              <span className="status-pill bad" title={data.connection.error}>
                {data.connection.error}
              </span>
            ) : null}
            <span className={`status-pill ${data?.config?.sendEnabled ? "warn" : "ok"}`}>
              Send {data?.config?.sendEnabled ? "enabled" : "disabled (safe)"}
            </span>
            <span className="status-pill neutral">
              Templates remote: {data?.connection?.templateCount ?? 0}
            </span>
            {data?.today?.successRate != null ? (
              <span className="status-pill ok">Today success {data.today.successRate}%</span>
            ) : null}
          </div>
        </section>

        <section className="panel settings-section">
          <h3 className="panel-title">Pending by day</h3>
          {data?.backlogByDay?.length ? (
            <div className="table-wrap table-wrap--short">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Report day</th>
                    <th>Pending / failed</th>
                  </tr>
                </thead>
                <tbody>
                  {data.backlogByDay.map((row) => (
                    <tr key={row.day}>
                      <td className="td-mono">{row.day}</td>
                      <td>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No cross-day backlog — all caught up.</p>
          )}
        </section>
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="toolbar-row">
          <div>
            <h3 className="panel-title" style={{ marginBottom: 4 }}>WATI contacts</h3>
            <p className="field-hint" style={{ margin: 0 }}>
              Cached locally to save API calls — refresh only when you add new test contacts.
              {cacheStatusLabel(contactsMeta) ? (
                <> · <strong>{cacheStatusLabel(contactsMeta)}</strong></>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            className="secondary btn-sm"
            disabled={contactsLoading || contactsRefreshing}
            onClick={() => loadContacts(true)}
          >
            {contactsRefreshing ? "Refreshing…" : "Refresh from WATI"}
          </button>
        </div>
        {contactsLoading ? (
          <p className="muted">Loading contacts…</p>
        ) : contacts.length ? (
          <div className="table-wrap table-wrap--short">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>WhatsApp</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id || c.phone}>
                    <td>{c.name}</td>
                    <td className="td-mono">{c.phone}</td>
                    <td>{c.contactStatus || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No contacts returned from WATI.</p>
        )}
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <h3 className="panel-title">Daily send history</h3>
        {data?.daily?.length ? (
          <div className="table-wrap table-wrap--short">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Sent</th>
                  <th>Failed</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {data.daily.map((row) => (
                  <tr key={row.day}>
                    <td className="td-mono">{row.day}</td>
                    <td>{row.sent}</td>
                    <td>{row.failed}</td>
                    <td>{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No messages logged yet.</p>
        )}
      </div>
    </div>
  );
}
