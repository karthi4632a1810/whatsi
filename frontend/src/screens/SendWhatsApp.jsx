import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { formatPatientName } from "../lib/format.js";
import { displayPhone, normalizePhone } from "../lib/phone.js";
import { track } from "../portal/audit.js";
import { AlertIcon, FilePdfIcon, WhatsAppIcon } from "../portal/Icons.jsx";
import { prettyPhone } from "./ui.jsx";

const isMobile = (digits) => /^\d{11,15}$/.test(digits);
const MODE_TEXT = {
  live: "Live mode — the patient's mobile",
  test: "Test mode — your test number",
  off: "WhatsApp delivery is Off",
};

/**
 * The portal's "Send on WhatsApp" popup for one OP order: the number it goes
 * to before anything is sent — the patient's mobile (editable) when Live, one
 * of the test numbers in Test mode.
 */
function SendDialog({ order, delivery, canChangeMode, onCancel, onSent }) {
  const mode = delivery?.mode || "off";
  const testPhones = delivery?.testPhones || [];
  const defaultNumber = normalizePhone(order.phone || "");
  const [number, setNumber] = useState(() => prettyPhone(defaultNumber));
  const [saveNumber, setSaveNumber] = useState(true);
  const [testPhone, setTestPhone] = useState(testPhones[0] || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const digits = normalizePhone(number);
  const edited = mode === "live" && digits !== defaultNumber;
  const alreadySent = order.whatsappTone === "sent";
  const partial = order.readiness === "PARTIAL";
  const strictPartial = partial && (delivery?.readinessRule || "STRICT") === "STRICT";
  const numberOk = mode !== "live" || isMobile(digits);
  const canSubmit = mode !== "off" && numberOk && (mode !== "test" || testPhone) && !busy;
  const name = formatPatientName(order.patientName);

  const cancel = () => {
    track("whatsapp_popup_cancel", { screen: "reports", target: { orderId: String(order.orderId), patientName: order.patientName, uhid: order.patientId }, details: { numberEdited: edited } });
    onCancel();
  };

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !busy && cancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, edited]);

  async function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      if (edited && saveNumber && order.patientId) {
        await api.saveContactByUhid(order.patientId, { phoneOverride: digits, name: order.patientName });
      }
      const result = await api.sendOpOrder(order.orderId, {
        day: order.reportDay,
        // A test can go again any time; a patient resend or a partly approved report only when the popup said so.
        force: mode === "test" || alreadySent || strictPartial || order.whatsappStatus === "NEEDS_REVIEW",
        ...(mode === "test" ? { testContactPhones: [testPhone] } : {}),
        ...(edited ? { toPhone: digits } : {}),
      });
      const to = (result.sentPhones || []).map(displayPhone).join(", ") || (mode === "test" ? displayPhone(testPhone) : prettyPhone(digits));
      onSent(`${mode === "test" ? "Test sent" : "Sent"} to ${to} — ${name}'s lab report`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  // On <body>: a popup inside the table would scroll with it.
  return createPortal(
    <div className="um-modal-backdrop" onMouseDown={() => !busy && cancel()}>
      <form className="um-modal wa-send op-send-dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit} aria-label="Send on WhatsApp">
        <h3>
          <WhatsAppIcon size={18} /> Send on WhatsApp
        </h3>
        <div className="wa-send-patient">
          <b>{name}</b>
          <span>
            UHID {order.patientId} · order {order.orderId}
            {order.department ? ` · ${order.department}` : ""}
          </span>
        </div>
        <span className={`wa-send-mode ${mode === "live" ? "is-live" : mode === "test" ? "is-test" : "is-off"}`}>{MODE_TEXT[mode]}</span>

        {mode === "off" && (
          <div className="wa-send-error is-block">
            <AlertIcon size={13} /> Nothing can be sent while delivery is Off.{" "}
            {canChangeMode ? (
              <>
                Switch to Test or Live in <Link to="/wati">WATI Settings → Delivery</Link>.
              </>
            ) : (
              "Ask someone with WATI Settings access to switch it to Test or Live."
            )}
          </div>
        )}

        {mode === "live" && (
          <>
            <label className="wa-send-field">
              <span>WhatsApp number</span>
              <input
                value={number}
                onChange={(e) => {
                  setNumber(e.target.value);
                  setError("");
                }}
                inputMode="tel"
                placeholder="+91 98765 43210"
                autoFocus
                aria-invalid={!numberOk}
              />
            </label>
            {!numberOk && number && <div className="wa-send-error">Enter a 10-digit mobile number, or one with its country code.</div>}
            {!defaultNumber && <div className="wa-send-error">No mobile number in HIS for this patient — type one.</div>}
            {edited && numberOk && (
              <>
                <label className="um-inline-check op-save-number">
                  <input type="checkbox" checked={saveNumber} onChange={(e) => setSaveNumber(e.target.checked)} />
                  <span>Also save it as this patient's WhatsApp number (WATI Settings → Contacts)</span>
                </label>
                {defaultNumber && (
                  <button type="button" className="op-link wa-send-reset" onClick={() => setNumber(prettyPhone(defaultNumber))}>
                    Use {prettyPhone(defaultNumber)} from HIS instead
                  </button>
                )}
              </>
            )}
          </>
        )}

        {mode === "test" &&
          (testPhones.length ? (
            <div className="op-contact-list" role="radiogroup" aria-label="Test number">
              {testPhones.map((p) => (
                <label key={p} className={`op-contact ${testPhone === p ? "is-on" : ""}`}>
                  <input type="radio" name="test-phone" checked={testPhone === p} onChange={() => setTestPhone(p)} />
                  <span>
                    <b>{displayPhone(p)}</b>
                    <small>Test number — the patient gets nothing</small>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <div className="wa-send-error is-block">
              No test number yet. {canChangeMode ? <Link to="/wati">Add one in WATI Settings → Delivery.</Link> : "Ask someone with WATI Settings access to add one."}
            </div>
          ))}

        {mode === "live" && alreadySent && (
          <div className="op-warn op-send-warn">
            <b>Already sent</b> ({order.whatsappLabel}). Send again only if the patient asked for it.
          </div>
        )}
        {mode !== "off" && strictPartial && (
          <div className="op-warn op-send-warn">
            Only {order.approvedCount} of {order.procedureTotal} results are approved — the PDF has the approved ones; the rest will be missing.
          </div>
        )}

        <div className="wa-send-docs">
          <span>
            <FilePdfIcon size={13} /> Lab report (AOSTA){partial ? ` · ${order.approvedCount}/${order.procedureTotal} approved` : ""}
          </span>
        </div>
        <p className="wa-send-note">
          Template <code>{delivery?.templateName || "mapims_lab_rpt"}</code> with the PDF link.
        </p>
        {error && <div className="wa-send-error is-block">{error}</div>}
        <div className="um-modal-actions">
          <button type="button" className="btn btn-secondary" onClick={cancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary wa-send-btn" disabled={!canSubmit}>
            {busy ? "Sending…" : mode === "test" ? "Send test" : alreadySent ? "Send again" : "Send"}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

/** The green WhatsApp button on a report row; opens the popup above. */
export function SendWhatsAppButton({ order, delivery, canChangeMode = false, onSent }) {
  const [open, setOpen] = useState(false);
  const mode = delivery?.mode || "off";
  const sent = order.whatsappTone === "sent";
  const title =
    mode === "off"
      ? "WhatsApp delivery is Off — open to see how to send"
      : `${sent ? "Send again" : "Send"} ${formatPatientName(order.patientName)}'s lab report on WhatsApp${mode === "test" ? " (test number)" : ""}`;

  return (
    <>
      <button
        type="button"
        className={`btn btn-icon-only ${sent ? "btn-whatsapp-sent" : "btn-send-whatsapp"} ${mode === "off" ? "op-wa-off" : ""}`}
        title={title}
        aria-label={title}
        onClick={(e) => {
          e.stopPropagation();
          track("whatsapp_click", { screen: "reports", target: { orderId: String(order.orderId), patientName: order.patientName, uhid: order.patientId }, details: { mode } });
          setOpen(true);
        }}
      >
        <WhatsAppIcon size={15} />
      </button>
      {open && (
        <SendDialog
          order={order}
          delivery={delivery}
          canChangeMode={canChangeMode}
          onCancel={() => setOpen(false)}
          onSent={(message) => {
            setOpen(false);
            onSent?.(message);
          }}
        />
      )}
    </>
  );
}
