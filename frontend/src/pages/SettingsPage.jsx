import { useEffect, useState } from "react";
import { api } from "../api.js";
import PageHeader from "../components/PageHeader.jsx";
import WatiContactPicker from "../components/WatiContactPicker.jsx";
import { cacheStatusLabel } from "../lib/watiCache.js";

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [health, setHealth] = useState(null);
  const [watiContacts, setWatiContacts] = useState([]);
  const [contactsMeta, setContactsMeta] = useState(null);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsRefreshing, setContactsRefreshing] = useState(false);
  const [contactsError, setContactsError] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.settings().then((d) => setSettings(d.settings)).catch((e) => setError(e.message));
    api.health().then(setHealth).catch(() => {});
  }, []);

  useEffect(() => {
    if (!settings?.watiTestSendMode) return;
    loadContacts(false);
  }, [settings?.watiTestSendMode]);

  async function loadContacts(refresh = false) {
    if (refresh) setContactsRefreshing(true);
    else setContactsLoading(true);
    setContactsError("");
    try {
      const d = await api.watiContacts({ refresh });
      setWatiContacts(d.contacts || []);
      setContactsMeta(d);
      if (d.error) setContactsError(d.error);
    } catch (e) {
      setContactsError(e.message);
    } finally {
      setContactsLoading(false);
      setContactsRefreshing(false);
    }
  }

  function update(key, value) {
    setSaved(false);
    setSettings((s) => ({ ...s, [key]: value }));
  }

  async function save() {
    setError("");
    setSaved(false);
    setSaving(true);
    try {
      const data = await api.saveSettings(settings);
      setSettings(data.settings);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 4000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function sendAllPending() {
    if (!settings?.automationEnabled) {
      setError("Turn on Automation enabled above before sending all pending reports.");
      return;
    }
    if (settings?.watiTestSendMode) {
      setError("Test send mode is on — use Test send on individual reports in the queue.");
      return;
    }
    if (!window.confirm("Send all pending reports now?")) return;
    setError("");
    try {
      const result = await api.sendAllPending();
      alert(`Sent: ${result.sent ?? 0}, failed: ${result.failed ?? 0}`);
    } catch (e) {
      setError(e.message);
    }
  }

  if (!settings) {
    return (
      <div>
        <PageHeader eyebrow="Configuration" title="Automation settings" />
        <p className="muted panel-loading">Loading settings…</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Configuration"
        title="Automation settings"
        lead="Control when and how lab reports are queued and sent via WhatsApp."
      />

      {error ? <p className="error" role="alert">{error}</p> : null}
      {saved ? <p className="success-banner" role="status">Settings saved.</p> : null}

      <div className="settings-grid">
        <section className="panel settings-section settings-section--wide">
          <h3 className="panel-title">Automation</h3>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={settings.automationEnabled}
              onChange={(e) => update("automationEnabled", e.target.checked)}
            />
            <span className="toggle-track" aria-hidden />
            <span>
              <strong>Automation enabled</strong>
              <small>
                Master switch — EMR poll, scheduled send, and retries run only when this is ON
              </small>
            </span>
          </label>
          {!settings.automationEnabled ? (
            <p className="field-hint field-hint--warn">
              Automation is OFF. Nothing sends automatically. Use Test send on the queue for manual
              tests, or turn this on when ready for live delivery.
            </p>
          ) : null}
        </section>

        <section
          className={`panel settings-section${settings.automationEnabled ? "" : " settings-section--disabled"}`}
          aria-disabled={!settings.automationEnabled}
        >
          <h3 className="panel-title">Schedule</h3>
          <div className="form-grid">
            <label className="field-label">
              Mode
              <select
                value={settings.mode}
                disabled={!settings.automationEnabled}
                onChange={(e) => update("mode", e.target.value)}
              >
                <option value="END_OF_DAY">End of day</option>
                <option value="IMMEDIATE">Immediate</option>
              </select>
            </label>
            <label className="field-label">
              End of day time
              <input
                type="time"
                disabled={!settings.automationEnabled}
                value={settings.endOfDayTime || "18:00"}
                onChange={(e) => update("endOfDayTime", e.target.value)}
              />
            </label>
          </div>
        </section>

        <section
          className={`panel settings-section${settings.automationEnabled ? "" : " settings-section--disabled"}`}
          aria-disabled={!settings.automationEnabled}
        >
          <h3 className="panel-title">Delivery rules</h3>
          <div className="form-grid">
            <label className="field-label">
              Patient scope
              <select
                value={settings.scope}
                disabled={!settings.automationEnabled}
                onChange={(e) => update("scope", e.target.value)}
              >
                <option value="ALL">All patients</option>
                <option value="OP_ONLY">OP only</option>
                <option value="IP_ONLY">IP only</option>
              </select>
            </label>
            <label className="field-label">
              Readiness rule
              <select
                value={settings.readinessRule}
                disabled={!settings.automationEnabled}
                onChange={(e) => update("readinessRule", e.target.value)}
              >
                <option value="STRICT">Strict — all tests approved</option>
                <option value="PARTIAL">Partial — send approved tests</option>
              </select>
            </label>
          </div>
        </section>

        <section className="panel settings-section">
          <h3 className="panel-title">WATI template</h3>
          <label className="field-label">
            Template name
            <input
              value={settings.watiTemplateName || "mapims_lab_rpt"}
              onChange={(e) => update("watiTemplateName", e.target.value)}
            />
          </label>
          <p className="field-hint">
            Sends are blocked unless <code>WATI_SEND_ENABLED=true</code> in server .env.
          </p>
        </section>

        <section className="panel settings-section settings-section--wide">
          <h3 className="panel-title">WATI test send</h3>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={Boolean(settings.watiTestSendMode)}
              onChange={(e) => update("watiTestSendMode", e.target.checked)}
            />
            <span className="toggle-track" aria-hidden />
            <span>
              <strong>Test send mode</strong>
              <small>
                Manual test sends only — pick one contact per report. Auto-send is disabled.
              </small>
            </span>
          </label>
          {settings.watiTestSendMode ? (
            <>
              <div className="toolbar-row" style={{ marginBottom: 10 }}>
                <p className="field-hint" style={{ margin: 0, flex: 1 }}>
                  Contacts listed here are available when you click Test send on the queue.
                  {cacheStatusLabel(contactsMeta) ? (
                    <> · <strong>{cacheStatusLabel(contactsMeta)}</strong></>
                  ) : null}
                </p>
                <button
                  type="button"
                  className="secondary btn-sm"
                  disabled={contactsLoading || contactsRefreshing}
                  onClick={() => loadContacts(true)}
                >
                  {contactsRefreshing ? "Refreshing…" : "Refresh from WATI"}
                </button>
              </div>
              <WatiContactPicker
                contacts={watiContacts}
                loading={contactsLoading}
                contactsError={contactsError}
                selectedPhones={settings.watiTestContactPhones || []}
                onChange={(phones) => update("watiTestContactPhones", phones)}
              />
            </>
          ) : null}
        </section>

        <section className="panel settings-section">
          <h3 className="panel-title">System status</h3>
          <div className="status-pills">
            <span className={`status-pill ${health?.wati?.ok ? "ok" : "bad"}`}>
              WATI {health?.wati?.ok ? "connected" : "error"}
            </span>
            <span className={`status-pill ${health?.watiSendEnabled ? "warn" : "ok"}`}>
              Send {health?.watiSendEnabled ? "enabled" : "disabled (safe)"}
            </span>
            <span className={`status-pill ${health?.emrPollEnabled ? "ok" : "neutral"}`}>
              EMR poll {health?.emrPollEnabled ? "on" : "off"}
            </span>
          </div>
        </section>
      </div>

      <div className="settings-actions">
        <button type="button" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
        <button
          className="secondary"
          type="button"
          onClick={sendAllPending}
          disabled={!settings.automationEnabled || settings.watiTestSendMode}
          title={
            !settings.automationEnabled
              ? "Enable automation in Settings first"
              : settings.watiTestSendMode
                ? "Disabled while test send mode is on"
                : "Send every pending report to patient phones"
          }
        >
          Send all pending now
        </button>
      </div>
    </div>
  );
}
