import { Container, Card, PageHeader, SegmentedNav, Pill } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import PoolsClient from "./pools-client";

export default async function MailboxPoolsPage() {
  await requireSession();
  return (
    <Container wide>
      <PageHeader
        title="Mailbox Pools"
        subtitle="Group senders into smart routing pools for safer scale: round-robin, weighted, and least-recent delivery strategies."
        right={
          <SegmentedNav
            active="pools"
            items={[
              { value: "mailboxes", label: "📮 Mailboxes", href: "/app/mailboxes" },
              { value: "pools", label: "🧺 Pools", href: "/app/mailboxes/pools" },
              { value: "warmup", label: "🔥 Warmup", href: "/app/mailboxes/warmup" },
            ]}
          />
        }
      />

      <div className="mt-6 grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-6 items-start">
        <aside className="xl:sticky xl:top-6 relative overflow-hidden rounded-[2rem] border border-slate-900/10 bg-slate-950 p-6 text-white shadow-[0_30px_90px_rgba(15,23,42,0.22)]">
          <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-violet-500/30 blur-3xl" />
          <div className="relative">
            <Pill tone="info">Routing brain</Pill>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight font-display">Balance volume without burning one inbox.</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Pools let campaigns rotate through healthy senders, respect limits, and reduce domain concentration risk.
            </p>
            <div className="mt-5 grid gap-2 text-sm text-slate-200">
              <div className="rounded-2xl border border-white/10 bg-white/10 p-3">↻ Round-robin for simple even rotation</div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-3">⚖ Weighted for high-trust senders</div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-3">⏱ Least-recent for natural spacing</div>
            </div>
          </div>
        </aside>

        <Card title="Pool builder" subtitle="Create pools, assign mailboxes, tune weights, and attach campaigns to the right sender mix.">
          <PoolsClient />
        </Card>
      </div>
    </Container>
  );
}
