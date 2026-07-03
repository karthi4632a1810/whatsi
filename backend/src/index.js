import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { connectDb } from "./db.js";
import { ensureAutomationSettings } from "./models/index.js";
import { ensureDefaultTemplate } from "./services/watiTemplates.js";
import { authRequired } from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import reportRoutes from "./routes/reports.js";
import patientRoutes from "./routes/patients.js";
import messageRoutes from "./routes/messages.js";
import settingsRoutes from "./routes/settings.js";
import watiRoutes from "./routes/wati.js";
import webhookRoutes from "./routes/webhooks.js";
import { startScheduler } from "./jobs/scheduler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "whatsi-api" });
});

app.use("/api/auth", authRoutes);
app.use("/api/webhooks", webhookRoutes);

app.use("/api", authRequired);
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

await connectDb();
await ensureAutomationSettings();
await ensureDefaultTemplate();
startScheduler();

app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port}`);
});
