# Lab Report WhatsApp Delivery System — Plan

## 1. Overview

System that listens for lab reports becoming ready in HIS, queues them, and sends
patients a WhatsApp message (via WATI) containing a **link** to the report. The
link opens the HIS-hosted PDF directly in the browser — no file is attached or
re-uploaded, HIS stays the single source of truth for the document.

Default automation behaviour: reports are **collected through the day** as HIS
webhooks arrive, and sent as one **end-of-day batch** per patient, unless a rule
or manual action says otherwise.

---

## 2. Tech stack

- **Backend:** Node.js + Express
- **DB:** MongoDB (Mongoose)
- **Scheduler:** node-cron / agenda.js (for end-of-day batch + retries)
- **WhatsApp:** WATI API (template messages, link button — not document upload)
- **Frontend:** React (dashboard, single admin app)
- **Auth:** Staff login (JWT/session) — MAPIMS staff only, not patient-facing

---

## 3. Data models (MongoDB)

### Patient
```js
{
  _id,
  patientId,          // HIS patient ID
  name,
  phone,
  opIpType,            // "OP" | "IP"
  department,
  lastSyncedAt,        // last time contact info was refreshed from HIS
  createdAt, updatedAt
}
```

### Report
```js
{
  _id,
  reportId,             // HIS report ID
  patientId,
  reportType,
  opIpType,
  hisReportUrlTemplate, // LabReport.aspx URL — see §7.4
  status,               // PENDING | QUEUED | SENT | FAILED
  triggerType,          // AUTO_EOD | AUTO_IMMEDIATE | MANUAL
  reportReadyAt,
  scheduledSendAt,
  sentAt,
  attempts,
  lastError,
  watiMessageId,
  createdAt, updatedAt
}
```

### AutomationSettings
```js
{
  _id,
  automationEnabled,     // master on/off toggle
  mode,                  // "END_OF_DAY" | "IMMEDIATE" | "CUSTOM_SCHEDULE"
  endOfDayTime,           // e.g. "18:00"
  scope,                  // "ALL" | "OP_ONLY" | "IP_ONLY"
  retryPolicy: { maxAttempts, retryIntervalMinutes },
  updatedBy, updatedAt
}
```

### MessageLog (WATI management / failures)
```js
{
  _id,
  reportId,
  patientId,
  watiMessageId,
  status,               // SENT | DELIVERED | READ | FAILED
  errorReason,
  requestPayload,
  responsePayload,
  sentAt,
  updatedAt
}
```

---

## 4. Core flows

### 4.1 Webhook ingestion (always on)
1. HIS calls `POST /webhooks/his/report-ready` with patientId, reportId, opIpType.
2. Verify signature/secret.
3. Look up or refresh patient contact via HIS API.
4. Create `Report` with `status: PENDING`.
5. Respond 200 immediately; do lookups async.

### 4.2 Automatic trigger — End of day (default)
1. Cron runs at `AutomationSettings.endOfDayTime` daily.
2. If `automationEnabled` is true and `mode = END_OF_DAY`:
   query all `Report` where `status = PENDING` (and `reportReadyAt` is today).
3. For each: mark `QUEUED`, resolve fresh HIS PDF URL, send via WATI, mark
   `SENT`/`FAILED`, write `MessageLog`.
4. Failed sends respect `retryPolicy` (re-attempt at interval, up to max attempts).

### 4.3 Automatic trigger — Immediate (optional mode)
Same as above, but runs per-webhook instead of on a schedule — for when staff
switch `mode` to `IMMEDIATE` in Settings.

### 4.4 Manual trigger
- Staff selects one or more `PENDING`/`FAILED` reports on the dashboard and
  clicks **Send now** → calls `POST /reports/:id/send` → same send logic as
  above, `triggerType: MANUAL`, bypasses the schedule.

### 4.5 WATI send
- Use approved WATI template **`mapims_lab_rpt`** with dynamic parameters:
  - `1` → patient name
  - `attachmentLink` → EMR `LabReport.aspx` PDF URL (public link; no file upload)
- Log `watiMessageId`; poll or receive WATI delivery-status webhook to update
  `MessageLog.status`.
- **Testing rule:** only send test messages to **Durgaram** (`919360635207`). Do not
  use other contacts for automated or dev test runs.

---

## 5. Frontend pages

### 5.1 Login
Staff auth (email/password or SSO if MAPIMS has one).

### 5.2 Dashboard (home)
- Summary cards: reports pending today, queued, sent today, failed.
- Quick view of today's end-of-day batch countdown/status.

### 5.3 Report queue / Waiting management
- Table of all reports: patient name, OP/IP, report type, status, ready time,
  scheduled send time.
- Filters: status (Pending/Queued/Sent/Failed), OP/IP, date range.
- Bulk select → **Send now** (manual trigger).
- Row-level retry for failed reports.

### 5.4 Contact management
- Patient list synced from HIS: name, phone, OP/IP, department.
- **Date-wise filter** (e.g. registered/visited on a given date or range).
- Search by name/phone/patient ID.
- Edit phone number override (in case HIS number is wrong) — saved in Mongo,
  doesn't touch HIS.

### 5.5 WATI management (delivery + failures)
- All outbound messages: patient, report, sent time, WATI status
  (Sent/Delivered/Read/Failed), error reason if failed.
- Filter by status = Failed to see what needs attention.
- Retry action per failed message.
- Basic delivery-rate stats (sent vs failed vs delivered, by day).

### 5.6 Settings / Automation
- **Master toggle:** Automation enabled / disabled.
- **Mode:** End of day (default) / Immediate / Custom schedule.
- **End-of-day time** picker.
- **Scope:** All patients / OP only / IP only.
- **Retry policy:** max attempts, retry interval.
- **WATI template** selection/config.
- **Manual trigger** shortcut: "Send all pending now" button, with confirmation.

### 5.7 Report detail (drill-down)
- Single report: full timeline (ready → queued → sent → delivered), raw WATI
  payload/response, resend button.

---

## 6. API endpoints (draft)

```
POST   /webhooks/his/report-ready        HIS → system
POST   /webhooks/wati/status              WATI → system (delivery status)

GET    /reports                          list + filters (status, opIp, date)
POST   /reports/:id/send                 manual trigger, single
POST   /reports/bulk-send                manual trigger, multiple

GET    /patients                         list + date-wise filter
PATCH  /patients/:id                     override phone etc.

GET    /messages                         WATI log + failures
POST   /messages/:id/retry

GET    /settings/automation
PUT    /settings/automation
```

---

## 7. EMR / HIS integration (MAPIMS BB15SE)

Confirmed read-only against `https://emr.mapims.edu.in/BB15SE`. This section
documents how the WhatsApp system connects to HIS — polling, filtering, PDF link
construction, and WATI handoff.

### 7.1 End-to-end flow

```
EMR Lab list (approved only)
  → group by Order ID
  → build LabReport.aspx PDF URL
  → queue Report in MongoDB
  → end-of-day / manual trigger
  → WATI mapims_lab_rpt (name + attachmentLink)
```

When a lab user clicks **Print** in EMR, the browser ultimately requests
`LabReport.aspx` and receives a PDF. The WhatsApp system reuses that same URL as
`attachmentLink` — HIS remains the single source of truth; no PDF re-upload.

### 7.2 Step 1 — Poll approved lab results

**Endpoint**
```
POST https://emr.mapims.edu.in/BB15SE/QueryBuilder/wsQueryBuilder.asmx/Getdataset1
Content-Type: application/json; charset=UTF-8
```

**Body**
```json
{
  "strQuery": "Use KMCH_Lab EXEC LabTestResultHistoryQB @FromDate='{from}', @ToDate='{to}', @RegNo='', @RequestNo='', @IPNO='', @BillNo='', @PatName='', @BedNo='', @Dept='', @Doc='0', @Proc='0', @PatCategory='1,2,3', @Status='6', @bDiscaintimation='1', @PatType='0', @Result='1'",
  "strCon": "BB_CONSTR"
}
```

**Response:** `{ "d": "[{...rows...}]" }` — `d` is a JSON-stringified array.

**Key row fields**

| Field | Use |
|-------|-----|
| `REG No` | UHID / patient ID |
| `REQ NO` | HTML link — extract `Orderid=` from `href` |
| `PATIENT NAME` | Display name → WATI param `1` |
| `MOBILE` | Phone → normalize to `91XXXXXXXXXX` |
| `STATUS` | Must be `RESULT APPROVED` (enforced by `@Status='6'`) |
| `PROCEDURE` | Test name (one row per procedure) |
| `IP/OP/OT` | OP vs IP |
| `COMPLETED DATE` | `reportReadyAt` |
| `ORDERING DEPARTMENT` | Department filter |

**`@Status` filter map (LabTestResultHistoryQB)**

| `@Status` | Returns |
|-----------|---------|
| `0` | All statuses |
| `1` | `IN PROCESS` |
| `2` | `RESULT ENTERED`, `COMPLETED` |
| `3` | `CANCELLED` |
| `5` / `8` | `DEPT RECEIVE PENDING` |
| **`6`** | **`RESULT APPROVED` only** ← use for WhatsApp polling |
| `7` | `SPECIMEN YET TO BE COLLECTED` |

**WhatsApp gate:** poll with `@Status='6'` and additionally verify
`row.STATUS === 'RESULT APPROVED'` before queueing.

### 7.3 Step 2 — Group by order and readiness check

1. Parse `Orderid` from `REQ NO` HTML, e.g.
   `../Lab/LabResultHis.aspx?action=Search&Orderid=338110`.
2. Group all rows sharing the same `Orderid`.
3. **Readiness rule (choose one — confirm with lab team):**
   - **Strict:** send only when **every** procedure for the order is
     `RESULT APPROVED` (no `IN PROCESS` / pending rows for that order).
   - **Partial:** send PDF with approved `Procids` only when at least one
     procedure is approved (matches partial Print behaviour in EMR UI).
4. Deduplicate: one `Report` per `Orderid` per day (not per procedure row).

### 7.4 Step 3 — Build PDF link (same as EMR Print)

EMR uses a **two-step flow** (confirmed order 338292 / reg 6057810):

1. **Result view (HTML)** — loads inside the LAB RESULT VIEW modal:
   ```
   GET .../Lab/LabResultHis.aspx?action=Search&Orderid={orderId}
   ```
2. **Print (PDF)** — browser opens the report PDF with procedure IDs in the query string:
   ```
   GET .../Lab/CRReport/LabReport.aspx?action=Search&Orderid={orderId}&Procids={ids},&COMPHDR=0&PatEmail=0
   ```

**Example (order 338292, reg 6057810):**
```
https://emr.mapims.edu.in/BB15SE/Lab/CRReport/LabReport.aspx?action=Search&Orderid=338292&Procids=188,235,257,259,262,263,265,266,267,268,269,270,271,272,273,274,277,279,293,294,295,296,297,302,304,305,306,308,310,313,318,583,692,693,771,&COMPHDR=0&PatEmail=0
```

`Procids` are **not** in the lab list query (`LabTestResultHistoryQB`) rows. They are embedded in
`LabResultHis.aspx` as hidden field `hdnProcids` (see `fnPrint()` in page JS). Fetch that page with
an EMR session — set `EMR_USERNAME` / `EMR_PASSWORD` in `.env`, or paste `EMR_COOKIE` from browser.

**Endpoint (returns PDF directly — tested HTTP 200, no auth cookie required on PDF URL itself)**
```
GET https://emr.mapims.edu.in/BB15SE/Lab/CRReport/LabReport.aspx
  ?action=Search
  &Orderid={orderId}
  &Procids={comma-separated-proc-ids},
  &COMPHDR=0
  &PatEmail=0
```

**Example (order 338110):**
```
https://emr.mapims.edu.in/BB15SE/Lab/CRReport/LabReport.aspx?action=Search&Orderid=338110&Procids=188,257,259,262,263,265,266,267,268,269,270,271,272,273,274,277,279,771,&COMPHDR=0&PatEmail=0
```

Store this URL on `Report.hisReportUrlTemplate` (resolved at send time). Pass it
to WATI as `attachmentLink`.

**Open:** `Procids` are not present in the list query rows — EMR UI resolves
them on Print click. Need one network trace or lab-team input to confirm the
source SP/API for proc ID list.

### 7.5 Step 4 — Optional: lab file metadata

**Endpoint**
```
POST https://emr.mapims.edu.in/BB15SE/Lab/wsLabServices.asmx/RETDatatable
```
```json
{
  "strQuery": "Exec LabPatFiles @Opt=2,@OrderID={orderId}",
  "strCon": "LAB_CONSTR"
}
```

Returns `{ "d": "[]" }` for order 338110 in testing — may hold attachment
metadata for some orders. Not the primary print path; investigate if needed for
`Procids` discovery.

### 7.6 Step 5 — Queue in MongoDB

On each poll cycle (or webhook if EMR adds one later):

1. For each ready order → upsert `Patient` from `REG No`, `PATIENT NAME`, `MOBILE`.
2. Create `Report` with:
   - `reportId` = `Orderid`
   - `status` = `PENDING`
   - `hisReportUrlTemplate` = resolved `LabReport.aspx` URL
   - `reportReadyAt` = latest `COMPLETED DATE` for the order
3. Skip if `Report` already `SENT` for same `Orderid` + date.

### 7.7 Step 6 — Send via WATI (end-of-day or manual)

Uses existing flow §4.2–4.5:

```
POST {WATI_URL}/api/v1/sendTemplateMessage?whatsappNumber={phone}
Authorization: Bearer {token}
Content-Type: application/json-patch+json

{
  "template_name": "mapims_lab_rpt",
  "broadcast_name": "mapims_lab_{date}",
  "parameters": [
    { "name": "1", "value": "{patientName}" },
    { "name": "attachmentLink", "value": "{LabReport.aspx URL}" }
  ]
}
```

**Env (`.env`)**
```
token=wati_...
url=https://live-mt-server.wati.io/10190409
EMR_QUERY_BUILDER_URL=https://emr.mapims.edu.in/BB15SE/QueryBuilder/wsQueryBuilder.asmx/Getdataset1
EMR_STR_CON=BB_CONSTR
EMR_LAB_STR_CON=LAB_CONSTR
EMR_SQL_DATE_ORDER=mdy
```

Optional: `EMR_COOKIE` if EMR endpoints later require session auth (not needed for
`LabReport.aspx` PDF in current testing).

### 7.8 Polling schedule (replaces webhook until EMR provides one)

Until `POST /webhooks/his/report-ready` exists:

1. Cron every N minutes (e.g. 15) during lab hours.
2. Call `LabTestResultHistoryQB` with `@Status='6'` for today’s date range.
3. Diff against MongoDB — new/changed approved orders → `PENDING`.
4. End-of-day batch (§4.2) sends all `PENDING` reports.

### 7.9 Dashboard filters (approved-only visibility)

Report queue (§5.3) should only surface orders that passed the approved gate:

- Show `RESULT APPROVED` rows only (never `IN PROCESS`, `SPECIMEN YET TO BE COLLECTED`, etc.).
- Status badges: **Ready** (all procs approved), **Partial** (some approved), **Waiting** (none approved).
- Default send action: **Ready** orders only unless staff explicitly overrides.

### 7.10 Testing & safety

- Do **not** trigger messages during EMR lookup / integration dev.
- Test sends: **Durgaram only** (`919360635207`).
- Sentry calls from EMR React UI (`ingest.sentry.io`) are unrelated — ignore.

---

## 8. Open questions before build

1. ~~Does HIS's report PDF URL need a token/signed link?~~ **Answered:** `LabReport.aspx`
   returns PDF without auth cookie in current testing — use URL directly as
   `attachmentLink`. Re-verify if EMR adds auth later.
2. ~~Does WATI support a URL in the template?~~ **Answered:** yes — template
   `mapims_lab_rpt` uses `attachmentLink` for document header.
3. Confirm HIS webhook auth mechanism (shared secret / HMAC / IP allowlist) — or
   use polling (§7.8) until webhook exists.
4. Any regulatory/consent requirement for sending lab reports over WhatsApp (patient opt-in)?
5. What happens if EMR lookup for phone number fails — hold in PENDING or flag as error?
6. **How does EMR build `Procids` on Print?** — needed to construct PDF URL
   programmatically (not in list query rows).
7. **Send rule:** strict (all procedures approved) vs partial (approved `Procids` only)?