/**
 * Master Settings (super admin): every switch and timing of the portal in one
 * place (server: services/appSettings.js). Changes are staged on the page, then
 * reviewed and saved together; open screens pick them up within a minute.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';
import '../monitor/monitor.css';
import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  ExternalLinkIcon,
  GaugeIcon,
  GearIcon,
  HistoryIcon,
  LockIcon,
  MegaphoneIcon,
  RefreshIcon,
  RotateCcwIcon,
  SearchIcon,
  ShieldCheckIcon,
  ToggleIcon,
  UsersIcon,
  WhatsAppIcon,
} from './Icons';

const SECTION_ICONS = {
  toggle: ToggleIcon,
  whatsapp: WhatsAppIcon,
  retry: RotateCcwIcon,
  gauge: GaugeIcon,
  clock: ClockIcon,
  lock: LockIcon,
  shield: ShieldCheckIcon,
  megaphone: MegaphoneIcon,
};
const HISTORY_ID = 'history';

const TONES = { info: 'Info', warning: 'Warning', danger: 'Urgent' };
const SINGULAR = { hours: 'hour', days: 'day', characters: 'character', tries: 'try', 'tries / day': 'try / day', 'calls / day': 'call / day' };

const withUnit = (v, unit) => (unit ? `${v} ${Number(v) === 1 ? SINGULAR[unit] || unit : unit}` : String(v));

/** How a value reads on screen. */
function show(def, v) {
  if (def.type === 'bool') return v ? 'On' : 'Off';
  if (def.type === 'text') return v ? `“${v.length > 50 ? `${v.slice(0, 50)}…` : v}”` : 'empty';
  if (def.key === 'notice.tone') return TONES[v] || v;
  return withUnit(v, def.unit);
}

const fmtWhen = (v) =>
  v ? new Date(v).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '';
const fmtTime = (v) => (v ? new Date(v).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }) : '');
const num = (n) => Number(n || 0).toLocaleString('en-IN');
const PLURALS = { try: 'tries', 'automatic try': 'automatic tries', 'staff member': 'staff members' };
const plural = (n, word) => `${num(n)} ${n === 1 ? word : PLURALS[word] || `${word}s`}`;

/** What a change will do, for the review step (null = nothing to point out). */
function warningFor(def, from, to, live) {
  if (def.key.startsWith('features.') && to === false) {
    const n = live?.featureHolders?.[def.key];
    return n ? `Turns this off for ${plural(n, 'staff member')} who have it now.` : 'Turns this off for all staff.';
  }
  switch (def.key) {
    case 'maintenance.readOnly':
      return to ? 'Staff can only look: no sending, retries, downloads or changes. Automatic sending pauses too.' : null;
    case 'audit.retentionDays':
      return to < from ? `Audit records older than ${to} days are deleted for good.` : null;
    case 'auth.idleSignOutMinutes':
      return to > 0 ? `Anyone with no mouse or keyboard activity for ${to} min is signed out.` : null;
    case 'auth.minPasswordLength':
      return to > from ? 'Existing passwords keep working; it applies when a password is set or changed.' : null;
    default:
      return null;
  }
}

// ---- Controls --------------------------------------------------------------------

function Switch({ checked, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`um-switch ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

function NumberField({ def, value, onChange, onInvalid }) {
  const [text, setText] = useState(String(value));
  const step = def.step || 1;
  // "Reset to default" changes the value from outside.
  useEffect(() => {
    setText((t) => {
      if (t.trim() !== '' && Number(t) === value) return t;
      onInvalid(def.key, false);
      return String(value);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const n = Number(text);
  const error = text.trim() === '' || !Number.isFinite(n) ? 'Enter a number' : n < def.min || n > def.max ? `Between ${def.min} and ${def.max}` : '';

  function commit(t) {
    setText(t);
    const v = Number(t);
    const ok = t.trim() !== '' && Number.isFinite(v) && v >= def.min && v <= def.max;
    onInvalid(def.key, !ok);
    if (ok) onChange(v);
  }
  const snap = () => {
    if (error) return;
    const v = Math.min(def.max, Math.max(def.min, Math.round(n / step) * step));
    if (v !== n) commit(String(v));
  };
  const bump = (dir) => commit(String(Math.min(def.max, Math.max(def.min, (error ? Number(value) : Math.round(n / step) * step) + dir * step))));

  return (
    <div className="ms-num-wrap">
      <div className={`ms-num ${error ? 'is-error' : ''}`}>
        <button type="button" onClick={() => bump(-1)} disabled={!error && n <= def.min} aria-label={`Less (${def.label})`}>
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={def.min}
          max={def.max}
          step={step}
          value={text}
          onChange={(e) => commit(e.target.value)}
          onBlur={snap}
          aria-label={def.label}
          aria-invalid={Boolean(error)}
        />
        <button type="button" onClick={() => bump(1)} disabled={!error && n >= def.max} aria-label={`More (${def.label})`}>
          +
        </button>
      </div>
      {def.unit && <span className="ms-unit">{Number(text) === 1 ? SINGULAR[def.unit] || def.unit : def.unit}</span>}
      {error && <span className="ms-field-error">{error}</span>}
    </div>
  );
}

function SelectField({ def, value, onChange }) {
  return (
    <div className={`um-seg ms-seg ${def.key === 'notice.tone' ? 'is-tones' : ''}`} role="radiogroup" aria-label={def.label}>
      {def.options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o} className={value === o ? 'is-on' : ''} onClick={() => onChange(o)}>
          {def.key === 'notice.tone' && <i className={`ms-tone-dot is-${o}`} />}
          {def.key === 'notice.tone' ? TONES[o] : withUnit(o, def.unit)}
        </button>
      ))}
    </div>
  );
}

function TextField({ def, value, onChange }) {
  return (
    <div className="ms-text">
      <textarea
        rows={2}
        maxLength={def.max}
        value={value}
        placeholder="e.g. HIS maintenance tonight 10–11 pm — reports may be delayed."
        onChange={(e) => onChange(e.target.value)}
        aria-label={def.label}
      />
      <span className="ms-count">
        {value.length} / {def.max}
      </span>
    </div>
  );
}

// ---- Section extras ------------------------------------------------------------------

function NoticePreview({ values }) {
  const text = values['notice.text'];
  return (
    <div className="ms-preview">
      <span className="ms-preview-label">Preview</span>
      {text ? (
        <div className={`app-notice is-${values['notice.tone']}`}>
          <MegaphoneIcon size={15} />
          <span>{text}</span>
        </div>
      ) : (
        <div className="ms-preview-empty">No announcement — write one above to show it on every screen.</div>
      )}
      {values['maintenance.readOnly'] && (
        <div className="app-notice is-readonly">
          <LockIcon size={14} />
          <span>
            <b>Read-only mode</b> — the portal is under maintenance. You can view everything; sending, downloads and changes are paused.
          </span>
        </div>
      )}
    </div>
  );
}

function SectionExtra({ id, values, live, onNavigate }) {
  switch (id) {
    case 'features':
      return (
        <div className="ms-callout">
          <ShieldCheckIcon size={15} />
          <span>
            You (super admin) always keep every feature, so you can keep testing.
            {live?.staffCount !== undefined && ` ${plural(live.staffCount, 'active staff account')}.`}
          </span>
        </div>
      );
    case 'board':
      return (
        <div className="ms-callout">
          <ClockIcon size={15} />
          <span>The server loads the OP board from HIS on its own schedule; this only sets how often open screens re-read the saved board.</span>
        </div>
      );
    case 'security':
      return onNavigate ? (
        <div className="ms-callout">
          <LockIcon size={15} />
          <span>To unlock someone straight away, reset a password or sign a person out everywhere, use Users.</span>
          <button type="button" className="ms-link" onClick={() => onNavigate('users')}>
            Users <ExternalLinkIcon size={12} />
          </button>
        </div>
      ) : null;
    case 'audit':
      return onNavigate ? (
        <div className="ms-callout">
          <ShieldCheckIcon size={15} />
          <span>Every change made here is in the Audit Log too (Settings), with who and when.</span>
          <button type="button" className="ms-link" onClick={() => onNavigate('audit')}>
            Audit Log <ExternalLinkIcon size={12} />
          </button>
        </div>
      ) : null;
    case 'notice':
      return <NoticePreview values={values} />;
    default:
      return null;
  }
}

// ---- One setting -----------------------------------------------------------------------

function SettingRow({ def, value, saved, dirty, live, onChange, onInvalid, version }) {
  const holders = live?.featureHolders?.[def.key];
  const control =
    def.type === 'bool' ? (
      <div className="ms-bool">
        <span className={value ? 'is-on' : ''}>{value ? 'On' : 'Off'}</span>
        <Switch checked={value} onChange={onChange} label={def.label} />
      </div>
    ) : def.type === 'number' ? (
      <NumberField key={version} def={def} value={value} onChange={onChange} onInvalid={onInvalid} />
    ) : def.type === 'select' ? (
      <SelectField def={def} value={value} onChange={onChange} />
    ) : (
      <TextField def={def} value={value} onChange={onChange} />
    );

  return (
    <div className={`ms-row ${dirty ? 'is-dirty' : ''} ${def.type === 'text' ? 'is-wide' : ''}`} id={`ms-${def.key}`}>
      <div className="ms-row-text">
        <div className="ms-row-label">{def.label}</div>
        <p>{def.help}</p>
        <div className="ms-row-meta">
          {dirty && <span className="ms-tag is-unsaved">Unsaved · was {show(def, saved)}</span>}
          {!dirty && value !== def.baseValue && <span className="ms-tag">Default: {show(def, def.baseValue)}</span>}
          {def.fromEnv && (
            <span className="ms-tag is-env" title="This setting’s default comes from the server’s .env file">
              default from .env
            </span>
          )}
          {holders !== undefined && (
            <span className={`ms-tag ${value ? '' : 'is-off'}`}>
              {value ? `${plural(holders, 'staff member')} ${holders === 1 ? 'has' : 'have'} this` : `Off for ${plural(holders, 'staff member')} who have it`}
            </span>
          )}
          {value !== def.baseValue && (
            <button type="button" className="ms-reset" onClick={() => onChange(def.baseValue)} title={`Back to ${show(def, def.baseValue)}`}>
              <RotateCcwIcon size={11} /> Reset to default
            </button>
          )}
        </div>
      </div>
      <div className="ms-row-control">{control}</div>
    </div>
  );
}

// ---- Review & save ---------------------------------------------------------------------

function ReviewDialog({ changes, saving, error, onCancel, onSave }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !saving && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saving, onCancel]);

  return createPortal(
    <div className="ms-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !saving && onCancel()}>
      <div className="ms-modal" role="dialog" aria-modal="true" aria-labelledby="ms-review-title">
        <header>
          <h3 id="ms-review-title">Save {plural(changes.length, 'change')}?</h3>
          <button type="button" className="ms-icon-btn" onClick={onCancel} disabled={saving} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </header>
        <ul className="ms-review">
          {changes.map((c) => (
            <li key={c.def.key}>
              <div className="ms-review-label">{c.def.label}</div>
              <div className="ms-review-values">
                <span className="is-from">{show(c.def, c.from)}</span>
                <span aria-hidden="true">→</span>
                <span className="is-to">
                  {show(c.def, c.to)}
                  {c.to === c.def.baseValue ? ' (default)' : ''}
                </span>
              </div>
              {c.warning && (
                <div className="ms-review-warn">
                  <AlertIcon size={13} /> {c.warning}
                </div>
              )}
            </li>
          ))}
        </ul>
        {error && <div className="ms-error">{error}</div>}
        <footer>
          <span className="ms-modal-note">Applies to everyone right away; open screens update within a minute.</span>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
            Back
          </button>
          <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : `Save ${plural(changes.length, 'change')}`}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

// ---- The screen ---------------------------------------------------------------------------

// Unsaved changes survive switching to another screen and back.
let keptDraft = {};

export default function MasterSettings({ onNavigate, onSaved }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraftState] = useState(() => keptDraft);
  const [invalid, setInvalid] = useState({});
  const [version, setVersion] = useState(0); // remounts number fields on discard
  const [query, setQuery] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);
  const [active, setActive] = useState('features');
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [toast, setToast] = useState('');
  const sectionRefs = useRef({});

  const setDraft = useCallback((next) => {
    setDraftState((cur) => {
      const value = typeof next === 'function' ? next(cur) : next;
      keptDraft = value;
      return value;
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      setData(await api.masterSettings());
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const defs = useMemo(() => data?.settings || [], [data]);
  const byKey = useMemo(() => Object.fromEntries(defs.map((d) => [d.key, d])), [defs]);
  const valueOf = useCallback((key) => (key in draft ? draft[key] : byKey[key]?.value), [draft, byKey]);
  const values = useMemo(() => Object.fromEntries(defs.map((d) => [d.key, valueOf(d.key)])), [defs, valueOf]);
  const savedValues = useMemo(() => Object.fromEntries(defs.map((d) => [d.key, d.value])), [defs]);

  // Drop staged values that match what's saved (e.g. switched off and on again).
  const changes = useMemo(
    () =>
      defs
        .filter((d) => d.key in draft && draft[d.key] !== d.value)
        .map((d) => ({ def: d, from: d.value, to: draft[d.key], warning: warningFor(d, d.value, draft[d.key], data?.live) })),
    [defs, draft, data],
  );
  const hasInvalid = Object.values(invalid).some(Boolean);

  function change(key, value) {
    setDraft((cur) => ({ ...cur, [key]: value }));
    setToast('');
  }
  const markInvalid = useCallback((key, bad) => setInvalid((cur) => (cur[key] === bad ? cur : { ...cur, [key]: bad })), []);

  function discard() {
    setDraft({});
    setInvalid({});
    setVersion((v) => v + 1);
  }

  async function save() {
    setSaving(true);
    setSaveError('');
    try {
      const patch = Object.fromEntries(changes.map((c) => [c.def.key, c.to === c.def.baseValue ? null : c.to]));
      const result = await api.saveMasterSettings(patch);
      setData(result);
      setDraft({});
      setInvalid({});
      setVersion((v) => v + 1);
      setReviewing(false);
      const n = result.changes?.length ?? changes.length;
      setToast(n ? `Saved ${plural(n, 'change')}. Everyone has the new settings now.` : 'Nothing needed saving.');
      onSaved?.();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Leaving the page with unsaved changes asks first; Ctrl+S opens the review.
  useEffect(() => {
    if (!changes.length) return undefined;
    const beforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!hasInvalid) setReviewing(true);
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('keydown', onKey);
    };
  }, [changes.length, hasInvalid]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // Which section is on screen, for the side menu.
  useEffect(() => {
    if (!data) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (seen) setActive(seen.target.dataset.section);
      },
      { rootMargin: '-15% 0px -70% 0px' },
    );
    Object.values(sectionRefs.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [data, query, changedOnly]);

  const jump = (id) => {
    setActive(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const q = query.trim().toLowerCase();
  const matches = (d) =>
    (!q || `${d.label} ${d.help} ${d.key}`.toLowerCase().includes(q)) && (!changedOnly || values[d.key] !== d.baseValue || d.key in draft);
  const sections = (data?.sections || []).map((s) => ({ ...s, defs: defs.filter((d) => d.section === s.id && matches(d)) }));
  const notDefault = defs.filter((d) => d.value !== d.baseValue).length;

  if (!data) {
    return (
      <div className="ms-page wa-page">
        {loadError ? (
          <div className="error modern-error-alert">
            <div className="alert-icon">⚠️</div>
            <div className="alert-body">
              <strong>Couldn’t load the settings</strong>
              <div>{loadError}</div>
              <button type="button" className="btn btn-secondary" onClick={load}>
                Try again
              </button>
            </div>
          </div>
        ) : (
          <div className="loading modern-loading">
            <div className="spinner" />
            <div>Loading settings…</div>
          </div>
        )}
      </div>
    );
  }

  const live = data.live || {};
  const saved = savedValues;
  const glance = [
    {
      id: 'sending',
      nav: 'sending',
      icon: WhatsAppIcon,
      title: 'WhatsApp sending',
      value: live.sendingOn === null || live.sendingOn === undefined ? '—' : live.sendingOn ? 'On' : 'Off',
      sub: saved['maintenance.readOnly'] ? 'Paused by read-only mode' : 'Schedule on the Sending tab',
      tone: live.sendingOn && !saved['maintenance.readOnly'] ? 'ok' : 'warn',
    },
    {
      id: 'users',
      nav: 'users',
      icon: UsersIcon,
      title: 'Accounts',
      value: plural(live.staffCount || 0, 'staff account'),
      sub: `${plural(live.superAdmins || 0, 'super admin')}`,
      tone: 'neutral',
    },
    {
      id: 'security',
      icon: LockIcon,
      title: 'Sign-in',
      value: saved['auth.idleSignOutMinutes'] ? `Idle sign-out ${saved['auth.idleSignOutMinutes']} min` : 'No idle sign-out',
      sub: `Locks after ${saved['auth.maxFailedLogins']} wrong passwords`,
      tone: 'ok',
    },
    {
      id: 'notice',
      icon: saved['maintenance.readOnly'] ? LockIcon : MegaphoneIcon,
      title: 'Portal',
      value: saved['maintenance.readOnly'] ? 'Read-only mode' : 'Normal',
      sub: saved['notice.text'] ? 'Announcement showing' : 'No announcement',
      tone: saved['maintenance.readOnly'] ? 'warn' : 'ok',
    },
  ];

  return (
    <div className={`ms-page wa-page ${changes.length ? 'has-savebar' : ''}`}>
      <header className="al-hero ms-hero">
        <div className="al-hero-icon">
          <GearIcon size={26} />
        </div>
        <div className="al-hero-text">
          <h2>Master Settings</h2>
          <p>
            Portal switches, sign-in rules, audit and the announcement. Changes apply to everyone as soon as you save.
            {data.updatedAt && (
              <>
                {' '}
                Last changed {fmtWhen(data.updatedAt)}
                {data.updatedBy ? ` by ${data.updatedBy}` : ''}.
              </>
            )}
          </p>
        </div>
        <div className="al-hero-actions">
          <button type="button" className="al-hero-btn" onClick={load} disabled={loading}>
            <RefreshIcon size={15} spinning={loading} /> Refresh
          </button>
        </div>
      </header>

      <div className="ms-glance">
        {glance.map((g) => (
          <button key={g.id} type="button" className={`ms-glance-card is-${g.tone}`} onClick={() => (g.nav ? onNavigate?.(g.nav) : jump(g.id))}>
            <span className="ms-glance-icon">
              <g.icon size={18} />
            </span>
            <span className="ms-glance-text">
              <small>{g.title}</small>
              <b>{g.value}</b>
              {g.sub && <span>{g.sub}</span>}
            </span>
          </button>
        ))}
      </div>

      {toast && (
        <div className="ms-toast" role="status">
          <CheckIcon size={15} /> {toast}
        </div>
      )}

      <div className="ms-layout">
        <nav className="ms-nav" aria-label="Settings sections">
          {sections.map((s) => {
            const Icon = SECTION_ICONS[s.icon] || GearIcon;
            const all = defs.filter((d) => d.section === s.id);
            const unsaved = changes.some((c) => c.def.section === s.id);
            const custom = all.filter((d) => d.value !== d.baseValue).length;
            return (
              <button
                key={s.id}
                type="button"
                className={`ms-nav-item ${active === s.id ? 'is-active' : ''}`}
                onClick={() => jump(s.id)}
                disabled={!s.defs.length}
                aria-current={active === s.id ? 'true' : undefined}
              >
                <Icon size={15} />
                <span>{s.title}</span>
                {unsaved ? <i className="ms-nav-dot" title="Unsaved changes" /> : custom > 0 && <em title={`${custom} changed from the default`}>{custom}</em>}
              </button>
            );
          })}
          <button type="button" className={`ms-nav-item ${active === HISTORY_ID ? 'is-active' : ''}`} onClick={() => jump(HISTORY_ID)}>
            <HistoryIcon size={15} />
            <span>Change history</span>
          </button>
        </nav>

        <div className="ms-main">
          <div className="ms-tools">
            <label className="ms-search">
              <SearchIcon size={15} />
              <input type="search" placeholder="Find a setting — e.g. password, idle, announcement" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <button type="button" className={`wa-chip ${changedOnly ? 'is-on' : ''}`} onClick={() => setChangedOnly((v) => !v)} aria-pressed={changedOnly}>
              Changed from default ({notDefault})
            </button>
          </div>

          {sections.every((s) => !s.defs.length) && (
            <div className="ms-empty">
              No setting matches {q ? `“${query}”` : 'that'}.{' '}
              <button
                type="button"
                className="ms-link"
                onClick={() => {
                  setQuery('');
                  setChangedOnly(false);
                }}
              >
                Show all
              </button>
            </div>
          )}

          {sections
            .filter((s) => s.defs.length)
            .map((s) => {
              const Icon = SECTION_ICONS[s.icon] || GearIcon;
              const resettable = s.defs.filter((d) => values[d.key] !== d.baseValue);
              return (
                <section
                  key={s.id}
                  className="ms-section"
                  id={`ms-section-${s.id}`}
                  data-section={s.id}
                  ref={(el) => {
                    sectionRefs.current[s.id] = el;
                  }}
                >
                  <header className="ms-section-head">
                    <span className="ms-section-icon">
                      <Icon size={18} />
                    </span>
                    <div>
                      <h3>{s.title}</h3>
                      <p>{s.intro}</p>
                    </div>
                    {resettable.length > 0 && (
                      <button
                        type="button"
                        className="ms-reset is-section"
                        onClick={() => setDraft((cur) => ({ ...cur, ...Object.fromEntries(resettable.map((d) => [d.key, d.baseValue])) }))}
                      >
                        <RotateCcwIcon size={11} /> Reset section
                      </button>
                    )}
                  </header>
                  {!q && !changedOnly && <SectionExtra id={s.id} values={values} live={live} onNavigate={onNavigate} />}
                  <div className="ms-rows">
                    {s.defs.map((d) => (
                      <SettingRow
                        key={d.key}
                        def={d}
                        value={values[d.key]}
                        saved={d.value}
                        dirty={changes.some((c) => c.def.key === d.key)}
                        live={live}
                        version={`${d.key}-${version}`}
                        onChange={(v) => change(d.key, v)}
                        onInvalid={markInvalid}
                      />
                    ))}
                  </div>
                </section>
              );
            })}

          <section
            className="ms-section"
            data-section={HISTORY_ID}
            ref={(el) => {
              sectionRefs.current[HISTORY_ID] = el;
            }}
          >
            <header className="ms-section-head">
              <span className="ms-section-icon">
                <HistoryIcon size={18} />
              </span>
              <div>
                <h3>Change history</h3>
                <p>The last changes made here, newest first.</p>
              </div>
            </header>
            {data.history?.length ? (
              <ol className="ms-history">
                {data.history.map((h, i) => (
                  <li key={`${h.at}-${h.key}-${i}`}>
                    <span className="ms-history-when">{fmtWhen(h.at)}</span>
                    <span className="ms-history-what">
                      <b>{h.label}</b> {h.from} → {h.to}
                    </span>
                    <span className="ms-history-who">{h.by || '—'}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="ms-empty">Nothing changed yet — everything is on its default.</div>
            )}
          </section>
        </div>
      </div>

      {changes.length > 0 && (
        <div className="ms-savebar" role="region" aria-label="Unsaved changes">
          <span className="ms-savebar-text">
            <i className="ms-nav-dot" /> {plural(changes.length, 'unsaved change')}
            {hasInvalid && <em> · fix the highlighted number first</em>}
          </span>
          <button type="button" className="btn btn-secondary" onClick={discard}>
            Discard
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setSaveError('');
              setReviewing(true);
            }}
            disabled={hasInvalid}
          >
            Review &amp; save
          </button>
        </div>
      )}

      {reviewing && changes.length > 0 && (
        <ReviewDialog changes={changes} saving={saving} error={saveError} onCancel={() => setReviewing(false)} onSave={save} />
      )}
    </div>
  );
}
