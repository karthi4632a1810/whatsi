import { useEffect, useState } from "react";
import { api } from "../api.js";
import PageHeader from "../components/PageHeader.jsx";
import { formatPatientName } from "../lib/format.js";
import { isValidMobile } from "../lib/hisFilters.js";
import { LockIcon, SearchIcon } from "../portal/Icons.jsx";
import { CopyableChip, Empty, Loading, Pill, Toast, prettyPhone, useToast } from "./ui.jsx";

/**
 * WATI Settings → Contacts: each patient's mobile from HIS, and the number to
 * use instead when WhatsApp should go elsewhere. Saving re-queues reports that
 * failed for "no number" / "not on WhatsApp".
 */
export default function WatiContacts({ canEdit = false }) {
  const [patients, setPatients] = useState([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [toast, showToast, hideToast] = useToast();

  async function load(search = q) {
    setLoading(true);
    try {
      setPatients((await api.patients(search.trim() ? { q: search.trim() } : {})).patients || []);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function savePhone(p, value) {
    setSavingId(p._id);
    setError("");
    try {
      await api.patchPatient(p._id, { phoneOverride: value.trim() });
      showToast(value.trim() ? `WhatsApp for ${formatPatientName(p.name)} → ${prettyPhone(value)}` : `${formatPatientName(p.name)} uses the HIS number again`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="search-view-container">
      <Toast toast={toast} onDismiss={hideToast} />
      <PageHeader title="Patient contacts" lead="Mobile numbers come from HIS. Set a different WhatsApp number when a report should go elsewhere — failed sends for that patient are queued again." />

      {!canEdit && (
        <div className="readonly-banner" role="note">
          <LockIcon size={14} /> View only — you can see the numbers but not change them.
        </div>
      )}

      <form
        className="reports-toolbar modern-toolbar op-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <div className="in-table-filter">
          <SearchIcon size={16} className="filter-input-icon" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, UHID or mobile — Enter to search" className="filter-text-input" aria-label="Search contacts" />
          {q && (
            <button
              type="button"
              className="filter-clear-btn"
              onClick={() => {
                setQ("");
                load("");
              }}
            >
              ×
            </button>
          )}
        </div>
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
      </form>

      {error && <div className="error">{error}</div>}

      {loading ? (
        <Loading>Loading contacts…</Loading>
      ) : patients.length ? (
        <div className="results-container">
          <div className="results-meta-bar">
            <div className="result-count-badge">
              <strong>{patients.length}</strong> contact{patients.length === 1 ? "" : "s"}
              {q.trim() ? ` matching “${q.trim()}”` : ""}
            </div>
          </div>
          <div className="table-wrap modern-table-wrap">
            <table className="results modern-results-table op-board-table">
              <thead>
                <tr>
                  <th>UHID</th>
                  <th>Patient</th>
                  <th>Mobile in HIS</th>
                  <th>Department</th>
                  <th>WhatsApp goes to</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((p) => {
                  const valid = isValidMobile(p.phone);
                  return (
                    <tr key={p._id}>
                      <td>
                        <CopyableChip value={p.patientId} label="UHID" className="code-chip code-chip-reg" onToast={showToast} screen="wati" />
                      </td>
                      <td className="op-cell-patient">
                        <span className="op-name">{formatPatientName(p.name)}</span>
                      </td>
                      <td>
                        {p.phone ? <span className={valid ? "" : "op-bad-number"}>{prettyPhone(p.phone)}</span> : <span className="text-muted">—</span>}
                        {p.phone && !valid && (
                          <>
                            {" "}
                            <Pill tone="bad">placeholder</Pill>
                          </>
                        )}
                      </td>
                      <td className="op-cell-dept" title={p.department}>
                        {p.department || "—"}
                      </td>
                      <td className="op-override-cell">
                        {canEdit ? (
                          <input
                            className={`op-override ${p.phoneOverride ? "has-value" : ""}`}
                            defaultValue={p.phoneOverride || ""}
                            placeholder={p.phone ? "Same as HIS" : "Add a mobile"}
                            disabled={savingId === p._id}
                            inputMode="tel"
                            aria-label={`WhatsApp number for ${formatPatientName(p.name)}`}
                            onBlur={(e) => {
                              const next = e.target.value.trim();
                              if (next !== (p.phoneOverride || "").trim()) savePhone(p, next);
                            }}
                            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                          />
                        ) : p.phoneOverride ? (
                          <b>{prettyPhone(p.phoneOverride)}</b>
                        ) : (
                          <span className="text-muted">Same as HIS</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <Empty title="No contacts found">Patients appear here as their lab reports are synced from HIS.</Empty>
      )}
    </div>
  );
}
