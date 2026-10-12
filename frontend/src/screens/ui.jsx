import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "../portal/audit.js";
import { CheckIcon, CopyIcon } from "../portal/Icons.jsx";

/** An ID that copies itself on click (order, UHID, mobile) — the portal's copy chip. */
export function CopyableChip({ value, label, className = "", onToast, iconOnly = false, screen = "reports" }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-muted">—</span>;

  async function handleCopy(e) {
    e.preventDefault();
    e.stopPropagation();
    track("copy", { screen, details: { label: label || "value", value: String(value).slice(0, 40) } });
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      onToast?.(`Copied ${label ? `${label} ` : ""}${value}`);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard blocked (http) — nothing to do
    }
  }

  return (
    <button
      type="button"
      className={`copyable-chip ${className} ${copied ? "is-copied" : ""}`}
      onClick={handleCopy}
      title={copied ? "Copied to clipboard!" : `Click to copy ${label ? `${label}: ` : ""}${value}`}
      aria-label={`Copy ${label || ""} ${value}`}
    >
      {!iconOnly && <span className="copyable-text">{value}</span>}
      <span className="copyable-indicator" aria-hidden="true">
        {copied ? <CheckIcon size={12} className="copy-icon-copied" /> : <CopyIcon size={11} className="copy-icon-idle" />}
      </span>
      {copied && <span className="copy-bubble-tag">Copied!</span>}
    </button>
  );
}

/** One short message at the bottom of the screen that goes away by itself. */
export function useToast(ms = 3500) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const show = useCallback(
    (message, tone = "ok") => {
      setToast({ message, tone });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setToast(null), ms);
    },
    [ms]
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  return [toast, show, () => setToast(null)];
}

export function Toast({ toast, onDismiss }) {
  if (!toast) return null;
  return (
    <div className="portal-toast-container no-print" role="status" aria-live="polite">
      <div className={`portal-toast ${toast.tone === "error" ? "is-error" : ""}`}>
        <div className="toast-icon">
          <CheckIcon size={16} />
        </div>
        <div className="toast-message">{toast.message}</div>
        <button type="button" className="toast-dismiss-btn" onClick={onDismiss} aria-label="Dismiss notification">
          ×
        </button>
      </div>
    </div>
  );
}

export function Loading({ children = "Loading…" }) {
  return (
    <div className="loading modern-loading">
      <div className="spinner" />
      <div>{children}</div>
    </div>
  );
}

export function Empty({ icon = "📂", title, children, actions }) {
  return (
    <div className="empty modern-empty">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {children ? <p className="empty-subtitle">{children}</p> : null}
      {actions ? <div className="filter-empty-actions">{actions}</div> : null}
    </div>
  );
}

export function ErrorBox({ title = "Something went wrong", children, onRetry }) {
  if (!children) return null;
  return (
    <div className="error modern-error-alert" role="alert">
      <div className="alert-icon">⚠️</div>
      <div className="alert-body">
        <strong>{title}</strong>
        <div>{children}</div>
        {onRetry ? (
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

const HIS_TONE = {
  "RESULT APPROVED": "ok",
  COMPLETED: "ok",
  "RESULT ENTERED": "info",
  "IN PROCESS": "warn",
  "DEPT RECEIVE PENDING": "muted",
  "SPECIMEN YET TO BE COLLECTED": "muted",
};
const READY_TONE = { READY: "ok", PARTIAL: "warn", WAITING: "muted" };
const QUEUE_TONE = { SENT: "ok", PENDING: "info", QUEUED: "info", FAILED: "bad", NEEDS_REVIEW: "warn" };

/** A coloured pill. tone: ok | info | warn | bad | muted | wa */
export function Pill({ tone = "muted", children, title }) {
  return (
    <span className={`op-pill is-${tone}`} title={title}>
      {children}
    </span>
  );
}

export const HisStatusPill = ({ status }) => <Pill tone={HIS_TONE[status] || "muted"}>{String(status || "—").toLowerCase()}</Pill>;
export const ReadyPill = ({ readiness, extra }) => (
  <Pill tone={READY_TONE[readiness] || "muted"}>
    {String(readiness || "—").toLowerCase()}
    {extra ? ` ${extra}` : ""}
  </Pill>
);
export const QueuePill = ({ status }) => <Pill tone={QUEUE_TONE[status] || "muted"}>{status === "NEEDS_REVIEW" ? "check needed" : String(status || "—").toLowerCase()}</Pill>;

/** WhatsApp state from the board (whatsappTone: idle | pending | sent | failed | test). */
export function WaPill({ label, tone }) {
  const map = { sent: "wa", pending: "info", failed: "bad", test: "muted", idle: "muted" };
  return <Pill tone={map[tone] || "muted"}>{label || "Not queued"}</Pill>;
}

/** "+91 98765 43210" for 919876543210 / 9876543210. */
export function prettyPhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  const ten = d.length === 12 && d.startsWith("91") ? d.slice(2) : d.length === 10 ? d : "";
  return ten ? `+91 ${ten.slice(0, 5)} ${ten.slice(5)}` : raw || "";
}

export function fmtDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
}

export function fmtTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
}
