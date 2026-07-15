import { useEffect, useState } from "react";
import { api } from "../api.js";
import Badge from "../components/Badge.jsx";
import EmptyState from "../components/EmptyState.jsx";
import PageHeader from "../components/PageHeader.jsx";

const EMPTY_FORM = {
  name: "",
  displayName: "",
  category: "LAB",
  language: "en",
  status: "ACTIVE",
  bodyPreview: "",
  notes: "",
  isDefault: false,
};

export default function WatiTemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await api.watiTemplates();
      setTemplates(data.templates || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  async function saveTemplate(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (editingId) {
        await api.watiUpdateTemplate(editingId, form);
      } else {
        await api.watiCreateTemplate(form);
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(tpl) {
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

  async function removeTemplate(id) {
    if (!window.confirm("Delete this template from MongoDB?")) return;
    setBusy(true);
    setError("");
    try {
      await api.watiDeleteTemplate(id);
      if (editingId === id) resetForm();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="WATI templates"
        title="Template management"
        lead="Register templates in MongoDB. The name must match the approved WATI template used when sending reports."
      />

      {error ? <p className="error" role="alert">{error}</p> : null}

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="toolbar">
          <p className="muted" style={{ margin: 0 }}>
            Templates are stored locally. WATI API is only called on send — add template names here manually.
          </p>
        </div>

        <form className="template-form" onSubmit={saveTemplate}>
          <h3 className="panel-title">{editingId ? "Edit template" : "Add template"}</h3>
          <div className="form-grid">
            <label className="field-label">
              WATI template name
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="mapims_lab_rpt"
                required
                disabled={Boolean(editingId)}
              />
            </label>
            <label className="field-label">
              Display name
              <input
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              />
            </label>
            <label className="field-label">
              Status
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="DRAFT">Draft</option>
              </select>
            </label>
            <label className="field-label">
              Category
              <input
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              />
            </label>
          </div>
          <label className="field-label">
            Body preview
            <textarea
              className="textarea-field"
              rows={3}
              value={form.bodyPreview}
              onChange={(e) => setForm((f) => ({ ...f, bodyPreview: e.target.value }))}
            />
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
            />
            <span className="toggle-track" aria-hidden />
            <span>
              <strong>Default template</strong>
              <small>Used when sending lab reports</small>
            </span>
          </label>
          <div className="settings-actions">
            <button type="submit" disabled={busy}>
              {editingId ? "Save changes" : "Create template"}
            </button>
            {editingId ? (
              <button type="button" className="secondary" onClick={resetForm}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </div>

      <div className="panel">
        {loading ? (
          <p className="muted panel-loading">Loading templates…</p>
        ) : templates.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>WATI status</th>
                  <th>Default</th>
                  <th className="col-action">Actions</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((tpl) => (
                  <tr key={tpl._id}>
                    <td>
                      <strong>{tpl.displayName || tpl.name}</strong>
                      <div className="muted td-mono">{tpl.name}</div>
                    </td>
                    <td>
                      <Badge kind={tpl.status?.toLowerCase()}>{tpl.status}</Badge>
                    </td>
                    <td>{tpl.source}</td>
                    <td>{tpl.watiStatus || "—"}</td>
                    <td>{tpl.isDefault ? "Yes" : "—"}</td>
                    <td className="col-action td-action">
                      <button type="button" className="btn-sm secondary" onClick={() => startEdit(tpl)}>
                        Edit
                      </button>{" "}
                      <button
                        type="button"
                        className="btn-sm secondary"
                        disabled={tpl.isDefault || busy}
                        onClick={() => removeTemplate(tpl._id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No templates yet"
            hint="Create a template manually — name must match your approved WATI template."
          />
        )}
      </div>
    </div>
  );
}
