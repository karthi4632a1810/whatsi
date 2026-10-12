import { useEffect, useRef, useState } from 'react';
import { api, downloadLabResults } from '../api.js';
import PdfPreviewModal from '../components/PdfPreviewModal.jsx';
import { FilePdfIcon, FlaskIcon, SearchIcon } from './Icons';

/**
 * Lab Finder: OP patients by lab result, across lab days (server:
 * services/labResults.js). HIS sends no reference ranges, so instead of
 * High / Low flags you give a number range or the result text.
 */
const EMPTY = { test: '', value: '', min: '', max: '', from: '', to: '', patient: '', department: '', gender: '' };
const PAGE = 100;

const EXAMPLES = [
  { label: 'HbA1c 9 or more', q: { test: 'hba1c', min: 9 } },
  { label: 'Haemoglobin below 10', q: { test: 'haemoglobin', max: 9.99 } },
  { label: 'Creatinine above 1.5', q: { test: 'creatinine', min: 1.51 } },
  { label: 'Urine glucose · Positive', q: { test: 'glucose urine', value: 'positive' } },
];

function isoToDmy(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso || '';
}

function toQuery(f) {
  const q = {};
  for (const [k, v] of Object.entries(f)) if (String(v).trim() !== '') q[k] = String(v).trim();
  return q;
}

export default function LabFinder({ canDownload = true }) {
  const [form, setForm] = useState(EMPTY);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [suggestions, setSuggestions] = useState([]);
  const [coverage, setCoverage] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [preview, setPreview] = useState(null);
  const suggestTimer = useRef(null);

  useEffect(() => {
    api.labCoverage().then(setCoverage).catch(() => {});
  }, []);

  async function run(nextForm) {
    const f = nextForm || form;
    setForm(f);
    setLoading(true);
    setError('');
    setShown(PAGE);
    try {
      setResult(await api.labSearch(toQuery(f)));
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  function set(key) {
    return (e) => {
      const value = e.target.value;
      setForm((f) => ({ ...f, [key]: value }));
      if (key === 'test') {
        clearTimeout(suggestTimer.current);
        suggestTimer.current = setTimeout(() => {
          if (value.trim().length < 2) return setSuggestions([]);
          api
            .labTests(value)
            .then((d) => setSuggestions((d.tests || []).slice(0, 12)))
            .catch(() => {});
        }, 250);
      }
    };
  }

  async function download() {
    setDownloading(true);
    try {
      await downloadLabResults(toQuery(form));
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  }

  const rows = result?.rows || [];

  return (
    <div className="search-view-container lf-page">
      <header className="lf-head">
        <div className="lf-head-icon">
          <FlaskIcon size={22} />
        </div>
        <div>
          <h2>Lab Finder</h2>
          <p>
            Find OP patients by lab result across lab days — e.g. everyone with HbA1c above 9 last month — then download the list.
            {coverage?.first && (
              <span className="lf-coverage">
                {' '}
                Results saved for lab days {isoToDmy(coverage.first)} to {isoToDmy(coverage.last)} ({coverage.days} day{coverage.days === 1 ? '' : 's'}); they fill in as each day loads from HIS.
              </span>
            )}
          </p>
        </div>
      </header>

      <form
        className="lf-form"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <div className="lf-grid">
          <label className="lf-field lf-span-2">
            <span>Test</span>
            <input list="lf-tests" value={form.test} onChange={set('test')} placeholder="e.g. hba1c, haemoglobin, urine glucose" autoFocus />
            <datalist id="lf-tests">
              {suggestions.map((t) => (
                <option key={t.name} value={t.test}>
                  {t.group ? `${t.group} · ` : ''}
                  {t.count} results{t.unit ? ` · ${t.unit}` : ''}
                </option>
              ))}
            </datalist>
          </label>
          <label className="lf-field">
            <span>Result contains</span>
            <input value={form.value} onChange={set('value')} placeholder="e.g. Positive" />
          </label>
          <label className="lf-field">
            <span>Value from</span>
            <input type="number" step="any" value={form.min} onChange={set('min')} placeholder="min" />
          </label>
          <label className="lf-field">
            <span>Value to</span>
            <input type="number" step="any" value={form.max} onChange={set('max')} placeholder="max" />
          </label>
          <label className="lf-field">
            <span>From</span>
            <input type="date" value={form.from} onChange={set('from')} />
          </label>
          <label className="lf-field">
            <span>To</span>
            <input type="date" value={form.to} onChange={set('to')} />
          </label>
          <label className="lf-field">
            <span>Patient, UHID or order</span>
            <input value={form.patient} onChange={set('patient')} placeholder="optional" />
          </label>
          <label className="lf-field">
            <span>Department</span>
            <input value={form.department} onChange={set('department')} placeholder="optional" />
          </label>
          <label className="lf-field">
            <span>Gender</span>
            <select value={form.gender} onChange={set('gender')}>
              <option value="">Any</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </label>
        </div>

        <div className="lf-actions">
          <div className="lf-examples">
            <span>Try:</span>
            {EXAMPLES.map((ex) => (
              <button key={ex.label} type="button" className="lf-example" onClick={() => run({ ...EMPTY, ...Object.fromEntries(Object.entries(ex.q).map(([k, v]) => [k, String(v)])) })}>
                {ex.label}
              </button>
            ))}
          </div>
          <div className="lf-buttons">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setForm(EMPTY);
                setResult(null);
                setError('');
              }}
            >
              Clear
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              <SearchIcon size={16} /> {loading ? 'Searching…' : 'Search'}
            </button>
          </div>
        </div>
      </form>

      {error && (
        <div className="lock-error lf-error" role="alert">
          <span>{error}</span>
        </div>
      )}

      {result && (
        <section className="lf-results">
          <div className="lf-results-head">
            <div>
              <div className="lf-count">
                <b>{rows.length}</b> result{rows.length === 1 ? '' : 's'} · <b>{result.patients}</b> patient{result.patients === 1 ? '' : 's'} · lab days {isoToDmy(result.from)} to{' '}
                {isoToDmy(result.to)}
                {result.truncated && <span className="lf-trunc"> (first 5,000 — narrow the search)</span>}
              </div>
            </div>
            {rows.length > 0 && canDownload && (
              <button type="button" className="btn btn-secondary" onClick={download} disabled={downloading}>
                {downloading ? 'Preparing…' : 'Download CSV'}
              </button>
            )}
          </div>

          {rows.length > 0 ? (
            <div className="table-wrap lf-table-wrap">
              <table className="lf-table">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>UHID</th>
                    <th>Order</th>
                    <th>Department</th>
                    <th>Test</th>
                    <th>Result</th>
                    <th>Lab day</th>
                    <th>Report</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, shown).map((r, i) => (
                    <tr key={`${r.labDay}-${r.orderId}-${r.test}-${i}`}>
                      <td className="lf-name">
                        {r.patientName}
                        {(r.age || r.gender) && <span className="lf-section">{[r.age, r.gender].filter(Boolean).join(' · ')}</span>}
                      </td>
                      <td className="lf-id is-plain">{r.patientId}</td>
                      <td className="lf-id">{r.orderId}</td>
                      <td>{r.department}</td>
                      <td>
                        {r.test}
                        {r.group && <span className="lf-section">{r.group}</span>}
                      </td>
                      <td className="lf-value">{r.result}</td>
                      <td className="lf-date">{isoToDmy(r.labDay)}</td>
                      <td>
                        {r.canPreview ? (
                          <button type="button" className="btn btn-secondary lf-pdf-btn" onClick={() => setPreview({ orderId: r.orderId, patientName: r.patientName, patientId: r.patientId })}>
                            <FilePdfIcon size={14} /> PDF
                          </button>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > shown && (
                <button type="button" className="btn btn-secondary lf-more" onClick={() => setShown((n) => n + PAGE)}>
                  Show {Math.min(PAGE, rows.length - shown)} more of {rows.length - shown}
                </button>
              )}
            </div>
          ) : (
            <div className="lf-empty">
              No matching results.{' '}
              {coverage?.first
                ? `Results are saved for OP lab days ${isoToDmy(coverage.first)} to ${isoToDmy(coverage.last)}.`
                : 'No results saved yet — they fill in as lab days load from HIS.'}
            </div>
          )}
        </section>
      )}

      <div className="legacy">
        <PdfPreviewModal order={preview} onClose={() => setPreview(null)} />
      </div>
    </div>
  );
}
