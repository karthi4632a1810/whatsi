export function applyHisFilter(orders, filter = "all") {
  const list = orders || [];
  if (filter === "approved") {
    return list.filter((o) => o.statusCounts?.["RESULT APPROVED"]);
  }
  if (filter === "ready") {
    return list.filter((o) => o.readiness === "READY");
  }
  if (filter === "completed") {
    return list.filter(
      (o) => o.hisStatus === "RESULT APPROVED" || o.hisStatus === "COMPLETED"
    );
  }
  return list;
}

export function applyHisSearch(orders, query = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return orders || [];

  const digits = q.replace(/\D/g, "");
  return (orders || []).filter((order) => {
    const patientId = String(order.patientId || "").toLowerCase();
    const orderId = String(order.orderId || "").toLowerCase();
    const patientName = String(order.patientName || "").toLowerCase();
    const phone = String(order.phone || "").replace(/\D/g, "");

    if (patientId.includes(q) || orderId.includes(q) || patientName.includes(q)) return true;
    if (digits && (patientId.includes(digits) || orderId.includes(digits) || phone.includes(digits))) {
      return true;
    }
    return false;
  });
}

export function filterHisOrders(orders, { filter = "all", query = "" } = {}) {
  return applyHisSearch(applyHisFilter(orders, filter), query);
}

export function computeHisSummary(orders) {
  const list = orders || [];
  return {
    totalOrders: list.length,
    ready: list.filter((o) => o.readiness === "READY").length,
    partial: list.filter((o) => o.readiness === "PARTIAL").length,
    approved: list.filter((o) => o.hisStatus === "RESULT APPROVED").length,
    inProcess: list.filter((o) => o.statusCounts?.["IN PROCESS"]).length,
    sent: list.filter((o) => o.whatsappTone === "sent").length,
    pendingWhatsApp: list.filter(
      (o) => o.whatsappTone === "pending" || o.whatsappTone === "idle"
    ).length,
    testSent: list.filter((o) => o.whatsappTone === "test").length,
  };
}
