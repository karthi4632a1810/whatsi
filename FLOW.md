# whatsi — How a lab report reaches the patient (new flow)

Updated 2026-10-06. This file explains what changed in the **flow** (the work behind the
screens). The screens are the same old left-menu screens; only Settings, WhatsApp Queue and
HIS Lab Today show a few new things (listed at the end).

---

## 1. Before and now

| | Before | Now |
|---|---|---|
| Which patients | OP + IP (scope setting) | **OP only.** IP discharges are handled by the investigation-chart portal |
| When WhatsApp goes out | Once a day at 6 PM, all together | **3 hours after the last result is approved**, one report at a time |
| Night | Could send any time | **Night hold:** nothing between 9 PM and 7 AM; held reports go at 7 AM |
| Old reports | 6 PM batch sent everything pending, any age | Approved **more than 24 hours ago** → not sent automatically, staff send by hand |
| Same report sent twice | Possible (6 PM batch + retry job at the same minute) | **Not possible:** each report is "claimed" before sending |
| App restarted at 6 PM | That day's batch waited until the next evening | Sender catches up on the next minute |
| Delivered / Read | Never recorded | Recorded (WATI webhook, or a few status checks) |
| Results changed after queueing | Old report could still go out | Report is **held** until all results are approved again |
| Report PDF | Official EMR lab report PDF + template `mapims_lab_rpt` | **Same** (optionally through a private link, see section 8) |

---

## 2. The flow, step by step

```
 HIS / EMR                 whatsi                                        WATI / patient
 ─────────                 ──────                                        ──────────────
 lab orders ──(every 15 min)──► 1. HIS check: keep OP orders only
                                2. Board: In lab / Partial / Ready
                                3. Queue: READY orders → WhatsApp Queue (PENDING)
                                4. Wait: 3 h after last approval (+ night hold)
                         (every minute)
                                5. Sender: claim → send ──────────────────► template + PDF
                                6. Result: SENT / FAILED / Check needed
                         (webhook / every 2 min)
                                7. Ticks: Delivered → Read ◄────────────── WATI status
```

### Step 1 — HIS check (every 15 minutes)
- Runs only when **Automation enabled** is on in Settings.
- Reads today's lab orders from the EMR in 2-hour slices, plus the **last 3 days**
  (orders that became ready after their lab day).
- Keeps **OP orders only** (`IP/OP/OT` column = `OP`). IP orders are not stored.
- Manual way: **Refresh from HIS** / **Sync to queue** on HIS Lab Today.

### Step 2 — Board
Each order gets a readiness:

| Readiness | Meaning |
|---|---|
| WAITING | No result approved yet |
| PARTIAL | Some results approved |
| READY | **All** results approved |

### Step 3 — Queue
- READY orders go into the WhatsApp Queue as **PENDING**.
  (With the "Partial" readiness rule in Settings, PARTIAL orders go too.)
- **Z patients (patient type ZPATIENT) are never queued or sent.**
- The approval time is taken from the EMR "completed" time of the last result. If the EMR
  has none, the time whatsi first saw the order READY is used.

### Step 4 — Wait for the send time
- **Send time = last approval + 3 hours** (Settings → Send schedule → Hours after approval).
- If that time falls in the **night hold (9 PM – 7 AM)**, it moves to **7 AM**.
- Other mode: **Once a day** at a fixed time (the old 6 PM style) is still available in Settings.

| Approved at | Sent at |
|---|---|
| 11:00 AM | 2:00 PM |
| 4:30 PM | 7:30 PM |
| 8:00 PM | 7:00 AM next day |
| 3:00 AM | 7:00 AM |

### Step 5 — Sender (every minute)
Sends a report only when **all** of these are true:
1. **Message sending enabled** is on in Settings.
2. **Test send mode** is off.
3. Server `.env`: `WATI_SEND_ENABLED=true` and `WATI_TEST_MODE=false`.
4. Now is **not** in the night hold.
5. The report is OP, READY, has a phone number, is not a Z patient.
6. Its send time has passed, and it was approved **less than 24 hours ago**.

Then:
- The report is **claimed** first (PENDING → QUEUED in one database step). If two senders
  (the minute job, a staff click, "Send all pending") try the same report, only one wins.
- Only one batch runs at a time.
- The PDF link is resolved (procedure IDs from the EMR), then WATI `sendTemplateMessage`
  is called with the patient name and the PDF link.
- The WATI call has a **30-second limit**.

### Step 6 — Result of a send

| Result | What happens |
|---|---|
| WATI accepted | Report → **SENT**; message saved in the Message log with WATI's message id |
| Temporary problem (network, WATI limit 429, WATI error 5xx, PDF link not found yet) | Report → **FAILED**, retried automatically: after 15 min, then 30, 60 … (max 6 h between tries), **3 attempts** total, never in the night hold |
| Not on WhatsApp | Report → **FAILED**, **no** automatic retry |
| No phone number | Not sent; shows "No phone" — add a number in Contacts |
| WATI rejected (4xx, template problem) | Report → **FAILED**, no automatic retry |
| WATI did not answer in 30 s | Report → **NEEDS_REVIEW** ("Check needed") — WATI may have sent it, so it is **not** retried automatically |

### Step 7 — Delivered / Read ticks
- **WATI webhook** (best, free): WATI calls
  `/api/webhooks/wati/<secret key>` on sent / delivered / read / failed.
- **Status checks** (until the webhook works): whatsi asks WATI 30 min, 6 h and 24 h after
  sending, **max 100 checks a day** (Settings). They stop by themselves while the webhook
  is delivering events. The WATI quota is shared with the investigation-chart portal.
- If WATI later says "failed" (e.g. not on WhatsApp), the report becomes FAILED.

---

## 3. Queue statuses

| Status | Meaning | Staff action |
|---|---|---|
| PENDING | Waiting for its send time (note shows "Sends 2:30 pm", "Sending off", "Waiting for results" …) | Nothing, or **Send** to send now |
| QUEUED | Being sent right now | — |
| SENT | WATI accepted it (then Delivered / Read when known) | — |
| FAILED | Could not be sent (note shows why; retrying automatically if temporary) | Fix the cause, **Send** |
| NEEDS_REVIEW ("Check needed") | The app stopped in the middle of sending | Check the Message log first, then **Send** (asks to confirm) |

---

## 4. Special cases

| Case | Flow |
|---|---|
| A test is added or a result is changed after queueing | Report goes back to PARTIAL and **waits**. When all results are approved again, the 3 hours start from the new approval |
| A new test is added after the report was already sent | Report is queued again and the updated report goes out 3 h after the new approval |
| Staff add / fix a phone number in Contacts | Unsent reports use the new number; reports that failed for "no phone" or "not on WhatsApp" go back to PENDING |
| App was down for a few hours | On restart, reports that are due go out (outside the night hold); reports older than 24 h wait for staff |
| App stopped while sending | On restart those reports become **Check needed** (never sent twice blindly) |
| HIS refresh was running when the app stopped | Marked as stopped on restart, so the next refresh can run |
| Staff press **Send** before the 3 hours | Sent at once (manual send ignores the wait, still needs Message sending on) |
| Staff press **Send all pending now** | Sends every PENDING / retryable FAILED OP report now, one batch at a time |
| Test send mode on | Automatic sends pause; Send goes only to the test numbers |

---

## 5. Settings that control the flow

| Setting (Settings screen) | Default | Effect |
|---|---|---|
| Automation enabled | Off | HIS check every 15 min fills the queue |
| Message sending enabled | Off | Master switch — nothing goes to patients when off |
| Patient scope | OP only (fixed) | — |
| Readiness rule | Strict — all tests approved | Partial = send when any result is approved |
| Send schedule → Mode | After results are approved | Or "Once a day" at a fixed time |
| Hours after approval | 3 | 0–48 |
| Night hold | On, 9 PM – 7 AM | No sends in this window |
| Test send mode | Off | Sends only to test numbers |

Not on the screen (database defaults): auto-send age limit 24 h, 3 attempts, first retry
after 15 min, 100 status checks a day.

When the app first started with this version, the old setting "once a day at 6 PM" was
changed **once** to "3 hours after approval".

---

## 6. Background jobs

| Job | When | Does |
|---|---|---|
| HIS check | Every 15 min (only if Automation enabled) | Steps 1–3 for today + last 3 days |
| Sender | Every minute | Steps 5–6, plus marks sends stuck > 15 min as Check needed |
| Tick checks | Every 2 min | Step 7 (status checks, within the daily limit) |
| Startup clean-up | When the app starts | Stuck sends → Check needed; stuck HIS refresh reset; old IP orders removed from the board cache; old settings moved once |
| Backup | Every night 2 AM | MongoDB copy to `backups/`, 14 days kept |

---

## 7. Safety and security changes in the flow

- **No double sends** — claim before sending + one batch at a time (tested: 3 senders at
  once → 1 WhatsApp).
- **HIS webhook** `/api/webhooks/his/report-ready` is **off** unless `HIS_WEBHOOK_SECRET`
  is set, and it never takes the PDF link from the caller (the link is built from the
  order and procedure IDs).
- **Order IDs** are checked to be plain numbers before they reach any EMR query (blocks SQL
  injection).
- **Login**: random `JWT_SECRET`; 5 wrong passwords → 15 min lock; password change and
  "sign out everywhere" in the API end the user's other sessions.
- **MongoDB** needs a password and is reachable only from this machine; the app uses a
  limited user. The API port is also local-only (browsers go through port 1002).
- **Nightly backups** in `backups/` (restore tested).

## 8. Private report links (optional)

Set `PUBLIC_BASE_URL` in `.env` to whatsi's public https address. Then the PDF link sent to
the patient is a whatsi link that **expires after 2 days** (`REPORT_LINK_DAYS`), instead of
the EMR address that anyone can guess by changing the order number. whatsi fetches the PDF
from the EMR itself. When not set, the EMR link is sent as before.

---

## 9. What changed on the screens (only for the flow)

| Screen | Change |
|---|---|
| Settings | Patient scope fixed to OP only; Send schedule = hours after approval or once a day; Night hold from / until |
| WhatsApp Queue | Note under each status ("Sends 2:30 pm", "Sending off" …); new status "Check needed" |
| HIS Lab Today | WhatsApp column shows "Sends 2:30 pm" / "Delivered" / "Read"; top pills show the schedule and night hold |
| WhatsApp Monitor (new) | Same screen as the investigation portal's monitor, for OP reports: every message and its ticks, coverage of ready OP reports, needs attention, charts, Retry |

---

## 10. Where it is in the code

| Part | File |
|---|---|
| Send time, night hold, age limit, statuses, retry timing | `backend/src/utils/schedule.js` |
| Queue sync, claim + send, sender worker, recovery | `backend/src/services/reports.js` |
| OP-only board, EMR queries, order-ID checks | `backend/src/services/emr.js`, `backend/src/services/hisBoardStore.js` |
| Delivered / Read (webhook + checks) | `backend/src/services/delivery.js` |
| WhatsApp Monitor (data + screen) | `backend/src/services/monitor.js`, `frontend/src/pages/WhatsappMonitorPage.jsx`, `frontend/src/monitor/` |
| Private report links | `backend/src/services/reportLinks.js`, `backend/src/routes/public.js` |
| Jobs (15 min / 1 min / 2 min, startup) | `backend/src/jobs/scheduler.js` |
| WATI calls | `backend/src/services/wati.js` |

## 11. Tests

```bash
cd backend
npm test                  # 19 tests: send time, night hold, age limit, retries, statuses, links
npm run test:integration  # 22 checks: full send flow + WhatsApp Monitor, with a fake WATI and a test database
```
