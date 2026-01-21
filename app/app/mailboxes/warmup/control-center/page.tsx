import Link from "next/link";
import { Container, Card } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import WarmupControlCenterClient from "./WarmupControlCenterClient";

function SubTabs({ active }: { active: "mailboxes" | "pools" | "warmup" | "control" }) {
  const base = "px-3 py-1.5 rounded-xl text-sm border transition";
  const on = "bg-slate-900 text-white border-slate-900/20";
  const off = "bg-white text-slate-700 border-slate-200 hover:bg-slate-50";
  return (
    <div className="inline-flex items-center gap-2 flex-wrap">
      <Link className={`${base} ${active === "mailboxes" ? on : off}`} href="/app/mailboxes">
        📮 Mailboxes
      </Link>
      <Link className={`${base} ${active === "pools" ? on : off}`} href="/app/mailboxes/pools">
        🧺 Pools
      </Link>
      <Link className={`${base} ${active === "warmup" ? on : off}`} href="/app/mailboxes/warmup">
        🔥 Warmup
      </Link>
      <Link className={`${base} ${active === "control" ? on : off}`} href="/app/mailboxes/warmup/control-center">
        🧭 Control Center
      </Link>
    </div>
  );
}

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
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <div className="text-2xl font-semibold">🧭 Warmup Control Center</div>
          <div className="text-sm text-slate-500">Worker health, mailbox warmup health, placement and logs.</div>
        </div>
        <SubTabs active="control" />
      </div>

      <WarmupControlCenterClient />
    </Container>
  );
}
