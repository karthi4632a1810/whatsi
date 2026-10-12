import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, downloadAuditLog } from '../api.js';
import { initials } from './access';
import { RefreshIcon, SearchIcon, ShieldCheckIcon } from './Icons';
import '../monitor/monitor.css';

const CATEGORY = {
  auth: { label: 'Sign-in', color: '#2563eb' },
  screen: { label: 'Screens', color: '#64748b' },
  report: { label: 'Reports & PDFs', color: '#0d9488' },
  whatsapp: { label: 'WhatsApp', color: '#16a34a' },
  export: { label: 'Downloads', color: '#7c3aed' },
  settings: { label: 'Settings', color: '#ea580c' },
  users: { label: 'Users', color: '#b45309' },
  audit: { label: 'Audit', color: '#0b2956' },
  presence: { label: 'Tab & idle', color: '#94a3b8' },
};
const CATEGORY_ORDER = ['auth', 'screen', 'report', 'whatsapp', 'export', 'settings', 'users', 'audit', 'presence'];
const TABS = [
  ['timeline', 'Timeline'],
  ['people', 'People'],
  ['departments', 'Departments'],
  ['sessions', 'Sessions'],
];
const SCREEN_NAMES = { reports: 'OP Lab Reports', search: 'Lab Search', labFinder: 'Lab Finder', wati: 'WATI Settings', monitor: 'WhatsApp Monitor', users: 'Users', audit: 'Audit Log', settings: 'Settings' };
const PRESETS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
  ['custom', 'Custom'],
];
const PAGE = 100;

const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shiftDay = (day, n) => new Date(new Date(`${day}T12:00:00Z`).getTime() + n * 86400_000).toISOString().slice(0, 10);
function presetRange(id) {
  const t = istToday();
  if (id === 'yesterday') return { from: shiftDay(t, -1), to: shiftDay(t, -1) };
  if (id === '7d') return { from: shiftDay(t, -6), to: t };
  if (id === '30d') return { from: shiftDay(t, -29), to: t };
  return { from: t, to: t };
}

const fmtTime = (at) => new Date(at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
const fmtDateTime = (at) =>
  at ? new Date(at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
const fmtDay = (at) => new Date(at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
function fmtDur(ms) {
  const m = Math.round((ms || 0) / 60_000);
  if (!ms) return '—';
  if (m < 1) return '< 1 min';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function Person({ name, user, sub, onClick }) {
  return (
    <button type="button" className="al-person" onClick={onClick} title={onClick ? `Only ${name}` : undefined} disabled={!onClick}>
      <span className="al-avatar">{initials(name || user)}</span>
      <span className="al-person-text">
        <b>{name || user}</b>
        {sub && <small>{sub}</small>}
      </span>
    </button>
  );
}

function TimeSplit({ active, idle, hidden }) {
  const total = (active || 0) + (idle || 0) + (hidden || 0);
  if (!total) return <span className="al-muted">—</span>;
  const pct = (v) => `${((v || 0) / total) * 100}%`;
  return (
    <span className="al-split" title={`Active ${fmtDur(active)} · Idle ${fmtDur(idle)} · Away from tab ${fmtDur(hidden)}`}>
      <i className="is-active" style={{ width: pct(active) }} />
      <i className="is-idle" style={{ width: pct(idle) }} />
      <i className="is-hidden" style={{ width: pct(hidden) }} />
    </span>
  );
}

function EventRow({ e, onUser, onSession }) {
  const [open, setOpen] = useState(false);
  const cat = CATEGORY[e.category] || { color: '#64748b', label: e.category };
  const failed = e.details?.ok === false || e.action === 'login_failed';
  return (
    <li className={`al-event ${failed ? 'is-failed' : ''}`}>
      <button type="button" className="al-event-main" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="al-time">{fmtTime(e.at)}</span>
        <span className="al-dot" style={{ background: cat.color }} title={cat.label} />
        <span className="al-text">
          {e.text}
          <span className="al-meta">
            {e.target?.orderId && <em>Order {e.target.orderId}</em>}
            {e.target?.uhid && <em>UHID {e.target.uhid}</em>}
            {e.durationMs ? <em>{fmtDur(e.durationMs)}</em> : null}
          </span>
        </span>
      </button>
      <Person name={e.userName} user={e.user} sub={e.department} onClick={e.user ? () => onUser(e.user) : undefined} />
      {open && (
        <div className="al-details">
          <dl>
            <div><dt>When</dt><dd>{new Date(e.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</dd></div>
            <div><dt>Type</dt><dd>{cat.label} · {e.action}</dd></div>
            {e.screen && <div><dt>Screen</dt><dd>{SCREEN_NAMES[e.screen] || e.screen}</dd></div>}
            {e.target?.patientName && <div><dt>Patient</dt><dd>{e.target.patientName}</dd></div>}
            {e.device && <div><dt>Device</dt><dd>{e.device}</dd></div>}
            {e.ip && <div><dt>IP address</dt><dd>{e.ip}</dd></div>}
            {e.designation && <div><dt>Role</dt><dd>{e.designation}</dd></div>}
            {e.sessionId && (
              <div>
                <dt>Session</dt>
                <dd>
                  <button type="button" className="ai-link" onClick={() => onSession(e.sessionId)}>
                    Show this session
                  </button>
                </dd>
              </div>
            )}
            {e.details &&
              Object.entries(e.details).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{String(v)}</dd>
                  </div>
              ))}
          </dl>
        </div>
      )}
    </li>
  );
}

export default function AuditLog({ canExport = true }) {
  const [preset, setPreset] = useState('today');
  const [custom, setCustom] = useState(() => presetRange('7d'));
  const [user, setUser] = useState('');
  const [department, setDepartment] = useState('');
  const [categories, setCategories] = useState([]);
  const [presence, setPresence] = useState(false);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [session, setSession] = useState('');
  const [tab, setTab] = useState('timeline');
  const [options, setOptions] = useState({ users: [], departments: [] });
  const [summary, setSummary] = useState(null);
  const [events, setEvents] = useState({ items: [], total: 0 });
  const [limit, setLimit] = useState(PAGE);
  const [sessions, setSessions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState('');

  const range = preset === 'custom' ? custom : presetRange(preset);
  const params = useMemo(
    () => ({ from: range.from, to: range.to, user, department, category: categories, presence: presence ? 'show' : '', q, session }),
    [range.from, range.to, user, department, categories, presence, q, session],
  );

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    api.auditOptions().then(setOptions).catch(() => {});
  }, []);
  useEffect(() => setLimit(PAGE), [params]);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const [s, e] = await Promise.all([api.auditSummary(params), api.auditEvents({ ...params, limit })]);
        setSummary(s);
        setEvents(e);
        if (tab === 'sessions') setSessions((await api.auditSessions(params)).sessions);
        setError('');
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [params, limit, tab],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Live while looking at today.
  useEffect(() => {
    if (preset !== 'today') return undefined;
    const t = setInterval(() => !document.hidden && load(true), 30_000);
    return () => clearInterval(t);
  }, [preset, load]);

  const byDay = useMemo(() => {
    const groups = [];
    for (const e of events.items) {
      const day = fmtDay(e.at);
      if (!groups.length || groups[groups.length - 1].day !== day) groups.push({ day, items: [] });
      groups[groups.length - 1].items.push(e);
    }
    return groups;
  }, [events.items]);

  const t = summary?.tiles;
  const focusUser = (u) => {
    setUser(u);
    setTab('timeline');
  };
  const focusSession = (id) => {
    setSession(id);
    setTab('timeline');
  };
  const userLabel = options.users.find((u) => u.user === user)?.userName || user;

  async function download(format) {
    setDownloading(format);
    try {
      await downloadAuditLog(params);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading('');
    }
  }

  return (
    <div className="al-page wa-page">
      <header className="al-hero">
        <div className="al-hero-icon">
          <ShieldCheckIcon size={24} />
        </div>
        <div className="al-hero-text">
          <h2>Audit log</h2>
          <p>Every sign-in, screen, WhatsApp send, PDF, download and change: who, what and when.</p>
        </div>
        <div className="al-hero-actions">
          <button type="button" className="al-hero-btn" onClick={() => load()} disabled={loading}>
            <RefreshIcon size={15} spinning={loading} /> Refresh
          </button>
          {canExport && (
            <button type="button" className="al-hero-btn" onClick={() => download('csv')} disabled={Boolean(downloading)}>
              {downloading === 'csv' ? 'Preparing…' : 'Download CSV'}
            </button>
          )}
        </div>
      </header>

      <div className="wa-filters al-filters">
        <div className="wa-date-row">
          <div className="wa-presets" role="group" aria-label="Date range">
            {PRESETS.map(([id, label]) => (
              <button key={id} type="button" className={preset === id ? 'is-on' : ''} onClick={() => setPreset(id)}>
                {label}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="wa-custom">
              <input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} aria-label="From" />
              <span>to</span>
              <input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} aria-label="To" />
            </div>
          )}
          <select className="al-select" value={user} onChange={(e) => setUser(e.target.value)} aria-label="Person">
            <option value="">Everyone</option>
            {options.users.map((u) => (
              <option key={u.user} value={u.user}>
                {u.userName || u.user}
                {u.department && u.department !== '—' ? ` · ${u.department}` : ''}
              </option>
            ))}
          </select>
          <select className="al-select" value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Department">
            <option value="">All departments</option>
            {options.departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <label className="wa-search al-search">
            <SearchIcon size={15} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Patient, order, UHID, text…" />
          </label>
        </div>
        <div className="al-cats" role="group" aria-label="What">
          {CATEGORY_ORDER.filter((c) => c !== 'presence').map((c) => {
            const on = categories.includes(c);
            return (
              <button
                key={c}
                type="button"
                className={`wa-chip ${on ? 'is-on' : ''}`}
                aria-pressed={on}
                onClick={() => setCategories((cur) => (on ? cur.filter((x) => x !== c) : [...cur, c]))}
              >
                <span className="al-dot" style={{ background: CATEGORY[c].color }} />
                {CATEGORY[c].label}
              </button>
            );
          })}
          <label className="al-presence">
            <input type="checkbox" checked={presence} onChange={(e) => setPresence(e.target.checked)} />
            Show tab switches &amp; idle
          </label>
        </div>
        {(user || department || session || categories.length > 0 || q) && (
          <div className="al-active-filters">
            {user && <button type="button" className="wa-chip is-on" onClick={() => setUser('')}>{userLabel} ×</button>}
            {department && <button type="button" className="wa-chip is-on" onClick={() => setDepartment('')}>{department} ×</button>}
            {session && <button type="button" className="wa-chip is-on" onClick={() => setSession('')}>One session ×</button>}
            <button
              type="button"
              className="wa-clear"
              onClick={() => {
                setUser('');
                setDepartment('');
                setSession('');
                setCategories([]);
                setSearch('');
              }}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="lock-error wa-error" role="alert">
          <span>{error}</span>
        </div>
      )}

      {t && (
        <div className="al-tiles">
          <div className="al-tile"><b>{t.users}</b><span>People active</span></div>
          <div className="al-tile"><b>{t.sessions}</b><span>Sessions{t.activeNow ? ` · ${t.activeNow} online now` : ''}</span></div>
          <div className="al-tile"><b>{fmtDur(t.activeMs)}</b><span>Active time</span></div>
          <div className="al-tile"><b>{fmtDur(t.idleMs)}</b><span>Idle (5 min+ no input)</span></div>
          <div className="al-tile"><b>{fmtDur(t.hiddenMs)}</b><span>Away from the tab</span></div>
          <div className="al-tile"><b>{t.whatsappSends}</b><span>WhatsApp sends &amp; retries</span></div>
          <div className="al-tile"><b>{t.pdfs}</b><span>PDFs opened</span></div>
          <div className="al-tile"><b>{t.exports}</b><span>Downloads</span></div>
          <div className={`al-tile ${t.failedLogins ? 'is-bad' : ''}`}><b>{t.failedLogins}</b><span>Failed sign-ins</span></div>
        </div>
      )}

      <div className="al-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <section className="viz-card al-panel">
        {tab === 'timeline' && (
          <>
            <div className="al-count">
              {events.total} event{events.total === 1 ? '' : 's'}
              {!presence && ' (tab switches & idle hidden)'}
            </div>
            {byDay.length === 0 && <div className="al-empty">Nothing recorded for these filters.</div>}
            {byDay.map((g) => (
              <div key={g.day} className="al-day">
                <div className="al-day-head">{g.day}</div>
                <ul className="al-events">
                  {g.items.map((e) => (
                    <EventRow key={e.id} e={e} onUser={focusUser} onSession={focusSession} />
                  ))}
                </ul>
              </div>
            ))}
            {events.total > events.items.length && (
              <button type="button" className="btn btn-secondary al-more" onClick={() => setLimit((n) => n + PAGE)} disabled={loading}>
                Show {Math.min(PAGE, events.total - events.items.length)} more
              </button>
            )}
          </>
        )}

        {tab === 'people' && (
          <div className="table-wrap">
            <table className="al-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Sessions</th>
                  <th>First sign-in</th>
                  <th>Last seen</th>
                  <th>Active</th>
                  <th>Idle</th>
                  <th>Away</th>
                  <th>Time split</th>
                  <th>Actions</th>
                  <th>WhatsApp sent</th>
                  <th>PDFs</th>
                  <th>Downloads</th>
                  <th>Failed sign-ins</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.users || []).map((u) => (
                  <tr key={u.user}>
                    <td><Person name={u.userName} user={u.user} sub={[u.designation, u.department].filter(Boolean).join(' · ')} onClick={() => focusUser(u.user)} /></td>
                    <td>{u.sessions}</td>
                    <td>{fmtDateTime(u.firstLoginAt)}</td>
                    <td>{fmtDateTime(u.lastAt)}</td>
                    <td>{fmtDur(u.activeMs)}</td>
                    <td>{fmtDur(u.idleMs)}</td>
                    <td>{fmtDur(u.hiddenMs)}</td>
                    <td><TimeSplit active={u.activeMs} idle={u.idleMs} hidden={u.hiddenMs} /></td>
                    <td>{u.actions}</td>
                    <td>{u.whatsappSends}</td>
                    <td>{u.pdfs}</td>
                    <td>{u.exports}</td>
                    <td className={u.failedLogins ? 'is-bad' : ''}>{u.failedLogins}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!summary?.users?.length && <div className="al-empty">No activity for these filters.</div>}
          </div>
        )}

        {tab === 'departments' && (
          <div className="table-wrap">
            <table className="al-table">
              <thead>
                <tr>
                  <th>Department</th>
                  <th>People</th>
                  <th>Sessions</th>
                  <th>Active</th>
                  <th>Idle</th>
                  <th>Actions</th>
                  <th>WhatsApp sent</th>
                  <th>PDFs</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.departments || []).map((d) => (
                  <tr key={d.department}>
                    <td>
                      <button type="button" className="ai-link" onClick={() => { setDepartment(d.department); setTab('people'); }}>
                        {d.department}
                      </button>
                    </td>
                    <td>{d.users}</td>
                    <td>{d.sessions}</td>
                    <td>{fmtDur(d.activeMs)}</td>
                    <td>{fmtDur(d.idleMs)}</td>
                    <td>{d.actions}</td>
                    <td>{d.whatsappSends}</td>
                    <td>{d.pdfs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!summary?.departments?.length && <div className="al-empty">No activity for these filters.</div>}
          </div>
        )}

        {tab === 'sessions' && (
          <div className="table-wrap">
            <table className="al-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Signed in</th>
                  <th>Signed out / last seen</th>
                  <th>Length</th>
                  <th>Active · idle · away</th>
                  <th>Actions</th>
                  <th>Device</th>
                  <th>IP address</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(sessions || []).map((s) => (
                  <tr key={s.id}>
                    <td><Person name={s.userName} user={s.user} sub={s.department} onClick={() => focusUser(s.user)} /></td>
                    <td>{fmtDateTime(s.startedAt)}</td>
                    <td>
                      {s.open ? (
                        <span className="al-online">● Online now</span>
                      ) : (
                        <>
                          {fmtDateTime(s.endedAt)}
                          <small className="al-muted"> · {s.endReason}</small>
                        </>
                      )}
                    </td>
                    <td>{fmtDur(s.durationMs)}</td>
                    <td>
                      <TimeSplit active={s.activeMs} idle={s.idleMs} hidden={s.hiddenMs} />
                      <small className="al-muted">
                        {' '}
                        {fmtDur(s.activeMs)} · {fmtDur(s.idleMs)} · {fmtDur(s.hiddenMs)}
                      </small>
                    </td>
                    <td>{s.actions}</td>
                    <td>{s.device}</td>
                    <td>{s.ip}</td>
                    <td>
                      <button type="button" className="ai-link" onClick={() => focusSession(s.id)}>
                        Timeline
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sessions && !sessions.length && <div className="al-empty">No sign-ins in this range.</div>}
            {!sessions && <div className="al-empty">Loading…</div>}
          </div>
        )}

      </section>
    </div>
  );
}
