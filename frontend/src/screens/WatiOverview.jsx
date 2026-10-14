import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { cacheStatusLabel } from "../lib/watiCache.js";
import { displayPhone } from "../lib/phone.js";
import { AlertIcon, WhatsAppIcon } from "../portal/Icons.jsx";
import { Loading, Pill } from "./ui.jsx";

const dmy = (iso) => String(iso || "").split("-").reverse().join("-");

/** WATI Settings → Overview: is WATI connected, how much is sent, what's waiting, API quota. */
export default function WatiOverview() {
  const [data, setData] = useState(null);
  const [contacts, setContacts] = useState({ list: [], meta: null, loading: true });
  const [error, setError] = useState("");
  const [delivery, setDelivery] = useState(null);

  useEffect(() => {
    api
      .watiOverview()
      .then(setData)
      .catch((e) => setError(e.message));
    api
      .watiContacts()
      .then((d) => setContacts({ list: d.contacts || [], meta: d, loading: false }))
      .catch(() => setContacts({ list: [], meta: null, loading: false }));
    api.watiDelivery().then(setDelivery).catch(() => {});
  }, []);

  if (!data && !error) return <Loading>Loading the WATI overview…</Loading>;

  const mode = delivery?.mode;
  const sendOn = mode === "live";
  const usage = data?.apiUsage;

  return (
    <div className="search-view-container wati-page">
      <header className="wati-hero">
        <div className="wati-hero-icon">
          <WhatsAppIcon size={24} />
        </div>
        <div className="wati-hero-text">
          <h2>WhatsApp delivery</h2>
          <p>OP lab reports go to patients on WhatsApp through WATI, with the approved template. Failed reports stay queued for retry.</p>
        </div>
        <Link to="/wati" className={`wati-mode-pill ${mode === "live" ? "is-live" : mode === "test" ? "is-test" : "is-off"}`} title="Change on the Delivery tab">
          <span className="wati-mode-dot" />
          {mode === "live" ? "Live — sending to patients" : mode === "test" ? "Test — only your test number" : "Off — nothing is sent"}
        </Link>
      </header>

      {error && (
        <div className="lock-error wati-error" role="alert">
          <AlertIcon size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="um-stats op-stats-5">
        <div className="um-stat">
          <b>{data?.today?.sent ?? "—"}</b>
          <span>Sent today</span>
        </div>
        <div className="um-stat">
          <b>{data?.today?.failed ?? "—"}</b>
          <span>Failed today</span>
        </div>
        <div className="um-stat">
          <b>{data?.allTime?.pending ?? "—"}</b>
          <span>Waiting to send</span>
        </div>
        <div className="um-stat">
          <b>{data?.allTime?.failed ?? "—"}</b>
          <span>Failed backlog</span>
        </div>
        <div className="um-stat">
          <b>{usage?.limit ? `${usage.calls ?? 0} / ${usage.limit}` : usage?.calls ?? "—"}</b>
          <span>{usage?.limit ? `WATI API this month · ${usage.percentUsed ?? 0}% used` : `Sends this month (${usage?.period || "—"})`}</span>
        </div>
      </div>

      <div className="wati-grid">
        <div className="wati-col">
          <section className="wati-panel">
            <div className="wati-panel-head">
              <div>
                <h3>Connection</h3>
                <p>WATI is only called when a report is sent or its ticks are checked.</p>
              </div>
            </div>
            <div className="op-pill-row">
              <Pill tone={data?.connection?.ok ? "ok" : "bad"}>WATI {data?.connection?.ok ? "configured" : "not configured"}</Pill>
              {data?.connection?.error ? <Pill tone="bad" title={data.connection.error}>{data.connection.error}</Pill> : null}
              <Pill tone={sendOn ? "wa" : "muted"}>Delivery {mode || "—"}</Pill>
              {data?.today?.successRate != null ? <Pill tone="ok">Today {data.today.successRate}% delivered to WATI</Pill> : null}
            </div>
          </section>

          <section className="wati-panel">
            <div className="wati-panel-head">
              <div>
                <h3>Daily send history</h3>
                <p>Messages handed to WATI per day.</p>
              </div>
            </div>
            {data?.daily?.length ? (
              <div className="table-wrap modern-table-wrap">
                <table className="results modern-results-table">
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
                        <td>{dmy(row.day)}</td>
                        <td>{row.sent}</td>
                        <td>{row.failed}</td>
                        <td>{row.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="wati-hint">No messages logged yet.</p>
            )}
          </section>
        </div>

        <div className="wati-col">
          <section className="wati-panel">
            <div className="wati-panel-head">
              <div>
                <h3>Waiting by lab day</h3>
                <p>Pending and failed reports, per day.</p>
              </div>
            </div>
            {data?.backlogByDay?.length ? (
              <ul className="op-day-list">
                {data.backlogByDay.map((row) => (
                  <li key={row.day}>
                    <span>{dmy(row.day)}</span>
                    <b>{row.count}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="wati-hint">Nothing waiting — all caught up.</p>
            )}
          </section>

          <section className="wati-panel">
            <div className="wati-panel-head">
              <div>
                <h3>Test contacts</h3>
                <p>
                  Used in test mode; add them on the Delivery tab.
                  {cacheStatusLabel(contacts.meta) ? ` ${cacheStatusLabel(contacts.meta)}.` : ""}
                </p>
              </div>
            </div>
            {contacts.loading ? (
              <p className="wati-hint">Loading…</p>
            ) : contacts.list.length ? (
              <ul className="op-day-list">
                {contacts.list.map((c) => (
                  <li key={c.id || c.phone}>
                    <span>{c.name}</span>
                    <b>{displayPhone(c.phone)}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="wati-hint">No test contacts saved.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
