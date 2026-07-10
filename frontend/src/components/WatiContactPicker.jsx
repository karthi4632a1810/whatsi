import { useState } from "react";
import { displayPhone, normalizePhone } from "../lib/phone.js";

export default function WatiContactPicker({
  contacts,
  selectedPhones = [],
  onChange,
  loading = false,
  contactsError = "",
}) {
  const [draft, setDraft] = useState("");

  function toggle(phone, checked) {
    const set = new Set(selectedPhones);
    if (checked) set.add(phone);
    else set.delete(phone);
    onChange([...set]);
  }

  function addManualPhone() {
    const phone = normalizePhone(draft);
    if (!phone) return;
    if (!selectedPhones.includes(phone)) {
      onChange([...selectedPhones, phone]);
    }
    setDraft("");
  }

  function removePhone(phone) {
    onChange(selectedPhones.filter((p) => p !== phone));
  }

  const contactPhones = new Set(contacts.map((c) => c.phone));
  const manualOnly = selectedPhones.filter((phone) => !contactPhones.has(phone));

  return (
    <div className="wati-test-recipients">
      {loading ? <p className="muted">Loading WATI contacts…</p> : null}

      {!loading && contacts.length ? (
        <div className="wati-contact-picker" role="group" aria-label="WATI contacts">
          {contacts.map((contact) => (
            <label key={contact.id || contact.phone} className="wati-contact-option">
              <input
                type="checkbox"
                checked={selectedPhones.includes(contact.phone)}
                onChange={(e) => toggle(contact.phone, e.target.checked)}
              />
              <span className="wati-contact-option__body">
                <strong>{contact.name}</strong>
                <span className="muted td-mono">{contact.phone}</span>
                {contact.contactStatus ? (
                  <span className="wati-contact-option__status">{contact.contactStatus}</span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      ) : null}

      {!loading && !contacts.length ? (
        <p className="muted">
          {contactsError ||
            "Add test numbers below (10-digit or with country code). WATI is only called when sending a report."}
        </p>
      ) : null}

      <div className="wati-manual-phones">
        <p className="field-hint">
          {contacts.length
            ? "Or add numbers manually (10-digit or with country code):"
            : "Add test numbers manually (10-digit or with country code):"}
        </p>
        <div className="wati-manual-phones__row">
          <input
            type="tel"
            inputMode="numeric"
            placeholder="e.g. 9384508490"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addManualPhone();
              }
            }}
          />
          <button type="button" className="secondary" onClick={addManualPhone}>
            Add
          </button>
        </div>
        {manualOnly.length || selectedPhones.length ? (
          <ul className="wati-phone-chips" aria-label="Selected test numbers">
            {selectedPhones.map((phone) => (
              <li key={phone} className="wati-phone-chip">
                <span className="td-mono">{displayPhone(phone)}</span>
                <button
                  type="button"
                  className="wati-phone-chip__remove"
                  onClick={() => removePhone(phone)}
                  aria-label={`Remove ${displayPhone(phone)}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
