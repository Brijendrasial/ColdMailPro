import Link from "next/link";
import { Container, Card } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import PoolsClient from "./pools-client";

function SubTabs({ active }: { active: "mailboxes" | "pools" | "warmup" }) {
  const base = "px-3 py-1.5 rounded-xl text-sm border transition";
  const on = "bg-slate-900 text-white border-slate-900/20";
  const off = "bg-white text-slate-700 border-slate-200 hover:bg-slate-50";
  return (
    <div className="inline-flex items-center gap-2">
      <Link className={`${base} ${active === "mailboxes" ? on : off}`} href="/app/mailboxes">
        📮 Mailboxes
      </Link>
      <Link className={`${base} ${active === "pools" ? on : off}`} href="/app/mailboxes/pools">
        🧺 Pools
      </Link>
      <Link className={`${base} ${active === "warmup" ? on : off}`} href="/app/mailboxes/warmup">
        🔥 Warmup
      </Link>
    </div>
  );
}

export default async function MailboxPoolsPage() {
  await requireSession();
  return (
    <Container>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="text-xl font-semibold">Mailbox Pools</div>
          <div className="text-sm text-slate-600 mt-0.5">
            Group mailboxes and route campaigns via <span className="font-medium">round-robin</span>, <span className="font-medium">weighted</span>, or
            <span className="font-medium"> least-recent</span> strategies.
          </div>
        </div>
        <SubTabs active="pools" />
      </div>

      <Card title="Pools" subtitle="Create pools, assign mailboxes, and tune weights.">
        <PoolsClient />
      </Card>
    </Container>
  );
}
