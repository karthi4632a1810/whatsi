import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
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


const SCHEDULE_KEYS = [
  "automationEnabled",
  "readinessRule",
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
];
// Off / Test / Live is on WATI Settings → Delivery (api.watiDelivery), not saved from here.
const deliveryOf = (s) => (s?.watiTestSendMode ? "test" : s?.messageSendEnabled ? "live" : "off");
const pick = (s) => Object.fromEntries(SCHEDULE_KEYS.map((k) => [k, s?.[k]]));

/** Settings → Sending schedule (super admin): when OP reports go out on WhatsApp. */
export default function SendingSchedule() {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [health, setHealth] = useState(null);
  const [delivery, setDelivery] = useState("off");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    api
      .settings()
      .then((d) => {
        setSaved(pick(d.settings));
        setDraft(pick(d.settings));
        setDelivery(deliveryOf(d.settings));
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
  const sendOff = delivery !== "live";

  async function save() {
    setSaving(true);
    setError("");
    try {
      const data = await api.saveSettings(draft);
      setSaved(pick(data.settings));
      setDraft(pick(data.settings));
      setDelivery(deliveryOf(data.settings));
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

  const summary =
    delivery === "off"
      ? "WhatsApp delivery is Off — nothing goes out; reports still join the queue. The schedule below applies once it's Live."
      : delivery === "test"
        ? "WhatsApp delivery is in Test — only manual sends, to your test numbers. The schedule below applies once it's Live."
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
          <p>When OP lab reports go out in Live mode: the delay after approval, the night hold and retries.</p>
        </div>
        <div className="al-hero-actions">
          <button
            type="button"
            className="al-hero-btn"
            onClick={sendAllPending}
           
            title={sendOff ? "Only in Live mode (WATI Settings → Delivery)" : "Send every pending report now"}
          >
            <SendIcon size={15} /> Send all pending now
          </button>
        </div>
      </header>

      <div className={`ms-callout ${sendOff ? "is-warn" : "is-live"}`}>
        {sendOff ? <AlertIcon size={15} /> : <WhatsAppIcon size={15} />}
        <span>{summary}</span>
        <Link className="ms-link" to="/wati">
          Off / Test / Live
        </Link>
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

        <Section icon={WhatsAppIcon} title="When reports go out" intro="In Live mode. Turning WhatsApp Off / Test / Live is on WATI Settings → Delivery.">
          <div className="ms-rows">
            <Row label="When" help={daily ? "Everything pending goes out together at one time." : "Each report on its own, a set time after approval."}>
              <Seg
                label="Send mode"
                value={daily ? "END_OF_DAY" : "AFTER_READY"}
                onChange={set("mode")}
                options={[
                  { value: "AFTER_READY", label: "After approval" },
                  { value: "END_OF_DAY", label: "Once a day" },
                ]}
              />
            </Row>
            {daily ? (
              <Row label="Daily send time" help="India time.">
                <input type="time" className="op-time" value={draft.endOfDayTime || "18:00"} onChange={(e) => set("endOfDayTime")(e.target.value)} />
              </Row>
            ) : (
              <Row label="Send after approval" help="The wait gives the lab time to correct a result before the patient sees it.">
                <Num label="Hours after approval" value={draft.sendDelayHours ?? 3} onChange={set("sendDelayHours")} min={0} max={48} step={0.5} unit="hours" />
              </Row>
            )}
            <Row label="Night hold" help="No WhatsApp at night; anything due then goes out when the hold ends.">
              <Bool value={draft.quietHoursEnabled} onChange={set("quietHoursEnabled")} label="Night hold" />
            </Row>
            {draft.quietHoursEnabled && (
              <Row label="No sends between" help="India time.">
                <div className="op-time-range">
                  <input type="time" className="op-time" value={draft.quietStart || "21:00"} onChange={(e) => set("quietStart")(e.target.value)} />
                  <span>and</span>
                  <input type="time" className="op-time" value={draft.quietEnd || "07:00"} onChange={(e) => set("quietEnd")(e.target.value)} />
                </div>
              </Row>
            )}
            <Row label="Don't send automatically if approved more than" help="Old reports wait for staff to send them by hand from the queue.">
              <Num label="Automatic send age limit" value={draft.maxAutoSendAgeHours ?? 24} onChange={set("maxAutoSendAgeHours")} min={1} max={168} unit="hours ago" />
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

        <Section icon={FilePdfIcon} title="WATI template" intro="The approved template every OP lab report is sent with.">
          <div className="ms-rows">
            <Row label="WATI template name" help="Exactly as approved in WATI (a–z, 0–9 and _).">
              <input className="op-text" value={draft.watiTemplateName || ""} onChange={(e) => set("watiTemplateName")(e.target.value)} placeholder="mapims_lab_rpt" />
            </Row>
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
