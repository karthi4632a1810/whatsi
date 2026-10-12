import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { connectDb } from "./db.js";
import { ensureAutomationSettings } from "./models/index.js";
import { ensureDefaultTemplate } from "./services/watiTemplates.js";
import { authRequired } from "./middleware/auth.js";
import { auditMiddleware } from "./middleware/audit.js";
import authRoutes from "./routes/auth.js";
import meRoutes from "./routes/me.js";
import userRoutes from "./routes/users.js";
import auditRoutes from "./routes/audit.js";
import labResultRoutes from "./routes/labResults.js";
import reportRoutes from "./routes/reports.js";
import patientRoutes from "./routes/patients.js";
import messageRoutes from "./routes/messages.js";
import settingsRoutes from "./routes/settings.js";
import watiRoutes from "./routes/wati.js";
import webhookRoutes from "./routes/webhooks.js";
import opRoutes from "./routes/op.js";
import publicRoutes from "./routes/public.js";
import monitorRoutes from "./routes/monitor.js";
import { recoverAfterRestart, startScheduler } from "./jobs/scheduler.js";
import { migrateSettings } from "./services/reports.js";
import { loadSettings, startSettingsRefresh } from "./services/appSettings.js";
import { migrateUsers } from "./services/users.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable("x-powered-by");
// Same-origin by default (the UI is served through nginx on the same host);
// list other origins in CORS_ORIGINS if the API must be called from elsewhere.
app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : false }));
app.use(express.json({ limit: "1mb" }));
// Audit log: records API actions as they finish — registered first so sign-in / sign-out are covered too.
app.use(auditMiddleware);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "whatsi-api" });
});

app.use("/api/auth", authRoutes);
// No login: signed, expiring report links opened by WATI / the patient's phone.
app.use("/api/public", publicRoutes);
app.use("/api/webhooks", webhookRoutes);

// Everything below needs a signed-in account; each route's permission: services/accessControl.js.
app.use("/api", authRequired);
app.use("/api/me", meRoutes);
app.use("/api/users", userRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/lab-results", labResultRoutes);
app.use("/api/monitor", monitorRoutes);
app.use("/api", opRoutes);
app.use("/api", reportRoutes);
app.use("/api/patients", patientRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/wati", watiRoutes);

const frontendDist = path.resolve(__dirname, "../../frontend/dist");
app.use(express.static(frontendDist));
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"), (err) => {
    if (err) res.status(404).json({ error: "Frontend not built" });
  });
});

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
// Last-resort error handler: a JSON message, never a stack trace.
app.use((error, _req, res, _next) => {
  console.error("[api] unhandled error", error);
  res.status(error.status || 500).json({ error: error.expose ? error.message : "Something went wrong — please try again" });
});

await connectDb();
await loadSettings();
startSettingsRefresh();
await migrateUsers();
await ensureAutomationSettings();
await migrateSettings();
await ensureDefaultTemplate();
await recoverAfterRestart();
startScheduler();

app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port}`);
});
