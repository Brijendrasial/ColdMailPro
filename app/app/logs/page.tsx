import { Container, Card, Badge, PageHeader, Pill } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import LogsClient from "./LogsClient";

export default async function Logs() {
  const s = await requireSession();

  const initialLogs = await (prisma as any).appLog.findMany({
    where: {
      OR: [{ workspaceId: s.wid }, { workspaceId: null }],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  });

  const initialCursor = initialLogs.length ? String(initialLogs[initialLogs.length - 1].id) : null;

  const msgs = await prisma.message.findMany({
    where: { workspaceId: s.wid },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { lead: true, mailbox: true, campaign: true },
  });

  return (
    <Container wide>
      <PageHeader
        title="Logs"
        subtitle="Central place to see what the app is doing (DB writes, worker, mail, webhooks, UI errors, and message history)."
      />

      <div className="mt-6 grid grid-cols-1 xl:grid-cols-2 gap-6">
        <LogsClient initialLogs={initialLogs} initialCursor={initialCursor} />

        <Card title="Messages" subtitle="Latest 200 message attempts (campaign sends + manual)">
          <div className="grid gap-2">
            {msgs.map((m) => (
              <div
                key={m.id}
                className="border-b border-slate-200/70 py-2 flex items-center justify-between gap-3 flex-wrap"
              >
                <div className="text-sm min-w-0">
                  <div className="font-medium truncate">{m.subject || "(no subject)"}</div>
                  <div className="text-xs text-slate-600 mt-0.5 truncate">
                    to {m.lead?.email || "-"} • from {m.mailbox?.fromEmail || "-"} • {m.campaign?.name || "manual"}
                  </div>
                  {m.error ? <div className="text-xs text-slate-600 mt-1 break-words">{m.error.slice(0, 240)}</div> : null}
                </div>
                <div className="flex gap-2 items-center">
                  <Pill tone={m.status === "sent" ? "success" : m.status === "failed" ? "danger" : "neutral"}>{m.status}</Pill>
                  <Badge>{new Date(m.createdAt).toLocaleString()}</Badge>
                </div>
              </div>
            ))}
            {msgs.length === 0 ? <div className="text-sm text-slate-600">No messages yet.</div> : null}
          </div>
        </Card>
      </div>
    </Container>
  );
}
