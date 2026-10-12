import { scheduleNote } from "./schedule.js";

export function deriveWhatsappDisplay(report, lastLog, { settings = null, flags = {} } = {}) {
  if (!report) {
    return { label: "Not queued", tone: "idle" };
  }

  const testSend = Boolean(lastLog?.testSend ?? lastLog?.requestPayload?.testSend);

  if (testSend) {
    if (lastLog?.status === "SENT") {
      return { label: "Test sent", tone: "test" };
    }
    if (lastLog?.status === "FAILED" || report.status === "FAILED") {
      return { label: "Test failed", tone: "failed" };
    }
  }

  if (report.status === "SENT") {
    if (report.deliveryStatus === "read") return { label: "Read", tone: "sent" };
    if (report.deliveryStatus === "delivered") return { label: "Delivered", tone: "sent" };
    return { label: "Sent", tone: "sent" };
  }
  if (report.status === "FAILED") {
    return { label: "Failed", tone: "failed" };
  }
  if (report.status === "NEEDS_REVIEW") {
    return { label: "Check needed", tone: "failed" };
  }
  if (report.status === "QUEUED") {
    return { label: "Sending", tone: "pending" };
  }
  if (report.status === "PENDING") {
    // "Sends 2:30 pm" / "On hold" — when the 3-hour wait ends.
    const note = settings ? scheduleNote(report.toObject?.() || report, settings, flags) : "";
    return { label: note && note.startsWith("Sends") ? note : "Queued", tone: "pending" };
  }

  return {
    label: report.status || "Queued",
    tone: String(report.status || "pending").toLowerCase(),
  };
}
