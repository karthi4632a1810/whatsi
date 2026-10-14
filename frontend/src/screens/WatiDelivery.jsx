import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { displayPhone, normalizePhone } from "../lib/phone.js";
import { AlertIcon, CheckIcon, FilePdfIcon, LockIcon, PhoneIcon, WhatsAppIcon } from "../portal/Icons.jsx";
import { Loading } from "./ui.jsx";

const MODES = [
  { id: "off", title: "Off", desc: "Nothing is sent to anyone. Reports still join the WhatsApp queue." },
  { id: "test", title: "Test — my test number", desc: "Nothing goes out by itself. Send in the WhatsApp queue delivers to your test number, never to the patient." },
  { id: "live", title: "Live", desc: "Each OP report goes to the patient's own WhatsApp automatically, on the sending schedule." },
];
const PILL = {
  off: { cls: "is-off", text: "Off — nothing is sent" },
  test: { cls: "is-test", text: "Test — only your test number" },
  live: { cls: "is-live", text: "Live — sending to patients" },
};

function SavedTick({ show }) {
  return show ? (
    <span className="wati-saved" role="status">
      <CheckIcon size={13} /> Saved
    </span>
  ) : null;
}

function scheduleText(s) {
  if (!s) return "";
  const daily = s.mode === "END_OF_DAY" || s.mode === "CUSTOM_SCHEDULE";
  const when = daily ? `once a day at ${s.endOfDayTime || "18:00"}` : `${s.sendDelayHours ?? 3} h after the last result is approved`;
  return `${when}${s.quietHoursEnabled ? `, never between ${s.quietStart} and ${s.quietEnd}` : ""}`;
}

/**
 * WATI Settings → Delivery: Off / Test (only the test number) / Live, and the
 * test numbers — the investigation portal's delivery screen for OP reports.
 */
export default function WatiDelivery({ canEdit = false, isSuperAdmin = false }) {
  const [data, setData] = useState(null);
  const [template, setTemplate] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");
  const [saved, setSaved] = useState("");
  const [confirmLive, setConfirmLive] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");

  useEffect(() => {
    api
      .watiDelivery()
      .then(setData)
      .catch((e) => setError(e.message));
    api
      .watiTemplates()
      .then((d) => setTemplate((d.templates || []).find((t) => t.isDefault) || null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!saved) return undefined;
    const t = setTimeout(() => setSaved(""), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  async function persist(field, body) {
    setSaving(field);
    setError("");
    try {
      setData(await api.saveWatiDelivery(body));
      setSaved(field);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setSaving("");
    }
  }

  if (!data) return error ? <div className="lock-error wati-error">{error}</div> : <Loading>Loading WhatsApp delivery…</Loading>;

  const mode = data.mode;
  const phones = data.testPhones || [];
  const phoneValid = Boolean(normalizePhone(phoneInput)) && /^\d{11,15}$/.test(normalizePhone(phoneInput));
  const recipient = mode === "live" ? "Each patient's own mobile" : mode === "test" ? (phones[0] ? displayPhone(phones[0]) : "No test number yet") : "Nobody (sending is off)";
  const srv = data.server || {};

  function choose(next) {
    if (!canEdit || next === mode || saving) return;
    setConfirmLive(false);
    if (next === "live") return setConfirmLive(true);
    if (next === "test" && !phones.length) {
      setError("Add your test number below first — in test mode every send goes to it.");
      document.getElementById("wati-test-number")?.focus();
      return;
    }
    persist("mode", { mode: next });
  }

  async function addPhone(e) {
    e.preventDefault();
    if (!phoneValid) return;
    const next = [...new Set([...phones, normalizePhone(phoneInput)])];
    if (await persist("number", { testPhones: next })) setPhoneInput("");
  }

  return (
    <div className="search-view-container wati-page">
      <header className="wati-hero">
        <div className="wati-hero-icon">
          <WhatsAppIcon size={24} />
        </div>
        <div className="wati-hero-text">
          <h2>WhatsApp delivery</h2>
          <p>Choose who receives the OP lab reports: nobody, only your test number, or the patients.</p>
        </div>
        <span className={`wati-mode-pill ${PILL[mode].cls}`}>
          <span className="wati-mode-dot" />
          {PILL[mode].text}
        </span>
      </header>

      {error && (
        <div className="lock-error wati-error" role="alert">
          <AlertIcon size={16} />
          <span>{error}</span>
        </div>
      )}
      {!canEdit && (
        <div className="readonly-banner" role="note">
          <LockIcon size={14} /> View only — you can see the delivery mode but not change it.
        </div>
      )}
      {!srv.sendEnabled && (
        <div className="ms-callout is-warn op-server-note">
          <AlertIcon size={15} />
          <span>
            The server's own switch is off (<code>WATI_SEND_ENABLED=false</code> in <code>.env</code>) — no message can leave, in any mode. Set it to <code>true</code> and restart
            the backend.
          </span>
        </div>
      )}
      {srv.sendEnabled && srv.testMode && mode === "live" && (
        <div className="ms-callout is-warn op-server-note">
          <AlertIcon size={15} />
          <span>
            Live is chosen, but the server is locked to test (<code>WATI_TEST_MODE=true</code> in <code>.env</code>, only {displayPhone(srv.testPhone)}), so patients get nothing yet. Set
            it to <code>false</code> and restart the backend.
          </span>
        </div>
      )}

      <div className="wati-grid">
        <fieldset className="wati-col wati-fieldset" disabled={!canEdit}>
          <section className="wati-panel">
            <div className="wati-panel-head">
              <div>
                <h3>Delivery mode</h3>
                <p>Applies to everyone at once; the automatic sender picks it up within a minute.</p>
              </div>
              <SavedTick show={saved === "mode"} />
            </div>

            <div className="wati-modes op-modes-3" role="radiogroup" aria-label="Delivery mode">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.id}
                  className={`wati-mode ${m.id === "live" ? "is-live-option" : ""} ${m.id === "off" ? "is-off-option" : ""} ${mode === m.id ? "is-selected" : ""}`}
                  disabled={Boolean(saving)}
                  onClick={() => choose(m.id)}
                >
                  <span className="wati-mode-radio" />
                  <span className="wati-mode-title">{m.title}</span>
                  <span className="wati-mode-desc">{m.desc}</span>
                </button>
              ))}
            </div>

            {confirmLive && (
              <div className="wati-confirm" role="alertdialog" aria-labelledby="wati-confirm-title">
                <AlertIcon size={18} />
                <div className="wati-confirm-body">
                  <strong id="wati-confirm-title">Send reports to real patients?</strong>
                  <span>From the next run (within a minute), every ready OP lab report goes to the patient's own WhatsApp — {scheduleText(data.schedule)}.</span>
                  <div className="wati-confirm-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setConfirmLive(false)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn wati-btn-live"
                      disabled={Boolean(saving)}
                      onClick={async () => {
                        if (await persist("mode", { mode: "live" })) setConfirmLive(false);
                      }}
                    >
                      {saving === "mode" ? "Switching…" : "Yes, go Live"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>

          <form className="wati-panel" onSubmit={addPhone}>
            <div className="wati-panel-head">
              <div>
                <h3>
                  <label htmlFor="wati-test-number">Test numbers</label>
                </h3>
                <p>In test mode a send goes to one of these, picked when you press Send — never to the patient.</p>
              </div>
              <SavedTick show={saved === "number"} />
            </div>
            {phones.length > 0 && (
              <div className="op-active-filters">
                {phones.map((p, i) => (
                  <button
                    key={p}
                    type="button"
                    className="op-active-chip"
                    title={canEdit ? "Remove this number" : undefined}
                    onClick={() => {
                      if (mode === "test" && phones.length === 1) return setError("Keep at least one test number while test mode is on.");
                      persist("number", { testPhones: phones.filter((x) => x !== p) });
                    }}
                  >
                    <PhoneIcon size={12} /> {displayPhone(p)}
                    {i === 0 ? " · first" : ""} {canEdit && <span aria-hidden>×</span>}
                  </button>
                ))}
              </div>
            )}
            <div className="wati-input-row">
              <span className="wati-input">
                <PhoneIcon size={15} />
                <input id="wati-test-number" type="tel" inputMode="tel" placeholder="+91 99624 60782" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} />
              </span>
              <button type="submit" className="btn btn-primary" disabled={!phoneValid || Boolean(saving)}>
                {saving === "number" ? "Saving…" : "Add"}
              </button>
            </div>
            <p className={`wati-hint ${phoneInput && !phoneValid ? "is-invalid" : ""}`}>
              {phoneInput && !phoneValid ? "Enter a 10-digit mobile number, or one with its country code." : "A 10-digit number is sent as +91."}
            </p>
          </form>

          <section className="wati-panel">
            <div className="wati-panel-head">
              <div>
                <h3>When reports go out</h3>
                <p>In Live mode: {scheduleText(data.schedule)}.</p>
              </div>
            </div>
            <p className="wati-hint">
              {isSuperAdmin ? (
                <>
                  Change the delay, night hold and retries in <Link to="/settings/sending">Settings → Sending schedule</Link>.
                </>
              ) : (
                "A super admin sets the delay, night hold and retries in Settings."
              )}
            </p>
          </section>
        </fieldset>

        <aside className="wati-preview" aria-label="Message preview">
          <div className="wati-preview-title">
            <span>Message preview</span>
            <span className="wati-preview-to">To: {recipient}</span>
          </div>
          <div className="wati-phone">
            <div className="wati-phone-bar">
              <span className="wati-phone-avatar">
                <WhatsAppIcon size={16} />
              </span>
              <div>
                <div className="wati-phone-name">Adhiparasakthi Hospitals</div>
                <div className="wati-phone-sub">Business account</div>
              </div>
            </div>
            <div className="wati-chat">
              <div className="wati-bubble">
                <div className="wati-doc">
                  <span className="wati-doc-icon">
                    <FilePdfIcon size={18} />
                  </span>
                  <div className="wati-doc-text">
                    <div className="wati-doc-name">Lab-Report.pdf</div>
                    <div className="wati-doc-meta">PDF document · from AOSTA</div>
                  </div>
                </div>
                <div className="wati-bubble-text">
                  {template?.bodyPreview ? (
                    template.bodyPreview.replace("{{1}}", "Patient name")
                  ) : (
                    <>
                      Dear <b>Patient name</b>,{"\n\n"}Your lab report is ready. Please find it attached.{"\n\n"}Thank you.
                    </>
                  )}
                </div>
                <div className="wati-bubble-meta">{mode === "test" ? "Test send" : mode === "live" ? "Sent automatically" : "Not sent — delivery is off"}</div>
              </div>
            </div>
          </div>
          <ul className="wati-rules">
            <li>One message per OP order, with the official lab report PDF from AOSTA.</li>
            <li>Z patients are never sent.</li>
            <li>
              Template: <code>{data.templateName}</code> (approved in WATI).
            </li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
