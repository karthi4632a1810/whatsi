import mongoose from "mongoose";

const patientSchema = new mongoose.Schema(
  {
    patientId: { type: String, required: true, index: true },
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
    phoneOverride: { type: String, default: "" },
    opIpType: { type: String, enum: ["OP", "IP", "OT", "UNKNOWN"], default: "UNKNOWN" },
    patientType: { type: String, default: "" },
    department: { type: String, default: "" },
    lastSyncedAt: { type: Date },
  },
  { timestamps: true }
);

patientSchema.index({ name: "text", patientId: "text", phone: "text" });

const reportSchema = new mongoose.Schema(
  {
    reportId: { type: String, required: true, index: true },
    patientId: { type: String, required: true, index: true },
    patientRef: { type: mongoose.Schema.Types.ObjectId, ref: "Patient" },
    patientName: { type: String, default: "" },
    phone: { type: String, default: "" },
    reportType: { type: String, default: "LAB" },
    opIpType: { type: String, default: "UNKNOWN" },
    patientType: { type: String, default: "" },
    department: { type: String, default: "" },
    procIds: [{ type: Number }],
    procedureNames: [{ type: String }],
    procedureTotal: { type: Number, default: 0 },
    approvedCount: { type: Number, default: 0 },
    readiness: { type: String, enum: ["READY", "PARTIAL", "WAITING"], default: "WAITING" },
    emrStatus: { type: String, default: "RESULT APPROVED" },
    hisReportUrl: { type: String, default: "" },
    // PENDING = waiting for its send time · QUEUED = being sent right now ·
    // NEEDS_REVIEW = the app stopped mid-send, so WATI may or may not have it.
    status: {
      type: String,
      enum: ["PENDING", "QUEUED", "SENT", "FAILED", "NEEDS_REVIEW"],
      default: "PENDING",
      index: true,
    },
    triggerType: {
      type: String,
      enum: ["AUTO_EOD", "AUTO_IMMEDIATE", "AUTO_DELAYED", "AUTO_RETRY", "MANUAL", "WEBHOOK"],
      default: "AUTO_DELAYED",
    },
    // EMR approval time of the last test — the send delay counts from here.
    reportReadyAt: { type: Date },
    // When whatsi first saw the order READY (fallback when EMR has no completion time).
    readySeenAt: { type: Date },
    scheduledSendAt: { type: Date },
    sentAt: { type: Date },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: "" },
    watiMessageId: { type: String, default: "" },
    reportDay: { type: String, index: true },
    queuedAt: { type: Date },
    lastAttemptAt: { type: Date },
    // Automatic retry: only for temporary failures, never for "no phone" / "not on WhatsApp".
    retryable: { type: Boolean, default: false },
    nextRetryAt: { type: Date },
    failureKind: {
      type: String,
      enum: ["", "NO_PHONE", "NOT_ON_WHATSAPP", "WATI_REJECTED", "TEMPORARY", "BLOCKED"],
      default: "",
    },
    // WhatsApp ticks for the latest send (from WATI webhook / status checks).
    deliveryStatus: { type: String, enum: ["", "sent", "delivered", "read", "failed"], default: "" },
    deliveredAt: { type: Date },
    readAt: { type: Date },
    sentBy: { type: String, default: "" },
  },
  { timestamps: true }
);

reportSchema.index({ reportId: 1, reportDay: 1 }, { unique: true });
reportSchema.index({ status: 1, opIpType: 1, reportReadyAt: 1 });

const orderPdfMetaSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true, index: true },
    patientId: { type: String, default: "", index: true },
    procIds: [{ type: Number }],
    hisReportUrl: { type: String, default: "" },
    source: { type: String, enum: ["MANUAL", "WEBHOOK", "SYNC", "EMR_URL"], default: "MANUAL" },
  },
  { timestamps: true }
);

/**
 * A lab report PDF saved on disk (services/pdfCache.js) — only the details
 * here; the file itself is under PDF_CACHE_DIR, never in MongoDB, so the
 * nightly backups stay small.
 */
const pdfCacheEntrySchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true },
    labDay: { type: String, default: "" },
    // Relative to PDF_CACHE_DIR: YYYY/MM/DD/<orderId>-<hash>.pdf
    path: { type: String, required: true },
    size: { type: Number, default: 0 },
    checksum: { type: String, default: "" }, // sha256 of the file
    fetchedAt: { type: Date, default: Date.now, index: true },
    approvedCount: { type: Number, default: 0 },
    procedureTotal: { type: Number, default: 0 },
    procIds: [{ type: Number }],
    // What the PDF was made from (procIds, approved count, results) — differs from the board → stale.
    contentKey: { type: String, default: "" },
    stale: { type: Boolean, default: false },
    staleAt: { type: Date, default: null },
    servedCount: { type: Number, default: 0 },
    lastServedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const hisLabOrderSchema = new mongoose.Schema(
  {
    labDay: { type: String, required: true, index: true },
    orderId: { type: String, required: true, index: true },
    patientId: { type: String, default: "", index: true },
    patientName: { type: String, default: "" },
    phone: { type: String, default: "" },
    department: { type: String, default: "" },
    opIpType: { type: String, default: "UNKNOWN" },
    opIpRaw: { type: String, default: "" },
    patientType: { type: String, default: "" },
    hisStatus: { type: String, default: "" },
    readiness: {
      type: String,
      enum: ["READY", "PARTIAL", "WAITING"],
      default: "WAITING",
      index: true,
    },
    procedureTotal: { type: Number, default: 0 },
    approvedCount: { type: Number, default: 0 },
    procIds: [{ type: Number }],
    procedureNames: [{ type: String }],
    procedures: [
      {
        name: String,
        status: String,
        procId: Number,
        completedAt: Date,
        // RESULT column from HIS, e.g. "2.25 10*3/µl" → value 2.25, unit "10*3/µl" (Lab Finder).
        result: String,
        value: Number,
        unit: String,
      },
    ],
    age: { type: String, default: "" },
    gender: { type: String, default: "" },
    doctor: { type: String, default: "" },
    statusCounts: { type: mongoose.Schema.Types.Mixed, default: {} },
    requestDate: { type: Date },
    completedAt: { type: Date },
    contentHash: { type: String, default: "" },
    lastEmrSyncAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

hisLabOrderSchema.index({ labDay: 1, orderId: 1 }, { unique: true });
hisLabOrderSchema.index({ labDay: 1, readiness: 1 });
hisLabOrderSchema.index({ "procedures.name": 1, labDay: -1 });

const labBoardDaySchema = new mongoose.Schema(
  {
    labDay: { type: String, required: true, unique: true, index: true },
    orderCount: { type: Number, default: 0 },
    lastFullSyncAt: { type: Date },
    lastIncrementalSyncAt: { type: Date },
    refreshStatus: {
      type: String,
      enum: ["idle", "running", "done", "error"],
      default: "idle",
    },
    refreshProgress: {
      chunksDone: { type: Number, default: 0 },
      chunksTotal: { type: Number, default: 0 },
      orderCount: { type: Number, default: 0 },
    },
    refreshError: { type: String, default: "" },
  },
  { timestamps: true }
);

const automationSettingsSchema = new mongoose.Schema(
  {
    automationEnabled: { type: Boolean, default: false },
    messageSendEnabled: { type: Boolean, default: false },
    // AFTER_READY: each OP report goes out `sendDelayHours` after its last test is approved.
    // END_OF_DAY: everything due goes out once a day at `endOfDayTime`.
    // (IMMEDIATE / CUSTOM_SCHEDULE are older values, read as AFTER_READY / END_OF_DAY.)
    mode: {
      type: String,
      enum: ["AFTER_READY", "END_OF_DAY", "IMMEDIATE", "CUSTOM_SCHEDULE"],
      default: "AFTER_READY",
    },
    sendDelayHours: { type: Number, default: 3, min: 0, max: 48 },
    endOfDayTime: { type: String, default: "18:00" },
    // No WhatsApp between quietStart and quietEnd (India time) — held until quietEnd.
    quietHoursEnabled: { type: Boolean, default: true },
    quietStart: { type: String, default: "21:00" },
    quietEnd: { type: String, default: "07:00" },
    // Reports approved longer ago than this are not sent automatically (staff can still send).
    maxAutoSendAgeHours: { type: Number, default: 24, min: 1, max: 168 },
    lastEodRunDay: { type: String, default: "" },
    // WhatsApp ticks: a few WATI status checks per message, within a daily cap.
    statusChecksEnabled: { type: Boolean, default: true },
    statusChecksPerDay: { type: Number, default: 100, min: 0, max: 2000 },
    // whatsi is OP-only; kept for old documents.
    scope: { type: String, enum: ["ALL", "OP_ONLY", "IP_ONLY"], default: "OP_ONLY" },
    readinessRule: { type: String, enum: ["STRICT", "PARTIAL"], default: "STRICT" },
    retryPolicy: {
      maxAttempts: { type: Number, default: 3 },
      retryIntervalMinutes: { type: Number, default: 15 },
    },
    watiTemplateName: { type: String, default: "mapims_lab_rpt" },
    watiTestSendMode: { type: Boolean, default: false },
    watiTestContactPhones: [{ type: String }],
    updatedBy: { type: String, default: "" },
    // 2 = OP-only, send N hours after approval (see migrateSettings).
    schemaVersion: { type: Number, default: 2 },
  },
  { timestamps: true }
);

const messageLogSchema = new mongoose.Schema(
  {
    reportRef: { type: mongoose.Schema.Types.ObjectId, ref: "Report" },
    reportId: { type: String, index: true },
    patientId: { type: String, index: true },
    patientName: { type: String, default: "" },
    phone: { type: String, default: "" },
    watiMessageId: { type: String, default: "" },
    templateName: { type: String, default: "" },
    reportDay: { type: String, index: true },
    status: {
      type: String,
      enum: ["SENT", "DELIVERED", "READ", "FAILED"],
      default: "SENT",
      index: true,
    },
    errorReason: { type: String, default: "" },
    requestPayload: { type: mongoose.Schema.Types.Mixed },
    responsePayload: { type: mongoose.Schema.Types.Mixed },
    sentAt: { type: Date, default: Date.now },
    triggerType: { type: String, default: "" },
    sentBy: { type: String, default: "" },
    testSend: { type: Boolean, default: false },
    // WATI ids — local_message_id from the send response, then the message id
    // reported by the webhook / getMessages.
    watiLocalMessageId: { type: String, default: "", index: true },
    deliveredAt: { type: Date },
    readAt: { type: Date },
    failedAt: { type: Date },
    statusSource: { type: String, default: "" },
    statusChecks: { type: Number, default: 0 },
    lastCheckedAt: { type: Date },
    nextCheckAt: { type: Date, index: true },
  },
  { timestamps: true }
);

messageLogSchema.index({ status: 1, sentAt: -1 });

const watiTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    displayName: { type: String, default: "" },
    category: { type: String, default: "LAB" },
    language: { type: String, default: "en" },
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "DRAFT"],
      default: "ACTIVE",
      index: true,
    },
    parameters: [{ name: String, example: String }],
    bodyPreview: { type: String, default: "" },
    isDefault: { type: Boolean, default: false },
    source: { type: String, enum: ["LOCAL", "WATI"], default: "LOCAL" },
    watiStatus: { type: String, default: "" },
    lastSyncedAt: { type: Date },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

/**
 * Staff accounts (services/users.js). role "admin" = super admin: full access,
 * manages users and Master Settings. Everyone else has per-screen permissions.
 * Sign-in is by username or email.
 */
const userSchema = new mongoose.Schema(
  {
    username: { type: String, lowercase: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, default: "" },
    designation: { type: String, default: "" },
    department: { type: String, default: "" },
    phone: { type: String, default: "" },
    role: { type: String, enum: ["admin", "staff"], default: "staff" },
    active: { type: Boolean, default: true },
    // Set by a create / reset on the Users screen: they choose their own at the next sign-in.
    mustChangePassword: { type: Boolean, default: false },
    permissions: { type: mongoose.Schema.Types.Mixed, default: null },
    // Bumped on password change / "sign out everywhere" — older tokens stop working.
    tokenVersion: { type: Number, default: 0 },
    passwordChangedAt: { type: Date },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date },
    lastLoginIp: { type: String, default: "" },
    loginCount: { type: Number, default: 0 },
    createdBy: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
  },
  // Indexes are created by migrateUsers() — the old unique email index has to go first.
  { timestamps: true, autoIndex: false }
);
userSchema.index({ username: 1 }, { unique: true, partialFilterExpression: { username: { $type: "string" } } });
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } });

export const Patient = mongoose.model("Patient", patientSchema);
export const Report = mongoose.model("Report", reportSchema);
export const OrderPdfMeta = mongoose.model("OrderPdfMeta", orderPdfMetaSchema);
export const PdfCacheEntry = mongoose.model("PdfCacheEntry", pdfCacheEntrySchema);
export const HisLabOrder = mongoose.model("HisLabOrder", hisLabOrderSchema);
export const LabBoardDay = mongoose.model("LabBoardDay", labBoardDaySchema);
export const AutomationSettings = mongoose.model("AutomationSettings", automationSettingsSchema);
export const MessageLog = mongoose.model("MessageLog", messageLogSchema);
export const WatiTemplate = mongoose.model("WatiTemplate", watiTemplateSchema);
export const User = mongoose.model("User", userSchema);

const watiApiSnapshotSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, enum: ["contacts", "connection", "usage", "statusChecks", "webhook"] },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    syncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const WatiApiSnapshot = mongoose.model("WatiApiSnapshot", watiApiSnapshotSchema);

export async function ensureAutomationSettings() {
  const existing = await AutomationSettings.findOne();
  if (!existing) {
    await AutomationSettings.create({});
  }
}
