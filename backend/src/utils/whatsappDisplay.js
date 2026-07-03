export function deriveWhatsappDisplay(report, lastLog) {
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
    return { label: "Sent", tone: "sent" };
  }
  if (report.status === "FAILED") {
    return { label: "Failed", tone: "failed" };
  }
  if (report.status === "PENDING" || report.status === "QUEUED") {
    return { label: "Queued", tone: "pending" };
  }

  return {
    label: report.status || "Queued",
    tone: String(report.status || "pending").toLowerCase(),
  };
}
