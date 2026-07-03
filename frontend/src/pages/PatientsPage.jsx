import { useEffect, useState } from "react";
import { api } from "../api.js";
import EmptyState from "../components/EmptyState.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { formatPatientName } from "../lib/format.js";

export default function PatientsPage() {
  const [patients, setPatients] = useState([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  async function load(search = q) {
    setLoading(true);
    try {
      const data = await api.patients(search ? { q: search } : {});
      setPatients(data.patients || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function savePhone(id, phoneOverride) {
    setSavingId(id);
    setError("");
    try {
      await api.patchPatient(id, { phoneOverride: phoneOverride.trim() });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Patient contacts"
        title="Contacts"
        lead="Phone numbers from EMR. Override a number here if WhatsApp should go to a different mobile."
      />

      {error ? <p className="error" role="alert">{error}</p> : null}

      <div className="panel">
        <div className="toolbar">
          <div className="toolbar-row toolbar-row--spread">
            <label className="field-label field-label--grow">
              Search
              <input
                className="search-input"
                placeholder="Name, UHID, or phone"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") load(q).catch((err) => setError(err.message));
                }}
              />
            </label>
            <button
              type="button"
              className="secondary"
              onClick={() => load(q).catch((e) => setError(e.message))}
            >
              Search
            </button>
          </div>
        </div>

        {!loading && patients.length > 0 ? (
          <p className="sync-bar" role="status">
            <span className="sync-dot sync-dot--live" aria-hidden />
            <span>
              <strong>{patients.length}</strong> contact{patients.length === 1 ? "" : "s"}
              {q ? ` matching “${q}”` : ""}
            </span>
          </p>
        ) : null}

        {loading ? (
          <p className="muted panel-loading">Loading contacts…</p>
        ) : patients.length ? (
          <div className="table-wrap">
            <table className="data-table contacts-table">
              <colgroup>
                <col className="col-uhid" />
                <col className="col-name" />
                <col className="col-emr-phone" />
                <col className="col-opip" />
                <col className="col-dept" />
                <col className="col-override" />
              </colgroup>
              <thead>
                <tr>
                  <th>UHID</th>
                  <th>Name</th>
                  <th>EMR phone</th>
                  <th>OP/IP</th>
                  <th className="col-dept">Department</th>
                  <th className="col-override">Override phone</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((p) => (
                  <tr key={p._id}>
                    <td className="td-mono">{p.patientId}</td>
                    <td className="td-patient" title={formatPatientName(p.name)}>
                      {formatPatientName(p.name)}
                    </td>
                    <td className="td-mono">{p.phone || "—"}</td>
                    <td>{p.opIpType || "—"}</td>
                    <td className="td-dept col-dept" title={p.department}>
                      {p.department || "—"}
                    </td>
                    <td className="td-override col-override">
                      <input
                        className={`input-inline${p.phoneOverride ? " has-override" : ""}${
                          savingId === p._id ? " is-saving" : ""
                        }`}
                        defaultValue={p.phoneOverride || ""}
                        placeholder="91XXXXXXXXXX"
                        disabled={savingId === p._id}
                        aria-label={`Override phone for ${formatPatientName(p.name)}`}
                        onBlur={(e) => {
                          const next = e.target.value.trim();
                          const prev = (p.phoneOverride || "").trim();
                          if (next !== prev) savePhone(p._id, next);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No contacts found"
            hint="Contacts appear when lab reports are synced from HIS."
          />
        )}
      </div>
    </div>
  );
}
