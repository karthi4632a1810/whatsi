# Whatsi — Upgrade Recommendations

Review date: 2026-10-06 · Commit reviewed: `5a20146` · Scope: backend, frontend, Docker setup, repo contents.

Whatsi sends patients' lab reports over WhatsApp. That means it handles health data and can
message real people from the hospital's verified WhatsApp number. Most items below follow
from that: who can reach the app, whether a patient can get a wrong or duplicate message,
and whether patient data leaks.

How findings were checked:
- **Verified**: confirmed on the running Docker stack or with a command (marked ✅).
- **From code**: found by reading the code and tracing the path. Not exploited or tested
  live (marked 🔍).

---

## Progress (OP upgrade + follow-up, 2026-10-06)

| # | Item | Status |
|---|------|--------|
| 1 | Default JWT secret | **Fixed:** random secret in `.env`. A missing or weak value now falls back to a random per-run secret. |
| 2 | Open HIS webhook | **Fixed:** off unless `HIS_WEBHOOK_SECRET` is set. The PDF link is never taken from the request. |
| 3 | SQL injection via order ID | **Fixed:** order IDs are validated at the routes and again where SQL is built. |
| 4 | MongoDB open on the network | **Fixed:** port bound to 127.0.0.1, password required, and the app user can only use the `whatsi` database. |
| 5 | Patient data in git | **Partly:** untracked and ignored. Still in history until it's rewritten and force-pushed. |
| 6 | Public EMR report URLs | **Partly:** whatsi sends private expiring links once `PUBLIC_BASE_URL` is set. The EMR itself still serves the reports without a login — escalate. |
| 7–12 | Double sends, stuck QUEUED, missed daily run, stuck refresh, no ticks, wrong sync counts | **Fixed:** atomic claim, "Check needed" status, catch-up scheduling, startup recovery, webhook + status checks, `includeResultMetadata`. |
| 13 | Dead config | **Mostly:** `EOD_CRON`/`RETRY_CRON` removed; retry interval now used. `backend/.env` is still there (unused). |
| 15, 17–20 | Login limit, audit, input, Express defaults, browser cache | **Mostly:** login lockout, password change and sign out everywhere (API only, no screen), `sentBy` on every send, validated settings, escaped search, same-origin CORS, JSON errors, nginx headers, IndexedDB cleared. No helmet. |
| 23 | Backups | **Fixed:** nightly `mongodump` to `backups/`, 14 days kept. Restore tested. |
| 24 | Docker hardening | **Mostly:** non-root backend, healthcheck, log rotation. Images not pinned. |
| 25 | Monitoring | **Partly:** job status in Settings. No alerts yet. |
| 28 | Known advisories | **Fixed:** `npm audit fix` in both apps, 0 left. |
| 31 | Tests | **Partly:** `npm test` (scheduling rules, report links) and `npm run test:integration` (send pipeline). |

Everything else below is still open.

## At a glance

| # | Item | Priority | Effort |
|---|------|----------|--------|
| 1 | Default `JWT_SECRET`: anyone can forge an admin login | P0 | 5 min |
| 2 | Open webhook lets anyone send a WhatsApp with any link to any number | P0 | 30 min |
| 3 | SQL injection into the hospital lab DB through the order ID | P0 | 30 min |
| 4 | MongoDB published on the network with no password | P0 | 15 min |
| 5 | Patient data committed to git | P0 | 1 hr |
| 6 | Lab report PDFs are public, guessable URLs (EMR side) | P0 (escalate) | EMR team |
| 7 | Same patient can be messaged twice (send race) | P1 | 2 hr |
| 8 | Reports stuck in `QUEUED` after a crash | P1 | 1 hr |
| 9 | End-of-day send skipped if app is down at that exact minute | P1 | 1 hr |
| 10 | HIS board stuck on "refreshing" after restart | P1 | 15 min |
| 11 | Delivered/read status never recorded | P1 | half day |
| 12 | Sync counts are always "created" (removed Mongoose option) | P1 | 15 min |
| 13 | Dead or misleading config | P1 | 30 min |
| 14–22 | Security hardening (HTTPS, login limits, roles, audit, consent…) | P2 | days |
| 23–27 | Deployment & operations (backups, alerts, Docker hardening) | P3 | days |
| 28–30 | Dependency & platform upgrades | P4 | 1–2 days |
| 31–35 | Tests, CI, code structure | P5 | ongoing |
| — | Feature ideas | P6 | — |

**Do items 1–5 before turning on automatic sending.**

---

## P0 — Fix now (security and patient privacy)

### 1. Default JWT secret ✅

`.env` has `JWT_SECRET=change-me-in-production`. It is also the fallback in
[backend/src/config.js:11](backend/src/config.js#L11). Anyone who knows this string (it is
in `.env.example` and in the code) can create a valid admin token. That gives full access:
send messages, change settings, read every patient record.

**Fix**
```bash
openssl rand -hex 32          # put the output in .env as JWT_SECRET=
docker compose up -d backend  # env_file changes need a recreate, not a restart
```
Then make the app refuse to start without a real secret:
```js
// config.js
jwtSecret: requireEnv("JWT_SECRET"), // throw if missing or equal to "change-me-in-production"
```
All current sessions will be logged out. That is expected.

### 2. Webhook can send any link to any phone ✅🔍

`HIS_WEBHOOK_SECRET` is empty. [webhooks.js:11-13](backend/src/routes/webhooks.js#L11-L13)
treats an empty secret as "allow everyone". `POST /api/webhooks/his/report-ready` takes
`phone` and `hisReportUrl` straight from the request body and creates a `PENDING` report. The
next end-of-day run sends it through WATI. So anyone who can reach port 2002 can make the
hospital's WhatsApp number send a link of their choice (for example a phishing page) to any
number.

**Fix**, in order of preference:
1. EMR has no webhook yet (`plan.md` §7.8 says polling replaces it). **Remove or disable the
   route** until EMR actually calls it.
2. If it is needed: fail closed when the secret is unset, compare with
   `crypto.timingSafeEqual`, and **ignore `phone` and `hisReportUrl` from the payload**.
   Take only the order ID, then look up phone and procedure IDs from EMR with the same code
   the poller uses.

### 3. SQL injection via order ID 🔍

`GET /api/his/pdf-url/:orderId` and `GET /api/his/pdf/:orderId` pass the URL path value into
`resolveOrderPdfUrl` → `resolveProcIds` → `fetchProcIdsFromLabService`. That function builds
SQL by string interpolation:

[emr.js:155](backend/src/services/emr.js#L155)
```js
fetchLabRows(`Exec LabPatFiles @Opt=${opt},@OrderID=${orderId}`)
```
The same applies to `EMR_PROCIDS_QUERY` at [emr.js:180](backend/src/services/emr.js#L180).
`looksLikeEmrOrderId` exists but is only checked in `fetchOrderStatusRows`, not on this path.
The query runs against the hospital lab database. Together with item 1, this needs no real
login.

**Fix**: validate once at the edge and again where SQL is built.
```js
// routes/reports.js, at the top of both /his/pdf-url/:orderId and /his/pdf/:orderId
if (!looksLikeEmrOrderId(req.params.orderId)) {
  return res.status(400).json({ error: "Invalid order ID" });
}

// emr.js, inside fetchProcIdsFromLabService and fetchProcIdsFromCustomQuery
const id = Number.parseInt(orderId, 10);
if (!looksLikeEmrOrderId(String(id))) return [];
```
Also run `rg '\$\{' backend/src/services/emr.js` and check every template string that ends
up in `strQuery`.

### 4. MongoDB open on the network ✅

[docker-compose.yml:10](docker-compose.yml#L10) publishes Mongo as `0.0.0.0:3002`. Mongo
runs without authentication (`bindIp: '*'`, no users). Anyone on the hospital network can
connect and read every patient, phone number and message log.

**Fix**
- Remove the `ports:` block from the `mongo` service. The backend reaches it over the
  Docker network as `mongo:27017` and does not need the host port. For local debugging,
  use `"127.0.0.1:3002:27017"`.
- Turn on auth (`MONGO_INITDB_ROOT_USERNAME` / `MONGO_INITDB_ROOT_PASSWORD`). Those
  variables only apply to an empty volume. The current volume was created on 2026-10-06 and
  holds only the admin user and default settings, so **now is the cheapest time** to
  recreate it.
- Do the same for the backend: drop `"2002:5001"` and let traffic go through nginx on 1002.

### 5. Patient data committed to git ✅

These files are tracked and pushed to `github.com/Nandhu-Mapims/whatsi`:

| File | Contains |
|------|----------|
| `order_352629.csv` | Patient name, age, gender, ward, bed, lab results |
| `output/send_results.json` | Phone numbers and WATI contact IDs |
| `output/pdfs/nandhu_lab_report.pdf` | A lab report |

The repo is private, but everyone with access, every clone, and every fork has this data.

**Fix**
1. Remove the files and add `output/` and `*.csv` to `.gitignore`.
2. Rewrite history with `git filter-repo --path order_352629.csv --path output/ --invert-paths`
   and force-push. Coordinate with everyone who has a clone first.
3. If this data counts as a reportable incident under hospital policy, tell the data
   protection officer.

### 6. Lab report URLs are public and guessable (EMR side, escalate) ✅

`plan.md` §8.1 records that `LabReport.aspx` returns the PDF **without any login**. The
app's own PDF proxy ([reports.js:365](backend/src/routes/reports.js#L365)) fetches it with no
cookie, which confirms it. Order IDs are sequential (for example `352629`) and procedure IDs
are small integers. Anyone who has one link can change the numbers and open other patients'
reports. Whatsi sends these raw URLs to patients, so the links spread through WhatsApp.

Related: the app sends raw SQL text to `wsQueryBuilder.asmx/Getdataset1` with no credentials
(`EMR_COOKIE` is unset, and polling still works). If that endpoint is reachable from outside
the hospital, it is a much bigger exposure than anything in this repo.

**Fix**
- **Escalate both to the EMR vendor and hospital IT security.** Ask them to require
  authentication on `LabReport.aspx` and on the QueryBuilder/LabServices web services, and
  to firewall them to known servers.
- In Whatsi, stop sending the raw EMR URL. Serve the PDF from Whatsi through a **random,
  expiring token**, for example `https://<host>/r/9f3c…e1`, valid 7–30 days. Store the token
  in Mongo and fetch the PDF from EMR server-side. WATI fetches the attachment from this URL,
  so it must be reachable from the internet. Check with IT how to expose only `/r/*`.

---

## P1 — Correctness and reliability of sending

### 7. Same patient can be messaged twice 🔍

`sendPendingReports` loads all `PENDING`/`FAILED` rows, then loops. `sendReportById`
re-reads each report but never checks that it is still unsent
([reports.js:450](backend/src/services/reports.js#L450),
[reports.js:654](backend/src/services/reports.js#L654)). Two jobs running at the same time
will both send the same report.

That happens with the **default settings**. At 18:00 the end-of-day job (every minute,
[scheduler.js:82](backend/src/jobs/scheduler.js#L82)) and the retry job (`*/10`,
[scheduler.js:105](backend/src/jobs/scheduler.js#L105)) both fire. Both pick up every
`FAILED` report. A manual "Send all pending" during a cron run, or IMMEDIATE mode at
:00/:30, causes the same overlap.

**Fix**: claim each report atomically before sending.
```js
const claimed = await Report.findOneAndUpdate(
  { _id: reportId, status: { $in: force ? ["PENDING", "FAILED", "SENT"] : ["PENDING", "FAILED"] } },
  { $set: { status: "QUEUED", queuedAt: new Date() } },
  { new: true }
);
if (!claimed) return { skipped: true, reason: "Already sent or being sent" };
```
Also wrap `sendPendingReports` in a single-flight lock so only one batch runs at a time. An
in-process promise lock is enough while there is one backend container.

### 8. Reports stuck in `QUEUED` 🔍

A report is set to `QUEUED` ([reports.js:548](backend/src/services/reports.js#L548)) before
the WATI call. If the container restarts during the call, the report stays `QUEUED`
forever. Nothing picks up `QUEUED` rows, and the dashboard counts them as pending.

**Fix**: on startup and every 10 minutes, move `QUEUED` rows older than about 10 minutes to
a new status such as `NEEDS_REVIEW`. **Do not auto-retry them**: WATI may already have
delivered the message, and a blind retry is a duplicate. Show them in the queue page with a
"check Messages log, then resend" action.

### 9. End-of-day send skipped if the app is down at that minute 🔍

The end-of-day job only fires when the clock equals the send time to the minute
([scheduler.js:90](backend/src/jobs/scheduler.js#L90)). It remembers the last run in memory
(`lastEodRunKey`). If the container is restarting or busy at 18:00, that day's reports wait
until 18:00 the next day.

**Fix**: run when the time is at or after the send time **and** no send has finished today.
The helper `isAtOrPastSendTime` already exists. Store `lastEodRunDay` in
`AutomationSettings`, not in memory, so it survives restarts.

### 10. HIS board stuck on "refreshing" 🔍

`runChunkedBoardRefresh` writes `refreshStatus: "running"` to Mongo
([hisBoardStore.js:191](backend/src/services/hisBoardStore.js#L191)). If the process stops
mid-refresh, that value stays. Soft refresh then skips forever ("full refresh already
running") and the UI keeps showing the spinner.

**Fix**: on startup, before `startScheduler()`:
```js
await LabBoardDay.updateMany(
  { refreshStatus: "running" },
  { $set: { refreshStatus: "error", refreshError: "Interrupted by restart" } }
);
```

### 11. Delivered/read status never recorded 🔍

`MessageLog.status` supports `DELIVERED` and `READ`, but `POST /api/webhooks/wati/status` is
a no-op ([webhooks.js:77](backend/src/routes/webhooks.js#L77)). Staff can't tell "sent to
WATI" from "patient received it". Messages to numbers without WhatsApp look like successes.

**Fix**: register the webhook in the WATI dashboard. Protect it with a secret token in the
URL or a header. Match events to `MessageLog` by `watiMessageId` and update the status.
Check WATI's docs for the exact payload fields. Then show "Delivered" and "Read" in the
Messages and Queue pages, and list undelivered messages after 24 hours.

### 12. Sync counts are always "created" ✅

[reports.js:201](backend/src/services/reports.js#L201) passes `rawResult: true` to
`findOneAndUpdate`. Mongoose 8 removed that option for `findOneAndUpdate` and replaced it
with `includeResultMetadata`. The installed version (8.24.1) ignores it. A test against a
scratch database showed `lastErrorObject` is `undefined` for both inserts and updates. As a
result, `updated` never increments: every synced row counts as `created`.

Effects:
- Poll and backlog results in the logs and UI overstate new reports.
- In IMMEDIATE mode, the backlog send ([scheduler.js:60-67](backend/src/jobs/scheduler.js#L60-L67))
  runs whenever any row is re-synced, not only when something new was queued.

**Fix**: use `{ upsert: true, new: true, includeResultMetadata: true }`. Then read
`result.lastErrorObject.updatedExisting` and the document from `result.value`.

### 13. Dead or misleading config ✅

| Setting | Problem |
|---------|---------|
| `EOD_CRON` ([config.js:53](backend/src/config.js#L53)) | Never used. Send time comes from Settings → `endOfDayTime`. |
| `retryPolicy.retryIntervalMinutes` | Stored and shown, never used. Retries follow `RETRY_CRON`. |
| `backend/.env` | Never loaded (`config.js` reads the root `.env`). It differs from the root file in `ADMIN_PASSWORD`, which is confusing. Delete it. |
| `token` / `url` fallbacks ([config.js:13-14](backend/src/config.js#L13-L14)) | Old lowercase names kept for `test-wati-send.js`. Use only `WATI_TOKEN` / `WATI_URL`. |

Remove what isn't used, or wire it up. Validate config at startup (zod or a small
`requireEnv` helper) so a typo fails loudly instead of falling back to a default.

---

## P2 — Security hardening

14. **HTTPS.** The UI is plain HTTP on port 1002, so passwords, tokens and patient data
    cross the LAN unencrypted. Put it behind the hospital's reverse proxy with a certificate,
    or add TLS to nginx.
15. **Login protection.** `/api/auth/login` has no rate limit or lockout. Add
    `express-rate-limit` (for example 5 attempts per 15 minutes per IP and email). Add a
    "change password" screen, and stop relying on the `.env` seed password long term.
16. **Users and roles.** The `role` field (`admin`/`staff`) is issued in the token but never
    checked. Each person should have their own account. Settings, templates and "send all"
    should require `admin`.
17. **Audit trail.** `MessageLog` doesn't record who triggered a send. For clinical data you
    want "who sent which report to which number, when". Add `sentBy` (from `req.user`) to
    `MessageLog` and `Report`, and log settings and phone-override changes.
18. **Input handling.**
    - Search builds `new RegExp(q)` from user input
      ([reports.js:424](backend/src/routes/reports.js#L424),
      [patients.js:11](backend/src/routes/patients.js#L11)). Invalid input such as `(`
      returns a 500, and crafted input can stall the server. Escape it with
      `q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`.
    - `PUT /settings/automation` and `PUT /his/orders/:id/pdf-meta` accept unchecked values.
      Validate request bodies with a schema (zod).
    - `hisReportUrl` is stored and later fetched server-side, so a bad value makes the server
      call any URL. Allow only the EMR host.
19. **Express defaults.** Set `NODE_ENV=production` in the backend image so error pages don't
    show stack traces. Restrict `cors()` ([index.js:22](backend/src/index.js#L22)) to the UI
    origin. Add `helmet` and basic security headers in nginx.
20. **Browser cache of patient data.** The HIS board is cached in the browser's IndexedDB
    (`mapims-his`). Logout ([Layout.jsx:59](frontend/src/components/Layout.jsx#L59)) clears
    the token but not this cache. On shared ward PCs the next user can read it. Call
    `indexedDB.deleteDatabase("mapims-his")` on logout and on session expiry.
21. **Session length.** Tokens last 12 hours and can't be revoked. Consider shorter tokens
    with refresh, or a token version on the user record so an admin can force logout.
22. **Patient consent and opt-out.** `plan.md` §8.4 left this open. India's DPDP Act and
    WhatsApp Business policy both expect opt-in for this kind of message. Add a
    `whatsappConsent` field (from registration or EMR) and an opt-out list. Handle replies
    such as "STOP" through WATI. Never send to opted-out numbers.

---

## P3 — Deployment and operations

23. **Backups.** Data lives only in the `whatsi_mongo_data` volume and nothing is backed up.
    Add a nightly `mongodump` (a small sidecar container or a host cron job). Keep 14–30
    days, copy them off the server, and test a restore once.
24. **Docker hardening.**
    - The backend runs as **root** ✅. Add `USER node` to
      [backend/Dockerfile](backend/Dockerfile).
    - The backend has no healthcheck ✅. Add one on `/api/health` so `depends_on` and
      restarts work.
    - Pin image versions (`mongo:7.0.x`, `nginx:1.x-alpine`) for repeatable builds.
    - Add log rotation (`logging: { driver: json-file, options: { max-size: 10m, max-file: "5" } }`).
25. **Monitoring and alerts.** Failures today show up only in `docker compose logs`. Track and
    expose in `/api/health`:
    - last successful EMR poll time
    - last end-of-day run and its result
    - failed sends in the last 24 hours
    - WATI token validity (the code already detects an "HTML instead of JSON" response)

    Alert an admin by email or WhatsApp when the last poll is older than 1 hour, when the
    end-of-day run fails, or when the WATI token expires.
26. **Data retention.** `MessageLog` stores full request and response payloads forever, and
    `HisLabOrder` grows by one board per day. Agree a retention period with the hospital
    (for example 1 year for message logs, 90 days for board snapshots) and add TTL indexes.
27. **Structured logging.** Replace `console.log` with `pino`. Use JSON lines with a request
    ID, and **never log phone numbers or names** in full.

---

## P4 — Dependency and platform upgrades

28. **Known advisories** ✅ (`npm audit` on 2026-10-06).
    - Backend: 2 (`proxy-addr` critical, `qs` moderate). Both come through Express. The
      `proxy-addr` one matters only with `trust proxy`, which the app doesn't use.
    - Frontend: 7 (6 high, 1 moderate). They are in build tooling and `react-router`. The
      React Router advisory affects RSC mode, which isn't used.

    Low real-world risk, but `npm audit fix` in both folders clears them. Rebuild and smoke
    test afterwards.
29. **Runtimes.**
    - Your machine runs **Node 20, which reached end of life in April 2026** ✅. Docker uses
      Node 22. Move both to the current LTS (Node 24) so local and Docker match.
    - Add `"engines": { "node": ">=24" }` and an `.nvmrc`.
    - Plan MongoDB 7 → 8. Test on a copy of the volume first.
30. **Library majors.**
    - Mongoose 8 → 9 is available. Fix item 12 first. Read the migration guide; `new: true` and
      other `findOneAndUpdate` options have changed across majors.
    - `dotenv` can be dropped: Docker injects env, and Node 24 has `--env-file`.
    - Do one upgrade per PR, each with a quick send test in WATI test mode.

---

## P5 — Code quality and development workflow

31. **Tests (there are none).** Start with the pure logic that decides who gets a message:
    - `assessOrderReadiness`, `shouldSyncSnapshot`, `orderHasNewTests`
    - `isExcludedPatientType` (the Z-PATIENT rule from the last commit)
    - `normalizePhone`, `utils/dates.js` (IST day boundaries), `emrParse.js`

    Then one integration test of the send pipeline with Mongo (`mongodb-memory-server`) and a
    fake WATI. It should cover strict vs partial readiness, test-send allowlist, no double
    send (item 7) and retry limits. Use `node --test` (built in) or Vitest.
32. **CI.** A GitHub Actions workflow on every push: install, lint, test, build the frontend,
    `npm audit --audit-level=high`, `docker compose build`.
33. **Lint and format.** ESLint and Prettier, with a pre-commit hook. This catches unused
    imports and dead code like item 13.
34. **Break up large files.**
    - `services/reports.js` (846 lines) mixes sync, PDF resolution, sending and stats. Split
      it into `queueSync.js`, `pdfResolve.js`, `sender.js` and `stats.js`.
    - On the frontend, `DashboardPage.jsx`, `ReportsPage.jsx` and `OverviewDashboardPage.jsx`
      (500+ lines each) and `styles.css` (2,300 lines) are good candidates for smaller
      components and CSS modules.
35. **Repo hygiene.**
    - There is no `README.md`. Add a short one: what it is, how to run it in Docker, how to
      seed the admin, where the safety switches are. `PROJECT_JOURNEY.md` and `plan.md` are
      long and partly outdated.
    - Move `test-wati-send.js` to `backend/scripts/` and make it use `WATI_TOKEN`.
    - Write commit messages that say what changed. Recent history is `projd` ×5 and `fdf`,
      which makes it hard to find when a behaviour changed.

---

## P6 — Feature ideas (after the above)

- **Delivery dashboard**: sent → delivered → read funnel per day, with a list of undelivered
  messages to call manually. Needs item 11.
- **Secure report links with expiry and view tracking**: see whether the patient opened the
  report. Needs item 6.
- **EMR push instead of polling**: if the EMR vendor can call a signed webhook when results
  are approved, polling load and delays both drop.
- **Patient replies**: route WhatsApp replies ("wrong number", "STOP", questions) to a staff
  inbox.
- **Regional language templates**: a Tamil version of `mapims_lab_rpt`, chosen per patient.
- **Management export**: monthly CSV/PDF of reports sent per department, for MIS.
- **Phone quality check**: flag numbers that repeatedly fail or are shared by many patients
  (often a hospital or attendant number) before sending.

---

## Suggested order

| When | What |
|------|------|
| This week | Items 1–5. Raise item 6 with the EMR vendor and IT security. Keep automatic sending OFF until done. |
| Next 2 weeks | Items 7–13, with tests for each fix (item 31). |
| Month 2 | HTTPS, roles, audit, consent (14–22). Backups and alerts (23, 25). |
| Ongoing | Dependency upgrades (28–30), CI and lint (32–33), refactors (34) as you touch each area. |
