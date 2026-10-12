# whatsi — MAPIMS OP lab reports on WhatsApp

Sends each **OP** patient their official EMR lab report (the `LabReport.aspx` PDF) on
WhatsApp through WATI, using the approved template `mapims_lab_rpt`. IP / discharged
patients are handled by the investigation-chart portal, not here.

## How a report goes out

1. Every 15 minutes (when **Automation enabled** is on in Settings) whatsi reads today's
   lab orders from HIS, keeps the OP ones, and puts each order in the WhatsApp Queue once
   **all** its results are approved. Z patients are never sent. *Sync to queue* on HIS Lab
   Today does the same by hand.
2. With **Message sending enabled**, each queued report goes out **3 hours after its last
   result is approved** (Settings → Send schedule: hours after approval, or once a day at a
   fixed time instead).
3. **Night hold:** nothing is sent between 9 PM and 7 AM — anything due then goes at 7 AM.
4. Reports approved more than 24 h ago are not sent automatically (e.g. after downtime);
   *Send* in the WhatsApp Queue still works for them.
5. If results change after queuing (a test added or a result amended), the report waits
   until everything is approved again, and the 3 hours count from the new approval.
6. Delivered / read ticks come from the WATI webhook or a few capped status checks per
   message; HIS Lab Today shows "Delivered" / "Read".

Each report is claimed atomically before sending, so two workers or a staff click can
never send it twice. Temporary failures (network, WATI limit) retry with backoff; "not on
WhatsApp" and "no phone" wait for a person — adding a number in Contacts re-queues them.
A send cut off by a restart shows as **Check needed** in the queue: check the Message log
before pressing Send again.

## Screens

The same left-menu screens as before: Dashboard, HIS Lab Today, Lab report search,
WhatsApp Queue, Contacts, WATI Overview, Templates, Message log, Settings. What changed for
the new flow:

| Screen | Change |
|---|---|
| Settings → Queue rules | Patient scope is fixed to **OP only** |
| Settings → Send schedule | "After results are approved" + hours, or "Once a day"; Night hold with from / until |
| WhatsApp Queue | Under each status: when it goes out ("Sends 2:30 pm"), or why not ("Sending off", "Waiting for results"); new **Check needed** status |
| HIS Lab Today | WhatsApp column shows "Sends 2:30 pm" / "Delivered" / "Read"; the top pills show the schedule |
| **WhatsApp Monitor** (new, WATI section) | The investigation portal's monitor for OP reports: live status, filters (lab day / sent date, time, status, trigger, search), KPIs vs previous period, WATI connection, "did every ready OP patient get their report?", needs attention, charts (over time, delivery & read rate, funnel, read hours, time to read, approval → WhatsApp, failures, triggers, departments, staff), patients / messages table with timeline drawer and Retry, CSV / JSON export |

## Run

```bash
cp .env.example .env              # fill in WATI, EMR and a JWT_SECRET (openssl rand -hex 32)
docker compose up -d --build
docker compose exec backend node scripts/seedAdmin.js   # creates ADMIN_EMAIL / ADMIN_PASSWORD
```

UI: http://localhost:1002. MongoDB (127.0.0.1:3002) and the API (127.0.0.1:2002) only
listen on this machine, and MongoDB needs a password (`MONGO_*` in `.env`). The backend
logs in as `MONGO_APP_USER`, which can only read and write the `whatsi` database.

Password change (`POST /api/auth/change-password`) and "sign out everywhere"
(`POST /api/auth/sign-out-everywhere`) exist in the API; both end the user's other sessions.

### Report links

Set `PUBLIC_BASE_URL` to whatsi's public https address and patients get a private link
that expires after `REPORT_LINK_DAYS` (default 2), e.g.
`https://…/api/public/report/<signed token>/Lab-Report-382260.pdf`, instead of the EMR's
own address, which anyone can guess by changing the order number. whatsi fetches the PDF
from the EMR itself.

### Backups

The `backup` container writes `backups/whatsi-YYYY-MM-DD.archive.gz` every night at
02:00 (India time) and keeps 14 days. Copy that folder off this machine regularly.
To restore (this replaces the current data):

```bash
docker compose exec -T mongo sh -c 'mongorestore --drop --gzip --archive \
  --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" \
  --authenticationDatabase admin' < backups/whatsi-YYYY-MM-DD.archive.gz
```

### Existing installs: turning on the MongoDB password

The root and app users are created automatically only on an empty volume. On a volume
that already has data, the backend fails with `Authentication failed` until you create
them once. Set the `MONGO_*` values in `.env`, `docker compose up -d`, then:

```bash
docker compose exec -T mongo mongosh --quiet --eval '
  const e = process.env, admin = db.getSiblingDB("admin");
  admin.createUser({user: e.MONGO_INITDB_ROOT_USERNAME, pwd: e.MONGO_INITDB_ROOT_PASSWORD, roles: ["root"]});
  admin.auth(e.MONGO_INITDB_ROOT_USERNAME, e.MONGO_INITDB_ROOT_PASSWORD);
  db.getSiblingDB("whatsi").createUser({user: e.MONGO_APP_USER, pwd: e.MONGO_APP_PASSWORD,
    roles: [{role: "readWrite", db: "whatsi"}, {role: "readWrite", db: "whatsi_integration_test"}]});'
mkdir -p backups && chown 1000:1000 backups   # backup container runs as uid 1000
docker compose restart backend backup
```

MongoDB is already in password mode at this point, so the script logs in as root right
after creating it; without that, creating the second user is refused. Use letters and
digits only in the passwords (`openssl rand -hex 24`): they go into a connection URI.

Nothing is sent until **Message sending enabled** is switched on in Settings (and
`WATI_SEND_ENABLED=true`, `WATI_TEST_MODE=false` in `.env`). **Automation enabled** fills
the queue from HIS by itself.

## Tests

```bash
cd backend
npm test                  # scheduling rules (delay, night hold, retries, statuses)
npm run test:integration  # full send pipeline against a fake WATI + throwaway database
```
# whatsi
