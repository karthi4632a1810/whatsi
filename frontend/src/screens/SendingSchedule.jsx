import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { displayPhone, normalizePhone } from "../lib/phone.js";
import { AlertIcon, CheckIcon, ClockIcon, CloseIcon, FilePdfIcon, RotateCcwIcon, SendIcon, ToggleIcon, WhatsAppIcon } from "../portal/Icons.jsx";
import "../monitor/monitor.css";
import { Loading, Pill } from "./ui.jsx";

function Switch({ checked, onChange, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`um-switch ${checked ? "is-on" : ""}`} onClick={() => !disabled && onChange(!checked)} disabled={disabled}>
      <span />
    </button>
  );
}

function Seg({ value, options, onChange, disabled, label }) {
  return (
    <div className="um-seg ms-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? "is-on" : ""} onClick={() => onChange(o.value)} disabled={disabled}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Num({ value, onChange, min, max, step = 1, unit, label, disabled }) {
  const clamp = (n) => Math.min(max, Math.max(min, n));
  return (
    <div className="ms-num-wrap">
      <div className="ms-num">
        <button type="button" onClick={() => onChange(clamp(Number(value) - step))} disabled={disabled || Number(value) <= min} aria-label={`Less (${label})`}>
          −
        </button>
        <input type="number" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value === "" ? "" : clamp(Number(e.target.value)))} aria-label={label} />
        <button type="button" onClick={() => onChange(clamp(Number(value) + step))} disabled={disabled || Number(value) >= max} aria-label={`More (${label})`}>
          +
        </button>
      </div>
      {unit && <span className="ms-unit">{unit}</span>}
    </div>
  );
}

function Row({ label, help, children, wide, off }) {
  return (
    <div className={`ms-row ${wide ? "is-wide" : ""} ${off ? "op-row-off" : ""}`}>
      <div className="ms-row-text">
        <div className="ms-row-label">{label}</div>
        {help && <p>{help}</p>}
      </div>
      <div className="ms-row-control">{children}</div>
    </div>
  );
}

function Bool({ value, onChange, label, disabled }) {
  return (
    <div className="ms-bool">
      <span className={value ? "is-on" : ""}>{value ? "On" : "Off"}</span>
      <Switch checked={Boolean(value)} onChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}

function Section({ icon: Icon, title, intro, children }) {
  return (
    <section className="ms-section">
      <header className="ms-section-head">
        <span className="ms-section-icon">
          <Icon size={18} />
        </span>
        <div>
          <h3>{title}</h3>
          <p>{intro}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

/** Test numbers for test send mode: add by hand, remove with ×. */
function TestNumbers({ phones, onChange }) {
  const [draft, setDraft] = useState("");
  function add() {
    const phone = normalizePhone(draft);
    if (!phone) return;
    if (!phones.includes(phone)) onChange([...phones, phone]);
    setDraft("");
  }
  return (
    <div className="op-test-numbers">
      <div className="op-pdf-link-row">
        <input
          type="tel"
          inputMode="numeric"
          placeholder="10-digit mobile, e.g. 9384508490"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn btn-secondary" onClick={add}>
          Add number
        </button>
      </div>
      {phones.length ? (
        <div className="op-active-filters">
          {phones.map((p) => (
            <button key={p} type="button" className="op-active-chip" onClick={() => onChange(phones.filter((x) => x !== p))} aria-label={`Remove ${displayPhone(p)}`}>
              {displayPhone(p)} <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="wati-hint">No test numbers yet — test sends need at least one.</p>
      )}
    </div>
  );
}

const SCHEDULE_KEYS = [
  "automationEnabled",
  "readinessRule",
  "messageSendEnabled",
  "mode",
  "sendDelayHours",
  "endOfDayTime",
  "quietHoursEnabled",
  "quietStart",
  "quietEnd",
  "maxAutoSendAgeHours",
  "retryPolicy",
  "statusChecksEnabled",
  "statusChecksPerDay",
  "watiTemplateName",
  "watiTestSendMode",
  "watiTestContactPhones",
];
const pick = (s) => Object.fromEntries(SCHEDULE_KEYS.map((k) => [k, s?.[k]]));

/** Settings → Sending schedule (super admin): when OP reports go out on WhatsApp. */
export default function SendingSchedule() {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    api
      .settings()
      .then((d) => {
        setSaved(pick(d.settings));
        setDraft(pick(d.settings));
      })
      .catch((e) => setError(e.message));
    api.health().then(setHealth).catch(() => {});
  }, []);

  const dirty = useMemo(() => saved && draft && JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft]);

  useEffect(() => {
    if (!dirty) return undefined;
    const beforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  if (!draft) return error ? <div className="error">{error}</div> : <Loading>Loading the sending schedule…</Loading>;

  const set = (key) => (value) => {
    setToast("");
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const setRetry = (key) => (value) => setDraft((d) => ({ ...d, retryPolicy: { ...d.retryPolicy, [key]: value } }));
  const daily = draft.mode === "END_OF_DAY" || draft.mode === "CUSTOM_SCHEDULE";
  const sendOff = !draft.messageSendEnabled;

  async function save() {
    setSaving(true);
    setError("");
    try {
      const data = await api.saveSettings(draft);
      setSaved(pick(data.settings));
      setDraft(pick(data.settings));
      setToast("Saved — the sender uses the new schedule from its next run (within a minute).");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function sendAllPending() {
    if (!window.confirm("Send every pending OP report to patients now?")) return;
    setError("");
    try {
      const r = await api.sendAllPending();
      setToast(`Sent ${r.sent ?? 0}, failed ${r.failed ?? 0}.`);
    } catch (e) {
      setError(e.message);
    }
  }

  const summary = sendOff
    ? "Nothing goes to patients — reports still join the queue."
    : draft.watiTestSendMode
      ? "Test send mode — only manual sends to test numbers."
      : daily
        ? `Pending OP reports go out together once a day at ${draft.endOfDayTime || "18:00"} (India time).`
        : `Each OP report goes out ${draft.sendDelayHours ?? 3} h after its last result is approved${
            draft.quietHoursEnabled ? `, never between ${draft.quietStart} and ${draft.quietEnd} (held until ${draft.quietEnd})` : ""
          }. Older than ${draft.maxAutoSendAgeHours ?? 24} h → staff send by hand.`;

  return (
    <div className={`ms-page wa-page ${dirty ? "has-savebar" : ""}`}>
      <header className="al-hero ms-hero">
        <div className="al-hero-icon">
          <ClockIcon size={26} />
        </div>
        <div className="al-hero-text">
          <h2>Sending schedule</h2>
          <p>When OP lab reports go to patients on WhatsApp, the night hold, retries and test sends.</p>
        </div>
        <div className="al-hero-actions">
          <button
            type="button"
            className="al-hero-btn"
            onClick={sendAllPending}
            disabled={sendOff || saved.watiTestSendMode || !saved.messageSendEnabled}
            title={sendOff ? "Turn sending on first" : saved.watiTestSendMode ? "Not in test send mode" : "Send every pending report now"}
          >
            <SendIcon size={15} /> Send all pending now
          </button>
        </div>
      </header>

      <div className={`ms-callout ${sendOff ? "is-warn" : "is-live"}`}>
        {sendOff ? <AlertIcon size={15} /> : <WhatsAppIcon size={15} />}
        <span>{summary}</span>
      </div>

      {toast && (
        <div className="ms-toast" role="status">
          <CheckIcon size={15} /> {toast}
        </div>
      )}
      {error && <div className="error">{error}</div>}

      <div className="op-ms-main">
        <Section icon={ToggleIcon} title="HIS → queue" intro="Reports join the WhatsApp queue as HIS approves their results.">
          <div className="ms-rows">
            <Row label="Check HIS automatically" help="Every 15 minutes, today's OP board is loaded and newly approved reports join the queue. Off: use Sync to queue on the HIS board.">
              <Bool value={draft.automationEnabled} onChange={set("automationEnabled")} label="Check HIS automatically" />
            </Row>
            <Row label="A report is ready when" help="Strict waits for every test of the order; partial sends the approved ones first." off={!draft.automationEnabled}>
              <Seg
                label="Readiness rule"
                value={draft.readinessRule}
                onChange={set("readinessRule")}
                disabled={!draft.automationEnabled}
                options={[
                  { value: "STRICT", label: "All tests approved" },
                  { value: "PARTIAL", label: "Some approved" },
                ]}
              />
            </Row>
          </div>
        </Section>

        <Section icon={WhatsAppIcon} title="Sending to patients" intro="The master switch for WhatsApp to patients' phones.">
          <div className="ms-rows">
            <Row label="Send to patients" help="Off: nothing reaches a patient — scheduled, bulk and queue sends are all blocked. Queue sync still works.">
              <Bool value={draft.messageSendEnabled} onChange={set("messageSendEnabled")} label="Send to patients" />
            </Row>
            {draft.messageSendEnabled && health && !health.watiSendEnabled && (
              <div className="ms-callout is-warn">
                <AlertIcon size={15} /> The server also needs <code>WATI_SEND_ENABLED=true</code> in <code>.env</code> before messages can leave.
              </div>
            )}
            <Row label="When" help={daily ? "Everything pending goes out together at one time." : "Each report on its own, a set time after approval."} off={sendOff}>
              <Seg
                label="Send mode"
                value={daily ? "END_OF_DAY" : "AFTER_READY"}
                onChange={set("mode")}
                disabled={sendOff}
                options={[
                  { value: "AFTER_READY", label: "After approval" },
                  { value: "END_OF_DAY", label: "Once a day" },
                ]}
              />
            </Row>
            {daily ? (
              <Row label="Daily send time" help="India time." off={sendOff}>
                <input type="time" className="op-time" value={draft.endOfDayTime || "18:00"} disabled={sendOff} onChange={(e) => set("endOfDayTime")(e.target.value)} />
              </Row>
            ) : (
              <Row label="Send after approval" help="The wait gives the lab time to correct a result before the patient sees it." off={sendOff}>
                <Num label="Hours after approval" value={draft.sendDelayHours ?? 3} onChange={set("sendDelayHours")} min={0} max={48} step={0.5} unit="hours" disabled={sendOff} />
              </Row>
            )}
            <Row label="Night hold" help="No WhatsApp at night; anything due then goes out when the hold ends." off={sendOff}>
              <Bool value={draft.quietHoursEnabled} onChange={set("quietHoursEnabled")} label="Night hold" disabled={sendOff} />
            </Row>
            {draft.quietHoursEnabled && (
              <Row label="No sends between" help="India time." off={sendOff}>
                <div className="op-time-range">
                  <input type="time" className="op-time" value={draft.quietStart || "21:00"} disabled={sendOff} onChange={(e) => set("quietStart")(e.target.value)} />
                  <span>and</span>
                  <input type="time" className="op-time" value={draft.quietEnd || "07:00"} disabled={sendOff} onChange={(e) => set("quietEnd")(e.target.value)} />
                </div>
              </Row>
            )}
            <Row label="Don't send automatically if approved more than" help="Old reports wait for staff to send them by hand from the queue." off={sendOff}>
              <Num label="Automatic send age limit" value={draft.maxAutoSendAgeHours ?? 24} onChange={set("maxAutoSendAgeHours")} min={1} max={168} unit="hours ago" disabled={sendOff} />
            </Row>
          </div>
        </Section>

        <Section icon={RotateCcwIcon} title="Retries & ticks" intro="Temporary failures (network, WATI busy) are retried; “no number” and “not on WhatsApp” are not.">
          <div className="ms-rows">
            <Row label="Tries per report" help="Including the first send.">
              <Num label="Send attempts" value={draft.retryPolicy?.maxAttempts ?? 3} onChange={setRetry("maxAttempts")} min={1} max={10} unit="tries" />
            </Row>
            <Row label="First retry after" help="Later retries wait twice as long each time, and respect the night hold.">
              <Num label="Retry interval" value={draft.retryPolicy?.retryIntervalMinutes ?? 15} onChange={setRetry("retryIntervalMinutes")} min={5} max={360} step={5} unit="min" />
            </Row>
            <Row label="Ask WATI for delivered / read ticks" help="Not needed once the WATI webhook is connected. Each check uses WATI API quota.">
              <Bool value={draft.statusChecksEnabled} onChange={set("statusChecksEnabled")} label="Status checks" />
            </Row>
            <Row label="Most status checks a day" off={!draft.statusChecksEnabled}>
              <Num label="Status checks per day" value={draft.statusChecksPerDay ?? 100} onChange={set("statusChecksPerDay")} min={0} max={2000} step={10} unit="checks" disabled={!draft.statusChecksEnabled} />
            </Row>
          </div>
        </Section>

        <Section icon={FilePdfIcon} title="Template & test sends" intro="The approved WATI template, and a safe way to try a send.">
          <div className="ms-rows">
            <Row label="WATI template name" help="Exactly as approved in WATI (a–z, 0–9 and _).">
              <input className="op-text" value={draft.watiTemplateName || ""} onChange={(e) => set("watiTemplateName")(e.target.value)} placeholder="mapims_lab_rpt" />
            </Row>
            <Row label="Test send mode" help="Sends go to one test number you pick — never to the patient. Automatic sending is off while this is on.">
              <Bool value={draft.watiTestSendMode} onChange={set("watiTestSendMode")} label="Test send mode" />
            </Row>
            {draft.watiTestSendMode && (
              <Row label="Test numbers" wide>
                <TestNumbers phones={draft.watiTestContactPhones || []} onChange={set("watiTestContactPhones")} />
              </Row>
            )}
          </div>
        </Section>

        {health && (
          <div className="op-pill-row op-system">
            <Pill tone={health.wati?.ok ? "ok" : "bad"}>WATI {health.wati?.ok ? "configured" : "not configured"}</Pill>
            <Pill tone={health.watiSendEnabled ? "wa" : "muted"}>Server send switch {health.watiSendEnabled ? "on" : "off"}</Pill>
            <Pill tone={health.emrPollEnabled ? "ok" : "muted"}>HIS check {health.emrPollEnabled ? "on" : "off"}</Pill>
          </div>
        )}
      </div>

      {dirty && (
        <div className="ms-savebar" role="region" aria-label="Unsaved changes">
          <span className="ms-savebar-text">
            <i className="ms-nav-dot" /> Unsaved changes
          </span>
          <button type="button" className="btn btn-secondary" onClick={() => setDraft(saved)}>
            <CloseIcon size={14} /> Discard
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
