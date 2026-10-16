import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { displayPhone } from "../lib/phone.js";
import { RefreshIcon } from "../portal/Icons.jsx";
import { fmtDateTime } from "./ui.jsx";

/** WhatsApp's own ticks: ✓ sent, ✓✓ delivered, blue ✓✓ read, red for failed. */
export function Ticks({ status }) {
  const s = String(status || "").toUpperCase();
  if (s === "FAILED") return <span className="op-ticks is-failed" title="Not delivered">✕</span>;
  if (s === "READ") return <span className="op-ticks is-read" title="Read">✓✓</span>;
  if (s === "DELIVERED") return <span className="op-ticks is-delivered" title="Delivered">✓✓</span>;
  return <span className="op-ticks" title="Sent — waiting for the phone">✓</span>;
}

const LABEL = { SENT: "Sent — not on the phone yet", DELIVERED: "Delivered to the phone", READ: "Read", FAILED: "Not delivered" };

/** One message's state with its times: Sent → Delivered → Read. */
export function TickSteps({ message }) {
  const s = String(message?.status || "SENT").toUpperCase();
  const reached = (step) => (step === "SENT" ? true : step === "DELIVERED" ? Boolean(message?.deliveredAt) || s === "DELIVERED" || s === "READ" : s === "READ");
  return (
    <ol className="op-steps">
      {[
        ["SENT", "Sent (✓)", message?.sentAt],
        ["DELIVERED", "Delivered (✓✓)", message?.deliveredAt],
        ["READ", "Read (blue ✓✓)", message?.readAt],
      ].map(([key, label, at]) => (
        <li key={key} className={reached(key) ? `is-done ${key === "READ" ? "is-read" : ""}` : ""}>
          <i />
          <b>{label}</b>
          <span>{reached(key) ? (at ? fmtDateTime(at) : "yes") : "waiting…"}</span>
        </li>
      ))}
      {s === "FAILED" && (
        <li className="is-failed">
          <i />
          <b>Not delivered</b>
          <span>{message?.errorReason || "WhatsApp couldn't deliver it"}</span>
        </li>
      )}
    </ol>
  );
}

// Seconds after sending to ask WATI again — 6 calls at most, then "Check again".
const POLL_AT = [4, 10, 20, 40, 70, 120];

/**
 * Live ticks for messages just sent: asks WATI a few times in the first two
 * minutes (each ask is one WATI API call), then stops; "Check again" asks once more.
 */
export function LiveTicks({ messageIds = [], phones = [] }) {
  const [messages, setMessages] = useState(() => messageIds.map((id, i) => ({ id, status: "SENT", phone: phones[i], sentAt: new Date().toISOString() })));
  const [checking, setChecking] = useState(false);
  const [round, setRound] = useState(0);
  const [note, setNote] = useState("");
  const started = useRef(Date.now());

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const results = await Promise.all(messageIds.map((id) => api.checkOpMessage(id).catch((e) => ({ error: e.message }))));
      setMessages((prev) => prev.map((m, i) => (results[i]?.message ? { ...m, ...results[i].message } : m)));
      const err = results.find((r) => r.error)?.error;
      const nf = results.find((r) => r.result && !r.result.found);
      setNote(err ? err : nf ? "WATI hasn't listed this message yet — it usually appears within a minute." : "");
    } finally {
      setChecking(false);
      setRound((r) => r + 1);
    }
  }, [messageIds]);

  const done = messages.length > 0 && messages.every((m) => ["READ", "FAILED"].includes(String(m.status).toUpperCase()));

  useEffect(() => {
    if (done || round >= POLL_AT.length || !messageIds.length) return undefined;
    const wait = Math.max(0, POLL_AT[round] * 1000 - (Date.now() - started.current));
    const t = setTimeout(check, wait);
    return () => clearTimeout(t);
  }, [round, done, check, messageIds.length]);

  return (
    <div className="op-live-ticks">
      {messages.map((m) => (
        <div key={m.id} className="op-live-msg">
          <div className="op-live-head">
            <Ticks status={m.status} />
            <b>{LABEL[String(m.status).toUpperCase()] || "Sent"}</b>
            <span>to {displayPhone(m.phone)}</span>
          </div>
          <TickSteps message={m} />
        </div>
      ))}
      <div className="op-live-foot">
        <span>
          {done
            ? "Final — nothing more to wait for."
            : round < POLL_AT.length
              ? `Asking WATI… (${round}/${POLL_AT.length})`
              : "Stopped asking automatically. Ticks also update in the Monitor."}
          {note ? ` ${note}` : ""}
        </span>
        {!done && (
          <button type="button" className="btn btn-secondary op-send-btn" onClick={check} disabled={checking}>
            <RefreshIcon size={13} spinning={checking} /> {checking ? "Checking…" : "Check again"}
          </button>
        )}
      </div>
    </div>
  );
}
