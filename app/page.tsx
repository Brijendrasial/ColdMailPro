import Link from "next/link";
import { Container, Button } from "@/components/ui";
import { getSession } from "@/lib/auth";

export default async function Home() {
  const s = await getSession();
  return (
    <Container>
      <div className="grid gap-8">
        <div className="glass p-8 sm:p-10">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-indigo-600 to-emerald-500 text-white flex items-center justify-center font-bold shadow-soft">
              C
            </div>
            <div>
              <div className="text-3xl sm:text-4xl font-display font-semibold tracking-tight">ColdMail Pro</div>
              <div className="text-sm text-slate-600 mt-1">
                Self-hosted cold-email platform — campaigns, sender pools, warmup, tracking, suppressions.
              </div>
            </div>
          </div>

          <div className="mt-8 grid lg:grid-cols-3 gap-4">
            {[{
              t: "Ship campaigns faster",
              d: "Campaign wizard, QA checks, scheduling and throttling — everything in one view.",
            },{
              t: "Keep deliverability healthy",
              d: "Warmup, pools, and mailbox hygiene tools (with IMAP reply detection).",
            },{
              t: "Operate with confidence",
              d: "Logs, analytics and a shared replies inbox for team workflows.",
            }].map((x) => (
              <div key={x.t} className="rounded-2xl border border-slate-200 bg-white/55 p-5">
                <div className="font-medium text-slate-900">{x.t}</div>
                <div className="text-sm text-slate-600 mt-2">{x.d}</div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex items-center gap-3 flex-wrap">
            {s ? (
              <Link href="/app"><Button>Open app</Button></Link>
            ) : (
              <Link href="/login"><Button>Login</Button></Link>
            )}
            <Link href="/setup" className="px-4 py-2 rounded-2xl text-sm font-medium border border-slate-200 bg-white/70 hover:bg-white transition">
              Setup steps
            </Link>
            <div className="text-xs text-slate-500">
              Tip: Default dev seed is <span className="font-mono">admin@local.test</span> / <span className="font-mono">Admin@12345</span>
            </div>
          </div>
        </div>
      </div>
    </Container>
  );
}
