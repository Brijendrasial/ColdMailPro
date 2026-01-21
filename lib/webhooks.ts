import crypto from "crypto";
import { prisma } from "./prisma";
import { appLogAsync } from "@/lib/app-log";

export async function dispatchWebhooks(workspaceId: string, eventType: string, payload: any) {
  const hooks = await prisma.webhookEndpoint.findMany({
    where: { workspaceId, isActive: true },
  });

  const body = JSON.stringify({ type: eventType, payload, ts: Date.now() });

  const targets = hooks
    .filter((h) => (h.events || "").split(",").map((s) => s.trim()).includes(eventType));

  void appLogAsync({
    level: "info",
    category: "webhook",
    event: "dispatch",
    message: `${eventType} -> ${targets.length} endpoints`,
    workspaceId,
    data: { eventType, count: targets.length },
  });

  await Promise.allSettled(
    targets.map(async (h) => {
      const sig = crypto.createHmac("sha256", h.secret).update(body).digest("hex");
      const started = Date.now();
      try {
        const res = await fetch(h.url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-coldmail-signature": sig },
          body,
        });
        void appLogAsync({
          level: res.ok ? "info" : "warn",
          category: "webhook",
          event: "deliver",
          message: `${h.url} ${res.status}`,
          workspaceId,
          data: { url: h.url, status: res.status, ms: Date.now() - started },
        });
      } catch (e: any) {
        void appLogAsync({
          level: "error",
          category: "webhook",
          event: "deliver_error",
          message: String(e?.message || e),
          workspaceId,
          data: { url: h.url, ms: Date.now() - started, stack: e?.stack },
        });
      }
    })
  );
}
