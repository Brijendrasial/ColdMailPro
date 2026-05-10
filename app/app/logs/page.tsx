import { Container, Badge, Button, Pill } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import LogsClient from "./LogsClient";

function statusTone(status: string): "success" | "danger" | "warning" | "neutral" | "info" {
  const s = String(status || "").toLowerCase();
  if (s === "sent" || s === "delivered") return "success";
  if (s === "failed" || s === "bounced") return "danger";
  if (s === "queued" || s === "sending") return "warning";
  if (s === "replied") return "info";
  return "neutral";
}

function shortTime(v: any) {
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v || "-");
  }
}

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

  const logLevelCounts = initialLogs.reduce(
    (acc: Record<string, number>, row: any) => {
      const key = String(row.level || "info").toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    {}
  );
  const messageStatusCounts = msgs.reduce(
    (acc: Record<string, number>, row: any) => {
      const key = String(row.status || "unknown").toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    {}
  );
  const failedMessages = messageStatusCounts.failed || messageStatusCounts.bounced || 0;
  const systemLogs = initialLogs.filter((row: any) => !row.workspaceId).length;
  const latestLogAt = initialLogs[0]?.createdAt ? shortTime(initialLogs[0].createdAt) : "No logs yet";

  return (
    <Container wide className="space-y-7">
      <section className="relative overflow-hidden rounded-[2.4rem] border border-white/70 bg-slate-950 text-white shadow-[0_32px_90px_rgba(15,23,42,0.22)]">
        <div className="absolute inset-0 bg-[radial-gradient(900px_circle_at_8%_0%,rgba(99,102,241,0.38),transparent_44%),radial-gradient(820px_circle_at_92%_20%,rgba(20,184,166,0.34),transparent_42%),linear-gradient(135deg,#020617,#111827_52%,#042f2e)]" />
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="absolute left-8 bottom-0 h-px w-[42rem] max-w-[80%] bg-gradient-to-r from-indigo-300 via-cyan-200 to-transparent" />
        <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_430px] lg:p-10">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/75 shadow-sm backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_0_4px_rgba(52,211,153,0.18)]" />
              Observability cockpit
            </div>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Logs</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
              Watch DB writes, worker jobs, mail attempts, webhooks, UI errors, and message history from one clean control room.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Badge>Latest event: {latestLogAt}</Badge>
              <Badge>{systemLogs} system events loaded</Badge>
              <Badge>{msgs.length} message attempts</Badge>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[1.4rem] border border-white/10 bg-white/10 p-4 backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Events loaded</div>
              <div className="mt-3 text-3xl font-semibold">{initialLogs.length}</div>
              <div className="mt-1 text-xs text-slate-400">latest 100 unified logs</div>
            </div>
            <div className="rounded-[1.4rem] border border-white/10 bg-white/10 p-4 backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Errors</div>
              <div className="mt-3 text-3xl font-semibold">{logLevelCounts.error || 0}</div>
              <div className="mt-1 text-xs text-slate-400">error-level events loaded</div>
            </div>
            <div className="rounded-[1.4rem] border border-white/10 bg-white/10 p-4 backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Warnings</div>
              <div className="mt-3 text-3xl font-semibold">{logLevelCounts.warn || 0}</div>
              <div className="mt-1 text-xs text-slate-400">warning signals</div>
            </div>
            <div className="rounded-[1.4rem] border border-white/10 bg-white/10 p-4 backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Mail failures</div>
              <div className="mt-3 text-3xl font-semibold">{failedMessages}</div>
              <div className="mt-1 text-xs text-slate-400">from recent messages</div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.12fr)_minmax(420px,0.88fr)]">
        <LogsClient initialLogs={initialLogs} initialCursor={initialCursor} />

        <section className="premium-card">
          <div className="p-4 sm:p-5 lg:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.14)]" />
                  <h2 className="card-title">Message flight recorder</h2>
                </div>
                <p className="card-subtitle">Latest 200 sends and manual messages with status, recipient, mailbox, and campaign context.</p>
              </div>
              <Pill tone={failedMessages ? "warning" : "success"}>{failedMessages ? `${failedMessages} need review` : "clean"}</Pill>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries({ sent: messageStatusCounts.sent || 0, replied: messageStatusCounts.replied || 0, failed: messageStatusCounts.failed || 0, queued: messageStatusCounts.queued || 0 }).map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-slate-200/80 bg-white/78 p-3 shadow-sm">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-950">{value}</div>
                </div>
              ))}
            </div>

            <div className="mt-5 max-h-[760px] space-y-3 overflow-auto pr-1">
              {msgs.map((m) => (
                <article key={m.id} className="group rounded-[1.35rem] border border-slate-200/80 bg-white/78 p-4 shadow-sm transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-xs font-bold text-white shadow-sm">
                          {(m.lead?.email || m.mailbox?.fromEmail || "M").slice(0, 1).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-950">{m.subject || "(no subject)"}</div>
                          <div className="mt-0.5 truncate text-xs text-slate-500">{shortTime(m.createdAt)}</div>
                        </div>
                      </div>
                      <div className="mt-3 text-xs leading-5 text-slate-600">
                        <span className="font-semibold text-slate-800">to</span> {m.lead?.email || "-"} <span className="text-slate-300">•</span>{" "}
                        <span className="font-semibold text-slate-800">from</span> {m.mailbox?.fromEmail || "-"} <span className="text-slate-300">•</span>{" "}
                        <span className="font-semibold text-slate-800">campaign</span> {m.campaign?.name || "manual"}
                      </div>
                      {m.error ? (
                        <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50/80 p-3 text-xs leading-5 text-rose-700">
                          {m.error.slice(0, 260)}
                        </div>
                      ) : null}
                    </div>
                    <Pill tone={statusTone(m.status)}>{m.status}</Pill>
                  </div>
                </article>
              ))}
              {msgs.length === 0 ? (
                <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-white/60 p-8 text-center text-sm text-slate-600">
                  No message attempts yet.
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </Container>
  );
}
