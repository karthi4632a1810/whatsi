import { useEffect, useState } from "react";
import { displayPhone } from "../lib/phone.js";
import { SendIcon } from "../portal/Icons.jsx";

/** Test send mode: pick the one test contact a report goes to (never the patient). */
export default function WatiTestSendModal({ open, onClose, onConfirm, contacts = [], reportLabel = "", busy = false }) {
  const [selectedPhone, setSelectedPhone] = useState("");

  useEffect(() => {
    if (!open) {
      setSelectedPhone("");
      return;
    }
    if (contacts.length === 1) setSelectedPhone(contacts[0].phone);
  }, [open, contacts]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => event.key === "Escape" && !busy && onClose?.();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <div className="um-modal-backdrop" role="presentation" onMouseDown={busy ? undefined : onClose}>
      <div className="um-modal op-send-modal" role="dialog" aria-modal="true" aria-label="Choose WATI test contact" onMouseDown={(e) => e.stopPropagation()}>
        <h3>
          <SendIcon size={18} /> Test send
        </h3>
        <p>{reportLabel ? `Send ${reportLabel} to one test contact — not to the patient.` : "Send to one test contact — not to the patient."}</p>
        {contacts.length ? (
          <div className="op-contact-list" role="radiogroup" aria-label="WATI test contacts">
            {contacts.map((contact) => (
              <label key={contact.phone} className={`op-contact ${selectedPhone === contact.phone ? "is-on" : ""}`}>
                <input
                  type="radio"
                  name="wati-test-contact"
                  value={contact.phone}
                  checked={selectedPhone === contact.phone}
                  onChange={() => setSelectedPhone(contact.phone)}
                  disabled={busy}
                />
                <span>
                  <b>{contact.name}</b>
                  <small>{displayPhone(contact.phone)}</small>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-muted">No test contacts yet — add them in Settings → Sending schedule.</p>
        )}
        <div className="um-modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => selectedPhone && onConfirm?.([selectedPhone])} disabled={!selectedPhone || busy}>
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
