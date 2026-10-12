// Fake WATI API for integration tests. Never talks to the real WATI.
import http from "node:http";
import crypto from "node:crypto";

export function startMockWati(port = 9911) {
  const sends = []; // { phone, localMessageId, at, params }
  let readFor = new Set();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    let body = "";
    for await (const chunk of req) body += chunk;
    const json = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };

    if (req.method === "POST" && url.pathname.endsWith("/api/v1/sendTemplateMessage")) {
      const phone = url.searchParams.get("whatsappNumber");
      await new Promise((r) => setTimeout(r, 300)); // widen any race window
      if (phone.endsWith("08")) return json(500, { error: "upstream down" });
      const localMessageId = crypto.randomUUID();
      const payload = JSON.parse(body || "{}");
      sends.push({ phone, localMessageId, at: new Date(), params: payload.parameters });
      if (phone.endsWith("07")) {
        return json(200, { result: true, validWhatsAppNumber: false, local_message_id: localMessageId });
      }
      return json(200, { result: true, validWhatsAppNumber: true, local_message_id: localMessageId, info: "ok" });
    }

    const m = url.pathname.match(/\/api\/v1\/getMessages\/(\d+)$/);
    if (req.method === "GET" && m) {
      const items = sends
        .filter((s) => s.phone === m[1])
        .map((s) => ({
          id: `wamid-${s.localMessageId.slice(0, 8)}`,
          localMessageId: s.localMessageId,
          created: s.at.toISOString(),
          eventType: "broadcastMessage",
          statusString: readFor.has(s.phone) ? "READ" : "DELIVERED",
          finalText: `Dear ${s.params?.[0]?.value || ""}, your lab report is attached`,
        }));
      return json(200, { messages: { items } });
    }
    json(404, { error: "not mocked" });
  });

  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () =>
      resolve({
        sends,
        markRead: (phone) => readFor.add(phone),
        close: () => new Promise((r) => server.close(r)),
      })
    )
  );
}
