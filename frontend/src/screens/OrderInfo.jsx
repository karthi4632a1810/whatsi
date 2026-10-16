import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api.js";
import { formatPatientName } from "../lib/format.js";
import { displayPhone } from "../lib/phone.js";
import { track } from "../portal/audit.js";
import { ClockIcon, CloseIcon, InfoIcon, RefreshIcon, WhatsAppIcon } from "../portal/Icons.jsx";
import { Ticks, TickSteps } from "./Ticks.jsx";
import { HisStatusPill, Loading, Pill, QueuePill, ReadyPill, fmtDateTime } from "./ui.jsx";

const dmy = (iso) => String(iso || "").split("-").reverse().join("-");
const STAGE_TONE = { read: "wa", delivered: "wa", sent: "ok", failed: "bad", no_phone: "bad", review: "warn", sending: "info", excluded: "muted" };
const TRIGGER = { MANUAL: "by hand", AUTO_DELAYED: "automatic", AUTO_EOD: "daily send", AUTO_RETRY: "automatic retry", AUTO_IMMEDIATE: "automatic", WEBHOOK: "HIS push" };

function Fact({ label, children }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children || "—"}</dd>
    </div>
  );
}

/** Everything about one OP order: status, patient, tests, queue, WhatsApp messages and ticks, timeline. */
function OrderPanel({ orderId, day, canCheck, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState("");

  const load = useCallback(() => {
    api
      .opOrder(orderId, day)
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [orderId, day]);

  useEffect(() => {
    load();
    const t = setInterval(() => !document.hidden && load(), 20_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function checkTicks(id) {
    setChecking(id);
    try {
      await api.checkOpMessage(id);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setChecking("");
    }
  }

  const p = data?.patient || {};
  const q = data?.queue;
  const stage = data?.stage;

  return createPortal(
    <div className="um-drawer-backdrop" onMouseDown={onClose}>
      <aside className="um-drawer op-info" onMouseDown={(e) => e.stopPropagation()} aria-label={`Details of order ${orderId}`}>
        <header className="um-drawer-head">
          <span className="op-info-icon">
            <InfoIcon size={20} />
          </span>
          <div>
            <h3>{p.name ? formatPatientName(p.name) : `Order ${orderId}`}</h3>
            <p>
              UHID {p.patientId || "—"} · order {orderId}
              {data?.labDay ? ` · lab day ${dmy(data.labDay)}` : ""}
            </p>
          </div>
          <button type="button" className="um-icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="um-drawer-body">
          {error && <div className="wa-send-error is-block">{error}</div>}
          {!data && !error && <Loading>Loading the order…</Loading>}
          {data && (
            <>
              <section className="um-section">
                <h4>Where it stands</h4>
                <div className="op-info-stage">
                  {stage && <Pill tone={STAGE_TONE[stage.key] || "info"}>{stage.label}</Pill>}
                  <span>{stage?.detail}</span>
                </div>
                <div className="op-pill-row">
                  {data.hisStatus && <HisStatusPill status={data.hisStatus} />}
                  <ReadyPill readiness={data.readiness} extra={`${data.approvedCount}/${data.procedureTotal}`} />
                  {q && <QueuePill status={q.status} />}
                </div>
                {data.plannedSendAt && (
                  <p className="op-info-note">
                    <ClockIcon size={13} /> Goes out on WhatsApp at <b>{fmtDateTime(data.plannedSendAt)}</b>
                  </p>
                )}
              </section>

              <section className="um-section">
                <h4>Patient</h4>
                <dl className="op-facts">
                  <Fact label="Age / gender">{[data.age, data.gender].filter(Boolean).join(" · ")}</Fact>
                  <Fact label="Department">{p.department}</Fact>
                  <Fact label="Doctor">{data.doctor}</Fact>
                  <Fact label="Patient type">{p.patientType}</Fact>
                  <Fact label="Mobile in HIS">{p.emrPhone ? displayPhone(p.emrPhone) : ""}</Fact>
                  <Fact label="WhatsApp goes to">
                    {p.phone ? displayPhone(p.phone) : ""}
                    {p.phoneOverride ? <small> (set in Contacts)</small> : null}
                  </Fact>
                  <Fact label="Ordered">{fmtDateTime(data.requestDate)}</Fact>
                  <Fact label="Last result">{fmtDateTime(data.completedAt)}</Fact>
                </dl>
              </section>

              <section className="um-section">
                <h4>
                  Tests · {data.approvedCount} of {data.procedureTotal} approved
                </h4>
                <div className="op-lines">
                  {(data.lines?.length ? data.lines : []).map((l, i) => (
                    <div key={`${l.group}-${l.test}-${i}`} className={`op-line ${l.status === "RESULT APPROVED" ? "is-done" : ""}`}>
                      <span className="op-line-name">
                        {l.test}
                        {l.group && <small>{l.group}</small>}
                      </span>
                      <span className="op-line-result">{l.result || <span className="text-muted">—</span>}</span>
                      <HisStatusPill status={l.status} />
                    </div>
                  ))}
                  {!data.lines?.length &&
                    (data.tests || []).map((t) => (
                      <div key={t.name} className={`op-line ${t.approved === t.total ? "is-done" : ""}`}>
                        <span className="op-line-name">{t.name}</span>
                        <span className="op-line-result">
                          {t.approved}/{t.total}
                        </span>
                      </div>
                    ))}
                </div>
              </section>

              <section className="um-section">
                <h4>
                  <WhatsAppIcon size={15} /> WhatsApp messages
                </h4>
                {q && (
                  <dl className="op-facts">
                    <Fact label="Queue">{String(q.status || "").toLowerCase()}</Fact>
                    <Fact label="Attempts">{q.attempts}</Fact>
                    {q.lastError && <Fact label="Last error">{q.lastError}</Fact>}
                    {q.nextRetryAt && <Fact label="Next retry">{fmtDateTime(q.nextRetryAt)}</Fact>}
                  </dl>
                )}
                {!data.messages?.length && <p className="op-info-note">Nothing sent yet.</p>}
                {(data.messages || []).map((m) => (
                  <div key={m.id} className="op-msg">
                    <div className="op-live-head">
                      <Ticks status={m.status} />
                      <b>{displayPhone(m.phone)}</b>
                      {m.testSend && <Pill tone="warn">test</Pill>}
                      <span>
                        {fmtDateTime(m.sentAt)} · {TRIGGER[m.triggerType] || m.triggerType}
                        {m.sentBy ? ` · ${m.sentBy}` : ""}
                      </span>
                    </div>
                    <TickSteps message={m} />
                    <div className="op-msg-foot">
                      <span>{m.lastCheckedAt ? `WATI last asked ${fmtDateTime(m.lastCheckedAt)}` : "Not asked WATI yet"}</span>
                      {canCheck && !["READ", "FAILED"].includes(String(m.status).toUpperCase()) && (
                        <button type="button" className="btn btn-secondary op-send-btn" onClick={() => checkTicks(m.id)} disabled={checking === m.id}>
                          <RefreshIcon size={13} spinning={checking === m.id} /> {checking === m.id ? "Checking…" : "Check ticks"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </section>

              {data.timeline?.length > 0 && (
                <section className="um-section">
                  <h4>Timeline</h4>
                  <ol className="op-timeline">
                    {data.timeline.map((t, i) => (
                      <li key={i} className={`is-${t.tone || "info"} ${t.future ? "is-future" : ""}`}>
                        <i />
                        <b>{t.label}</b>
                        <span>
                          {fmtDateTime(t.at)}
                          {t.detail ? ` · ${t.detail}` : ""}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </>
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
}

/** The ⓘ button on a report row. */
export function OrderInfoButton({ order, canCheck = false }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn-icon-only op-info-btn"
        title={`Full status of ${formatPatientName(order.patientName)}'s order`}
        aria-label="Full status"
        onClick={(e) => {
          e.stopPropagation();
          track("order_open", { screen: "reports", target: { orderId: String(order.orderId), patientName: order.patientName, uhid: order.patientId } });
          setOpen(true);
        }}
      >
        <InfoIcon size={15} />
      </button>
      {open && <OrderPanel orderId={String(order.orderId)} day={order.reportDay} canCheck={canCheck} onClose={() => setOpen(false)} />}
    </>
  );
}
