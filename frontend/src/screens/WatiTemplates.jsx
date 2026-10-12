import { useEffect, useState } from "react";
import { api } from "../api.js";
import PageHeader from "../components/PageHeader.jsx";
import { EditIcon, LockIcon, PlusIcon, TrashIcon } from "../portal/Icons.jsx";
import { Empty, Loading, Pill, Toast, useToast } from "./ui.jsx";

const EMPTY_FORM = { name: "", displayName: "", category: "LAB", language: "en", status: "ACTIVE", bodyPreview: "", notes: "", isDefault: false };
const STATUS_TONE = { ACTIVE: "ok", INACTIVE: "muted", DRAFT: "warn" };

/** WATI Settings → Templates: the approved WATI template names whatsi sends with. */
export default function WatiTemplates({ canEdit = false }) {
  const [templates, setTemplates] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, showToast, hideToast] = useToast();

  async function load() {
    setLoading(true);
    try {
      setTemplates((await api.watiTemplates()).templates || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  function reset() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (editingId) await api.watiUpdateTemplate(editingId, form);
      else await api.watiCreateTemplate(form);
      showToast(editingId ? "Template saved" : "Template added");
      reset();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function edit(tpl) {
    setEditingId(tpl._id);
    setForm({
      name: tpl.name,
      displayName: tpl.displayName || tpl.name,
      category: tpl.category || "LAB",
      language: tpl.language || "en",
      status: tpl.status || "ACTIVE",
      bodyPreview: tpl.bodyPreview || "",
      notes: tpl.notes || "",
      isDefault: Boolean(tpl.isDefault),
    });
  }

  async function remove(tpl) {
    if (!window.confirm(`Delete the template “${tpl.displayName || tpl.name}”?`)) return;
    setBusy(true);
    try {
      await api.watiDeleteTemplate(tpl._id);
      if (editingId === tpl._id) reset();
      showToast("Template deleted");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="search-view-container wati-page">
      <Toast toast={toast} onDismiss={hideToast} />
      <PageHeader title="Message templates" lead="The template name must match a template approved in WATI. The default one is used for every OP lab report." />

      {!canEdit && (
        <div className="readonly-banner" role="note">
          <LockIcon size={14} /> View only — you can see the templates but not change them.
        </div>
      )}
      {error && <div className="error">{error}</div>}

      <div className={canEdit ? "wati-grid" : ""}>
        <div className="wati-col">
          <section className="wati-panel">
            <div className="wati-panel-head">
              <div>
                <h3>Templates</h3>
                <p>Stored in whatsi; WATI itself is only called when sending.</p>
              </div>
            </div>
            {loading ? (
              <Loading>Loading templates…</Loading>
            ) : templates.length ? (
              <div className="table-wrap modern-table-wrap">
                <table className="results modern-results-table">
                  <thead>
                    <tr>
                      <th>Template</th>
                      <th>Status</th>
                      <th>Category</th>
                      <th>Default</th>
                      {canEdit && <th className="th-action">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((tpl) => (
                      <tr key={tpl._id}>
                        <td className="op-cell-patient">
                          <span className="op-name">{tpl.displayName || tpl.name}</span>
                          <small>
                            <code>{tpl.name}</code>
                            {tpl.watiStatus ? ` · WATI: ${tpl.watiStatus}` : ""}
                          </small>
                        </td>
                        <td>
                          <Pill tone={STATUS_TONE[tpl.status] || "muted"}>{String(tpl.status || "—").toLowerCase()}</Pill>
                        </td>
                        <td>{tpl.category || "—"}</td>
                        <td>{tpl.isDefault ? <Pill tone="wa">Default</Pill> : <span className="text-muted">—</span>}</td>
                        {canEdit && (
                          <td className="cell-action">
                            <div className="action-btn-group">
                              <button type="button" className="um-action" onClick={() => edit(tpl)}>
                                <EditIcon size={14} /> <span>Edit</span>
                              </button>
                              <button type="button" className="um-action is-danger" disabled={tpl.isDefault || busy} onClick={() => remove(tpl)} title={tpl.isDefault ? "The default template can't be deleted" : "Delete"}>
                                <TrashIcon size={14} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No templates yet">Add the name of your approved WATI template.</Empty>
            )}
          </section>
        </div>

        {canEdit && (
          <div className="wati-col">
            <form className="wati-panel" onSubmit={save}>
              <div className="wati-panel-head">
                <div>
                  <h3>{editingId ? "Edit template" : "Add template"}</h3>
                  <p>{editingId ? "The WATI name can't change; add a new template instead." : "Exactly as it is named in WATI."}</p>
                </div>
              </div>
              <div className="um-grid">
                <label className="um-field">
                  <span>WATI template name *</span>
                  <input value={form.name} onChange={set("name")} placeholder="mapims_lab_rpt" required disabled={Boolean(editingId)} />
                </label>
                <label className="um-field">
                  <span>Display name</span>
                  <input value={form.displayName} onChange={set("displayName")} placeholder="OP lab report" />
                </label>
                <label className="um-field">
                  <span>Status</span>
                  <select value={form.status} onChange={set("status")}>
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                    <option value="DRAFT">Draft</option>
                  </select>
                </label>
                <label className="um-field">
                  <span>Category</span>
                  <input value={form.category} onChange={set("category")} />
                </label>
                <label className="um-field um-span-2">
                  <span>Message text (preview)</span>
                  <textarea rows={4} value={form.bodyPreview} onChange={set("bodyPreview")} placeholder="Dear {{1}}, your lab report is ready…" />
                </label>
              </div>
              <label className="um-inline-check">
                <input type="checkbox" checked={form.isDefault} onChange={set("isDefault")} />
                <span>Default — used for every OP lab report</span>
              </label>
              <div className="um-modal-actions">
                {editingId && (
                  <button type="button" className="btn btn-secondary" onClick={reset}>
                    Cancel
                  </button>
                )}
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {editingId ? (
                    "Save changes"
                  ) : (
                    <>
                      <PlusIcon size={15} /> Add template
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
