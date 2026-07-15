import { useEffect, useState } from "react";
import { api } from "../api.js";
import PageHeader from "../components/PageHeader.jsx";
import WatiContactPicker from "../components/WatiContactPicker.jsx";

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [health, setHealth] = useState(null);
  const [watiContacts, setWatiContacts] = useState([]);
  const [contactsError, setContactsError] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.settings().then((d) => setSettings(d.settings)).catch((e) => setError(e.message));
    api.health().then(setHealth).catch(() => {});
  }, []);

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
    if (!settings?.messageSendEnabled) {
      setError("Turn on Message sending in Settings before sending to patients.");
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
          <h3 className="panel-title">Automation (HIS → queue)</h3>
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
                Polls HIS on schedule and syncs ready reports into the WhatsApp queue — does not
                send messages
              </small>
            </span>
          </label>
          {!settings.automationEnabled ? (
            <p className="field-hint field-hint--warn">
              Automation is OFF. Use <em>Sync to queue</em> on HIS Lab Today for manual sync, or
              turn this on for automatic queue updates.
            </p>
          ) : null}
        </section>

        <section
          className={`panel settings-section${settings.automationEnabled ? "" : " settings-section--disabled"}`}
          aria-disabled={!settings.automationEnabled}
        >
          <h3 className="panel-title">Queue rules</h3>
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

        <section className="panel settings-section settings-section--wide">
          <h3 className="panel-title">Message sending</h3>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={Boolean(settings.messageSendEnabled)}
              onChange={(e) => update("messageSendEnabled", e.target.checked)}
            />
            <span className="toggle-track" aria-hidden />
            <span>
              <strong>Message sending enabled</strong>
              <small>
                Allows WhatsApp delivery to patient phones — scheduled, bulk, and queue send buttons
              </small>
            </span>
          </label>
          {!settings.messageSendEnabled ? (
            <p className="field-hint field-hint--warn">
              Sending is OFF. Queue sync still works. Use <em>Test send</em> on the queue for safe
              tests without enabling patient delivery.
            </p>
          ) : !health?.watiSendEnabled ? (
            <p className="field-hint field-hint--warn">
              Also set <code>WATI_SEND_ENABLED=true</code> in server <code>.env</code> before live
              messages can leave the server.
            </p>
          ) : null}
        </section>

        <section
          className={`panel settings-section${settings.messageSendEnabled ? "" : " settings-section--disabled"}`}
          aria-disabled={!settings.messageSendEnabled}
        >
          <h3 className="panel-title">Send schedule</h3>
          <div className="form-grid">
            <label className="field-label">
              Mode
              <select
                value={settings.mode}
                disabled={!settings.messageSendEnabled}
                onChange={(e) => update("mode", e.target.value)}
              >
                <option value="END_OF_DAY">End of day (recommended)</option>
                <option value="IMMEDIATE">Immediate (after each HIS poll)</option>
              </select>
            </label>
            <label className="field-label">
              End of day time (IST)
              <input
                type="time"
                disabled={!settings.messageSendEnabled || settings.mode === "IMMEDIATE"}
                value={settings.endOfDayTime || "18:00"}
                onChange={(e) => update("endOfDayTime", e.target.value)}
              />
            </label>
          </div>
          {settings.mode === "END_OF_DAY" || settings.mode === "CUSTOM_SCHEDULE" ? (
            <p className="field-hint">
              Pending reports stay in the queue and send automatically once at{" "}
              <strong>{settings.endOfDayTime || "18:00"}</strong> India time. Failed sends may be
              retried after that time. Manual send from the queue still works anytime.
            </p>
          ) : (
            <p className="field-hint field-hint--warn">
              Immediate mode sends after each HIS poll. Switch to <strong>End of day</strong> to wait
              for the schedule.
            </p>
          )}
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
            Patient sends also require <strong>Message sending enabled</strong> above and{" "}
            <code>WATI_SEND_ENABLED=true</code> in server <code>.env</code>.
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
              <p className="field-hint" style={{ marginBottom: 10 }}>
                Add test numbers below — WATI API is only used when you send a report.
              </p>
              <WatiContactPicker
                contacts={watiContacts}
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
              WATI {health?.wati?.ok ? "configured" : "not configured"}
            </span>
            <span className={`status-pill ${health?.messageSendEnabled ? "warn" : "ok"}`}>
              Send {health?.messageSendEnabled ? "enabled" : "disabled (safe)"}
            </span>
            <span className={`status-pill ${settings.automationEnabled ? "ok" : "neutral"}`}>
              Queue sync {settings.automationEnabled ? "on" : "off"}
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
          disabled={!settings.messageSendEnabled || settings.watiTestSendMode}
          title={
            !settings.messageSendEnabled
              ? "Enable message sending in Settings first"
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
