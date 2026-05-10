import { Container, Card, PageHeader, SegmentedNav, Button, Pill } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import WarmupClient from "./WarmupClient";

export default async function WarmupPage() {
  try {
    await requireSession();
  } catch {
    return (
      <Container>
        <Card title="Warmup" subtitle="Enterprise warmup suite">
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm">You are not logged in.</div>
        </Card>
      </Container>
    );
  }

  return (
    <Container wide>
      <PageHeader
        title="Warmup Studio"
        subtitle="Prepare sender reputation with profiles, seed inboxes, templates, placement checks, and safe ramp controls."
        right={
          <div className="flex items-center gap-3 flex-wrap justify-end">
            <SegmentedNav
              active="warmup"
              items={[
                { value: "mailboxes", label: "📮 Mailboxes", href: "/app/mailboxes" },
                { value: "pools", label: "🧺 Pools", href: "/app/mailboxes/pools" },
                { value: "warmup", label: "🔥 Warmup", href: "/app/mailboxes/warmup" },
                { value: "control", label: "🧭 Control", href: "/app/mailboxes/warmup/control-center" },
              ]}
            />
            <a href="/app/mailboxes/warmup/control-center"><Button type="button" variant="secondary">Open control center</Button></a>
          </div>
        }
      />

      <div className="mt-6 grid grid-cols-1 2xl:grid-cols-[390px_minmax(0,1fr)] gap-6 items-start">
        <aside className="2xl:sticky 2xl:top-6 relative overflow-hidden rounded-[2rem] border border-slate-900/10 bg-gradient-to-br from-orange-500 via-rose-500 to-indigo-700 p-6 text-white shadow-[0_30px_90px_rgba(244,63,94,0.25)]">
          <div className="absolute -right-20 -top-20 h-52 w-52 rounded-full bg-white/20 blur-3xl" />
          <div className="relative">
            <Pill tone="warning">Reputation engine</Pill>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight font-display">Warm slowly. Scale confidently.</h2>
            <p className="mt-2 text-sm leading-6 text-white/80">
              Keep senders alive with consistent low-risk activity before campaigns push real volume.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl border border-white/20 bg-white/15 p-3"><div className="text-white/70">Signal</div><div className="font-semibold">Placement</div></div>
              <div className="rounded-2xl border border-white/20 bg-white/15 p-3"><div className="text-white/70">Guardrail</div><div className="font-semibold">Ramp caps</div></div>
              <div className="rounded-2xl border border-white/20 bg-white/15 p-3"><div className="text-white/70">Inbox</div><div className="font-semibold">Seed checks</div></div>
              <div className="rounded-2xl border border-white/20 bg-white/15 p-3"><div className="text-white/70">Worker</div><div className="font-semibold">Auto schedule</div></div>
            </div>
          </div>
        </aside>

        <WarmupClient />
      </div>
    </Container>
  );
}
