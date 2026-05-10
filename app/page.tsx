import Link from "next/link";
import { Container, Button } from "@/components/ui";
import { getSession } from "@/lib/auth";

export default async function Home() {
  const s = await getSession();
  return (
    <Container wide className="min-h-screen flex items-center">
      <div className="w-full relative overflow-hidden rounded-[2.4rem] border border-white/70 bg-white/75 shadow-[0_35px_120px_rgba(15,23,42,0.12)] backdrop-blur-xl">
        <div className="absolute inset-0 soft-grid opacity-70" />
        <div className="absolute -top-32 -left-24 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="absolute -bottom-32 right-0 h-96 w-96 rounded-full bg-emerald-500/18 blur-3xl" />
        <div className="relative grid lg:grid-cols-[1.15fr_0.85fr] gap-8 p-7 sm:p-10 lg:p-14 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/75 px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.16)]" />
              Self-hosted outreach command center
            </div>
            <div className="mt-5 flex items-center gap-4">
              <div className="h-16 w-16 rounded-[1.6rem] bg-gradient-to-br from-indigo-600 via-violet-600 to-emerald-500 text-white flex items-center justify-center text-2xl font-bold shadow-xl">
                C
              </div>
              <div>
                <h1 className="text-4xl sm:text-6xl font-display font-semibold tracking-tight text-slate-950">ColdMail Pro</h1>
                <p className="mt-2 text-base sm:text-lg text-slate-600 max-w-2xl">
                  Campaigns, sender pools, warmup, tracking, suppressions, replies, and logs — rebuilt as a polished operating system for outbound teams.
                </p>
              </div>
            </div>

            <div className="mt-8 flex items-center gap-3 flex-wrap">
              {s ? (
                <Link href="/app"><Button>Open app</Button></Link>
              ) : (
                <Link href="/login"><Button>Login</Button></Link>
              )}
              <Link href="/setup" className="px-4 py-2.5 rounded-2xl text-sm font-semibold border border-slate-200 bg-white/80 hover:bg-white transition shadow-sm">
                Setup steps
              </Link>
              <span className="text-xs text-slate-500 rounded-2xl bg-white/60 border border-slate-200/80 px-3 py-2">
                Dev seed: <span className="font-mono">admin@local.test</span> / <span className="font-mono">Admin@12345</span>
              </span>
            </div>
          </div>

          <div className="grid gap-4">
            {[
              { t: "Launch campaigns faster", d: "Campaign wizard, QA checks, scheduling, throttling, and A/B controls in one workflow.", icon: "🚀" },
              { t: "Protect deliverability", d: "Warmup, pools, mailbox hygiene, guardrails, and IMAP reply detection are baked in.", icon: "🛡️" },
              { t: "Operate like a team", d: "Analytics, logs, lead management, and a shared replies inbox keep every move visible.", icon: "✨" },
            ].map((x) => (
              <div key={x.t} className="rounded-[1.6rem] border border-white/70 bg-white/72 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.07)] backdrop-blur">
                <div className="flex items-start gap-3">
                  <div className="h-11 w-11 rounded-2xl bg-slate-950 text-white grid place-items-center shadow-sm">{x.icon}</div>
                  <div>
                    <div className="font-semibold text-slate-950 font-display">{x.t}</div>
                    <div className="text-sm text-slate-600 mt-1 leading-6">{x.d}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Container>
  );
}
