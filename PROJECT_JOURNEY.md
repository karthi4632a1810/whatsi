# MAPIMS Whatsi - Full Project Journey

## 1) What This Project Is

`whatsi` is a full-stack internal system to move lab report status from MAPIMS HIS/EMR into a controlled WhatsApp delivery workflow.

At a high level, it does four things:

1. Pulls lab order/report status from HIS (EMR).
2. Builds a daily "HIS lab board" cache in MongoDB.
3. Syncs eligible reports into an app-managed queue.
4. Sends report PDFs through WATI with safety controls (test mode, allowlists, manual/bulk/auto send).

This project is built as:

- Backend: Node.js + Express + MongoDB + cron jobs
- Frontend: React + React Router + Vite
- Auth: JWT (12-hour session)

---

## 2) Repository Structure

### Root

- `package.json` (orchestration scripts)
  - `npm run dev` -> backend dev server
  - `npm run dev:ui` -> frontend dev server
  - `npm run build` -> frontend build
  - `npm run start` -> backend production start

### Backend (`backend/src`)

- `index.js` - app bootstrap, route mounting, DB connect, scheduler startup
- `models/index.js` - all Mongo schemas
- `routes/*.js` - API endpoints
- `services/*.js` - business logic (EMR, queue sync, WATI, stats, caching)
- `jobs/scheduler.js` - cron-based automation
- `middleware/auth.js` - JWT auth guard
- `utils/*.js` - date parsing, EMR parsing, phone normalization, etc.

### Frontend (`frontend/src`)

- `App.jsx` - route map
- `components/Layout.jsx` - shell, nav, global HIS sync indicator
- `pages/*.jsx` - feature pages (Dashboard, HIS Lab Today, Queue, Settings, etc.)
- `api.js` - authenticated API client

---

## 3) Startup Journey (Boot Sequence)

When backend starts:

1. Loads config from `.env` via `config.js`.
2. Connects to MongoDB.
3. Ensures automation settings exist (`ensureAutomationSettings()`).
4. Ensures default WATI template record exists.
5. Starts cron scheduler.
6. Serves API and built frontend.

From this point:

- `/api/health` is public.
- `/api/auth/login` is public.
- `/api/webhooks/*` is public (optional HIS secret protection).
- All other `/api/*` routes require JWT.

---

## 4) Core Data Model Journey

Important collections and their role:

- `HisLabOrder`
  - Server-side cached EMR board rows per `labDay`.
  - Contains readiness (`READY`, `PARTIAL`, `WAITING`), status counts, procedure info.

- `LabBoardDay`
  - Daily metadata: `lastFullSyncAt`, `lastIncrementalSyncAt`, chunk refresh progress, errors.

- `Report`
  - Queue entity used by WhatsApp workflow.
  - Unique on (`reportId`, `reportDay`).
  - Has send status: `PENDING`, `QUEUED`, `SENT`, `FAILED`.

- `MessageLog`
  - Attempt/delivery log for each send action.
  - Tracks `requestPayload.testSend` to distinguish test vs patient sends.

- `AutomationSettings`
  - Feature toggles and policy:
    - queue automation on/off
    - message sending on/off
    - mode: immediate vs end-of-day
    - readiness rule strict/partial
    - OP/IP scope
    - test-send mode + contact allowlist

- `OrderPdfMeta`
  - Procedure IDs and HIS PDF link metadata for resilient PDF resolution.

- `WatiApiSnapshot`
  - Cached WATI connection/contacts and monthly usage counters.

---

## 5) End-to-End HIS -> Queue -> WhatsApp Journey

## Stage A: HIS data ingestion

### Manual full refresh (HIS Lab Today -> "Refresh from HIS")

1. Frontend calls `POST /api/his/lab-today/refresh`.
2. Backend starts chunked job for selected day.
3. EMR is queried in time slices (default 2-hour chunks).
4. If a chunk times out, it retries with 1-hour sub-chunks.
5. Orders are upserted into `HisLabOrder`.
6. Progress is stored in `LabBoardDay.refreshProgress`.

### Automatic incremental refresh (cron)

- Cron expression: `EMR_POLL_CRON` (default every 15 minutes).
- Only runs when `automationEnabled` is true.
- Polls only incomplete board entries (WAITING/PARTIAL), reducing load.
- Updates only changed documents (hash-based compare in board store).

## Stage B: Queue sync (Report creation/update)

From board rows, candidates are chosen based on settings:

- scope: ALL / OP_ONLY / IP_ONLY
- readiness rule:
  - `STRICT` -> READY only
  - `PARTIAL` -> READY + PARTIAL

Candidates become `Report` rows (upsert by `reportId + reportDay`).

## Stage C: Sending through WATI

Send paths:

- Single manual send from queue
- Bulk send selected rows
- Auto immediate (after poll) when enabled
- End-of-day cron send

Safety checks include:

- `messageSendEnabled` gate
- `WATI_SEND_ENABLED` gate
- test mode/allowlist validation
- readiness constraints

Results:

- On success: report status becomes `SENT` (unless in test-send mode, where it remains pending-like)
- `MessageLog` records every attempt with payload/response metadata

---

## 6) Frontend User Journey (Screen by Screen)

## Login (`/login`)

- Email/password auth.
- Receives JWT and stores it in localStorage (`whatsi_token`).
- Expired token auto-redirects to login.

## Dashboard (`/dashboard`) - Operations Overview

- Compares HIS day stats vs queue stats.
- Shows day-wise queue aggregates.
- Helps detect sync gaps (e.g., ready in HIS but not yet in queue).

## HIS Lab Today (`/his-lab-today`)

Primary live operations screen.

- Top cards: HIS orders, result approved, ready to send.
- Date selector + status filters.
- "Refresh from HIS" starts full chunked board refresh.
- "Sync to queue" moves eligible orders into queue.
- Table shows:
  - HIS status, readiness, test counts, completion time
  - WhatsApp queue state badge
  - PDF preview action

Auto behaviors:

- Polls server every 30s to refresh view data (without expensive full pull).
- Uses global topbar indicator to show background sync running on any day.

## Lab Report Search (`/lab-search`)

- Manual recovery/search flow for date ranges.
- Reads from stored board first; loads missing days from EMR only when needed.
- Adds single report to queue via "Add to queue."

## WhatsApp Queue (`/reports`)

- Queue workbench with search/filter/select/bulk actions.
- Supports test-send mode with contact picker.
- Displays test-send status notes clearly (test sent/test failed vs patient sent).
- PDF preview integrated.

## Settings (`/settings`)

Control center for:

- HIS->queue automation
- scope + readiness policy
- message sending mode and schedule
- WATI template
- test-send mode and allowed contacts
- health indicators (WATI + EMR poll status)

## WATI Overview (`/wati`)

- Connection and queue performance snapshots.
- Pending backlog by day.
- Daily send history.
- WATI API monthly usage counter (calls vs plan limit when configured).

---

## 7) API Journey (Major Endpoint Groups)

## Auth

- `POST /api/auth/login`

## HIS/Board

- `GET /api/his/lab-today`
- `POST /api/his/lab-today/refresh`
- `GET /api/his/lab-today/refresh-status`
- `GET /api/his/lab-today/active-refreshes`
- `POST /api/his/lab-today/:orderId/refresh`
- `GET /api/his/lab-search`

## Queue/Reports

- `GET /api/reports`
- `POST /api/reports/poll`
- `POST /api/reports/:id/send`
- `POST /api/reports/bulk-send`
- `POST /api/reports/send-all-pending`
- `POST /api/reports/sync-order`

## Stats

- `GET /api/stats`
- `GET /api/stats/his`

## Settings/Health

- `GET /api/settings/automation`
- `PUT /api/settings/automation`
- `GET /api/settings/health`

## WATI

- `GET /api/wati/overview`
- `GET /api/wati/contacts`
- template CRUD/sync endpoints

## Webhooks

- `POST /api/webhooks/his/report-ready`
- `POST /api/webhooks/wati/status` (placeholder ack)

---

## 8) Automation Journey (Cron)

Defined in `jobs/scheduler.js`:

1. EMR poll cron
   - Runs by `EMR_POLL_CRON`.
   - Requires `automationEnabled`.
   - Performs incremental board refresh + queue sync.
   - Optional immediate auto-send if configured.

2. EOD minute watcher
   - Checks every minute.
   - Fires once at configured `endOfDayTime`.
   - Skips when test-send mode is on.

3. Retry cron
   - Runs by `RETRY_CRON`.
   - Retries pending/failed sends when sending enabled and not test-send mode.

---

## 9) Config Journey (.env)

Critical envs:

- WATI:
  - `WATI_TOKEN`, `WATI_URL`
  - `WATI_SEND_ENABLED`
  - `WATI_TEST_MODE`, `WATI_TEST_PHONE`
  - `WATI_BASIC_PLAN_API_LIMIT` (for usage vs plan display)
  - cache TTL envs for contacts/connection

- EMR:
  - query/lab URLs
  - credentials or cookie for advanced procid discovery
  - poll enable + cron
  - chunk controls and timeout/retry settings

- App:
  - `MONGODB_URI`
  - `JWT_SECRET`
  - `PORT`

---

## 10) Recent Journey Improvements in This Codebase

Recent workflow-focused additions:

- Global topbar indicator for background HIS refresh jobs across pages.
- Corrected `lastSyncAt` reporting to use latest of full/incremental sync times.
- Test send visibility split from patient sent metrics in dashboard stats.
- WATI API usage tracking + plan-limit display in WATI overview.
- HIS Lab Today auto-refresh of server data every 30s (view-level refresh).

---

## 11) Operational Playbook (How Teams Use It Daily)

Typical lab ops flow:

1. Open `HIS Lab Today`.
2. Refresh from HIS in morning (full board).
3. Keep automation enabled for periodic incremental updates.
4. Use `Sync to queue` for immediate queue push when needed.
5. Open `WhatsApp Queue`:
   - run test sends when validating template/phone behavior
   - run manual/bulk sends for patient delivery
6. Monitor `WATI Overview` for failures, backlog, usage consumption.
7. Use `Lab report search` for missed historical orders.

---

## 12) Troubleshooting Journey (Common Cases)

## "Auto sync not working"

Check:

- backend process running
- scheduler log shows EMR poll start/done
- `automationEnabled` true
- `EMR_POLL_ENABLED` true

Note:

- Older bug could show stale "synced at" despite incremental sync; now fixed.

## "Partial count mismatch between board and day-wise queue"

Expected with `STRICT` readiness rule:

- HIS board includes partials
- queue sync includes READY only

## "Sent count looks wrong in test mode"

- Historical SENT values remain.
- Test sends are now separated in stats.
- Audit should compare `Report.status=SENT` against non-test `MessageLog` rows.

## "Chunk timeout during refresh"

- Expected fallback behavior on busy days.
- Service retries timed-out 2h chunk with 1h sub-chunks.

---

## 13) Suggested Next Documentation Files (Optional)

If needed, split this journey into dedicated docs:

- `docs/ARCHITECTURE.md` (technical architecture + sequence diagrams)
- `docs/OPERATIONS_RUNBOOK.md` (daily ops + on-call checklist)
- `docs/API_REFERENCE.md` (endpoint contracts + sample payloads)
- `docs/SETTINGS_MATRIX.md` (what each toggle changes in runtime behavior)

---

## 14) One-line Summary

This project is a safety-first HIS-to-WhatsApp delivery platform: it continuously builds a reliable lab board cache, syncs eligible reports into a controlled queue, and sends with explicit operational controls, test guards, and audit-friendly logs.

---

## 15) Detailed Journey: "How Do I Get a Lab Report?"

This is the exact end-user journey for fetching and sending one report.

### Path A - Report is from today (fastest path)

1. Open `HIS Lab Today`.
2. Keep date as today.
3. Search by Order ID / UHID / patient name.
4. Confirm HIS status/readiness in table.
5. Click `Preview` to open report PDF.
6. If WhatsApp badge shows `Not queued`, click `Sync to queue`.
7. Open `WhatsApp Queue`.
8. Find that order and click:
   - `Test send` (if test mode is ON), or
   - `Send` (patient) for live delivery.

### Path B - Report is from old date

1. Open `Lab report search`.
2. Select From/To date range.
3. Search order/patient.
4. Click `Preview` to confirm PDF.
5. Click `Add to queue`.
6. Open `WhatsApp Queue` and send manually.

### Path C - Report not appearing

1. In `HIS Lab Today`, click `Refresh from HIS`.
2. Wait for chunked refresh completion.
3. Retry search.
4. If still missing, use `Lab report search` with wider date range.
5. If PDF unavailable, verify proc ID resolution in backend health flow.

---

## 16) Role-Based Journey

### Front Desk / Lab Staff

- Use `HIS Lab Today` for live board.
- Use `Preview` to verify patient report.
- Queue and send selected reports.
- Use `Lab report search` for historical days.

### WhatsApp Operator

- Works mostly in `WhatsApp Queue`.
- Uses filters/search to process pending rows.
- Performs test sends for verification.
- Performs patient sends in batches.
- Monitors failures and retries.

### Supervisor / Admin

- Manages settings in `Settings`.
- Controls automation, sending mode, readiness rule.
- Monitors usage and failures from `WATI Overview`.
- Checks dashboard sync gaps and backlog health.

---

## 17) System State Journey (What Happens Internally Per Button)

### `Refresh from HIS`

- Starts full-day chunk refresh job.
- Writes chunk progress to `LabBoardDay`.
- Upserts changed orders into `HisLabOrder`.
- Removes stale orders no longer present.

### `Sync to queue`

- Reads stored board for selected day.
- Filters by readiness + scope settings.
- Converts board orders to queue snapshots.
- Upserts `Report` rows for eligible orders.

### `Preview`

- Resolves PDF URL using:
  1) report metadata
  2) order metadata
  3) EMR discovery fallback
- Proxies PDF to browser.

### `Send` / `Test send`

- Validates settings gates.
- Calls WATI send API.
- Writes attempt to `MessageLog`.
- Updates `Report` status and error fields.

---

## 18) Decision Journey (When Data Looks "Wrong")

### Scenario: Board updated but queue count unchanged

Reason: new changes are mostly `PARTIAL` or `WAITING`, and readiness rule is `STRICT`.

Action:

- Keep `STRICT` (safe full approvals only), or
- switch to `PARTIAL` in `Settings` if business allows partial delivery.

### Scenario: "Not auto synced"

Check in order:

1. `automationEnabled` is ON.
2. Backend running and cron logs are printing.
3. `EMR_POLL_ENABLED=true`.
4. Current day selected (auto sync is day-based).
5. Eligibility rules not filtering everything out.

### Scenario: "Sent count is high but I did test mode now"

Reason:

- Historical `SENT` rows remain from earlier live runs.
- Test mode changes current/future behavior, not historical records.

Action:

- Compare against `MessageLog.requestPayload.testSend`.
- Use separated patient/test counters in dashboards.

---

## 19) Day-in-the-Life Operating Runbook

### Morning Start (8:00-9:00)

1. Backend service up, DB connected.
2. Open `HIS Lab Today`.
3. Run one `Refresh from HIS` for baseline board.
4. Confirm system status pills (WATI, queue sync, EMR poll).

### During Shift

1. Let auto-sync run on schedule.
2. Periodically check ready counts.
3. Sync queue manually if urgent.
4. Queue operators send in controlled batches.

### Before End of Day

1. Verify unsent pending rows.
2. Check failed rows and retry.
3. Validate final dispatch policy:
   - immediate mode already active, or
   - EOD mode time is correct.

### After Hours

1. Review `WATI Overview`:
   - failed trend
   - backlog days
   - monthly API usage
2. Capture anomalies for next-day follow-up.

---

## 20) Implementation Traceability Map

Use this quick map when debugging a journey step:

- Login/session:
  - `backend/src/routes/auth.js`
  - `backend/src/middleware/auth.js`
  - `frontend/src/api.js`

- HIS board refresh/status:
  - `backend/src/services/hisBoardStore.js`
  - `backend/src/services/emr.js`
  - `backend/src/routes/reports.js`

- Queue sync and send logic:
  - `backend/src/services/reports.js`
  - `backend/src/routes/reports.js`
  - `frontend/src/pages/ReportsPage.jsx`

- Scheduler/automation:
  - `backend/src/jobs/scheduler.js`
  - `backend/src/services/reports.js`

- WATI metrics/usage/cache:
  - `backend/src/services/wati.js`
  - `backend/src/services/watiStats.js`
  - `backend/src/services/watiCache.js`
  - `frontend/src/pages/WatiOverviewPage.jsx`

- Settings/toggles:
  - `backend/src/routes/settings.js`
  - `frontend/src/pages/SettingsPage.jsx`
