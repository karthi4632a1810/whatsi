import mongoose from "mongoose";

const patientSchema = new mongoose.Schema(
  {
    patientId: { type: String, required: true, index: true },
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
    phoneOverride: { type: String, default: "" },
    opIpType: { type: String, enum: ["OP", "IP", "OT", "UNKNOWN"], default: "UNKNOWN" },
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
    department: { type: String, default: "" },
    procIds: [{ type: Number }],
    procedureNames: [{ type: String }],
    procedureTotal: { type: Number, default: 0 },
    approvedCount: { type: Number, default: 0 },
    readiness: { type: String, enum: ["READY", "PARTIAL", "WAITING"], default: "WAITING" },
    emrStatus: { type: String, default: "RESULT APPROVED" },
    hisReportUrl: { type: String, default: "" },
    status: {
      type: String,
      enum: ["PENDING", "QUEUED", "SENT", "FAILED"],
      default: "PENDING",
      index: true,
    },
    triggerType: {
      type: String,
      enum: ["AUTO_EOD", "AUTO_IMMEDIATE", "MANUAL", "WEBHOOK"],
      default: "AUTO_EOD",
    },
    reportReadyAt: { type: Date },
    scheduledSendAt: { type: Date },
    sentAt: { type: Date },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: "" },
    watiMessageId: { type: String, default: "" },
    reportDay: { type: String, index: true },
  },
  { timestamps: true }
);

reportSchema.index({ reportId: 1, reportDay: 1 }, { unique: true });

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
      },
    ],
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
    mode: {
      type: String,
      enum: ["END_OF_DAY", "IMMEDIATE", "CUSTOM_SCHEDULE"],
      default: "END_OF_DAY",
    },
    endOfDayTime: { type: String, default: "18:00" },
    scope: { type: String, enum: ["ALL", "OP_ONLY", "IP_ONLY"], default: "ALL" },
    readinessRule: { type: String, enum: ["STRICT", "PARTIAL"], default: "STRICT" },
    retryPolicy: {
      maxAttempts: { type: Number, default: 3 },
      retryIntervalMinutes: { type: Number, default: 15 },
    },
    watiTemplateName: { type: String, default: "mapims_lab_rpt" },
    watiTestSendMode: { type: Boolean, default: false },
    watiTestContactPhones: [{ type: String }],
    updatedBy: { type: String, default: "" },
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
  },
  { timestamps: true }
);

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

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    name: { type: String, default: "Staff" },
    role: { type: String, enum: ["admin", "staff"], default: "staff" },
  },
  { timestamps: true }
);

export const Patient = mongoose.model("Patient", patientSchema);
export const Report = mongoose.model("Report", reportSchema);
export const OrderPdfMeta = mongoose.model("OrderPdfMeta", orderPdfMetaSchema);
export const HisLabOrder = mongoose.model("HisLabOrder", hisLabOrderSchema);
export const LabBoardDay = mongoose.model("LabBoardDay", labBoardDaySchema);
export const AutomationSettings = mongoose.model("AutomationSettings", automationSettingsSchema);
export const MessageLog = mongoose.model("MessageLog", messageLogSchema);
export const WatiTemplate = mongoose.model("WatiTemplate", watiTemplateSchema);
export const User = mongoose.model("User", userSchema);

const watiApiSnapshotSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, enum: ["contacts", "connection", "usage"] },
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
