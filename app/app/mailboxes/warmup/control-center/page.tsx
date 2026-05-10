import { Container, Card, PageHeader, SegmentedNav, Pill } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import WarmupControlCenterClient from "./WarmupControlCenterClient";

export default async function WarmupControlCenterPage() {
  try {
    await requireSession();
  } catch {
    return (
      <Container>
        <Card title="Warmup Control Center" subtitle="Diagnostics and controls">
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm">You are not logged in.</div>
        </Card>
      </Container>
    );
  }

  return (
    <Container wide>
      <PageHeader
        title="Warmup Control Center"
        subtitle="Monitor worker health, mailbox warmup status, placement, logs, and emergency controls from one operator screen."
        right={
          <SegmentedNav
            active="control"
            items={[
              { value: "mailboxes", label: "📮 Mailboxes", href: "/app/mailboxes" },
              { value: "pools", label: "🧺 Pools", href: "/app/mailboxes/pools" },
              { value: "warmup", label: "🔥 Warmup", href: "/app/mailboxes/warmup" },
              { value: "control", label: "🧭 Control", href: "/app/mailboxes/warmup/control-center" },
            ]}
          />
        }
      />

      <div className="mt-6 grid grid-cols-1 2xl:grid-cols-[360px_minmax(0,1fr)] gap-6 items-start">
        <aside className="2xl:sticky 2xl:top-6 relative overflow-hidden rounded-[2rem] border border-slate-900/10 bg-slate-950 p-6 text-white shadow-[0_30px_90px_rgba(15,23,42,0.22)]">
          <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-cyan-500/30 blur-3xl" />
          <div className="relative">
            <Pill tone="info">Operations</Pill>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight font-display">Diagnose warmup before deliverability slips.</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Use this page when warmup volume stalls, placement drops, or senders need manual intervention.
            </p>
          </div>
        </aside>
        <WarmupControlCenterClient />
      </div>
    </Container>
  );
}
