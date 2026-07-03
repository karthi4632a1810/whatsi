import { useEffect, useState } from "react";
import { displayPhone } from "../lib/phone.js";

export default function WatiTestSendModal({
  open,
  onClose,
  onConfirm,
  contacts = [],
  reportLabel = "",
  busy = false,
}) {
  const [selectedPhone, setSelectedPhone] = useState("");

  useEffect(() => {
    if (!open) {
      setSelectedPhone("");
      return;
    }
    if (contacts.length === 1) {
      setSelectedPhone(contacts[0].phone);
    }
  }, [open, contacts]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape" && !busy) onClose?.();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  function handleConfirm() {
    if (!selectedPhone) return;
    onConfirm?.([selectedPhone]);
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={busy ? undefined : onClose}>
      <div
        className="modal-panel modal-panel--send"
        role="dialog"
        aria-modal="true"
        aria-label="Choose WATI test contact"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h3 className="modal-title">Choose WATI contact</h3>
            <p className="muted modal-subtitle">
              {reportLabel
                ? `Send ${reportLabel} to one test contact — not the patient phone.`
                : "Send to one test contact — not the patient phone."}
            </p>
          </div>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" onClick={handleConfirm} disabled={!selectedPhone || busy}>
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </header>
        <div className="modal-body modal-body--send">
          {contacts.length ? (
            <div className="wati-send-contact-list" role="radiogroup" aria-label="WATI contacts">
              {contacts.map((contact) => (
                <label key={contact.phone} className="wati-send-contact-option">
                  <input
                    type="radio"
                    name="wati-test-contact"
                    value={contact.phone}
                    checked={selectedPhone === contact.phone}
                    onChange={() => setSelectedPhone(contact.phone)}
                    disabled={busy}
                  />
                  <span className="wati-send-contact-option__body">
                    <strong>{contact.name}</strong>
                    <span className="muted td-mono">{displayPhone(contact.phone)}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="muted">No test contacts configured. Add contacts in Settings first.</p>
          )}
        </div>
      </div>
    </div>
  );
}
