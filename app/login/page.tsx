export const dynamic = "force-dynamic";

import Link from "next/link";
import { Container, Input, Button } from "@/components/ui";

export default function Login() {
  return (
    <Container wide className="min-h-screen flex items-center">
      <div className="w-full grid lg:grid-cols-[0.92fr_1.08fr] gap-6 items-stretch">
        <div className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-white/82 p-6 sm:p-8 shadow-[0_30px_100px_rgba(15,23,42,0.12)] backdrop-blur-xl">
          <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-indigo-600 via-violet-600 to-emerald-500" />
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-emerald-500 text-white flex items-center justify-center font-bold shadow-xl">
              C
            </div>
            <div>
              <div className="text-3xl font-display font-semibold tracking-tight text-slate-950">Welcome back</div>
              <div className="text-sm text-slate-600 mt-0.5">Sign in to your ColdMail Pro workspace</div>
            </div>
          </div>

          <form action="/api/auth/login" method="post" className="mt-7 grid gap-4">
            <div>
              <div className="text-sm font-semibold text-slate-700 mb-1.5">Email</div>
              <Input name="email" type="email" required placeholder="you@domain.com" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-700 mb-1.5">Password</div>
              <Input name="password" type="password" required placeholder="••••••••" />
            </div>
            <Button type="submit" className="w-full">Sign in</Button>

            <div className="flex items-center justify-between gap-3 text-xs text-slate-600 rounded-2xl border border-slate-200/80 bg-white/70 p-3">
              <span>
                Dev seed: <span className="font-mono">admin@local.test</span> / <span className="font-mono">Admin@12345</span>
              </span>
              <Link href="/setup" className="font-semibold text-indigo-700 hover:text-indigo-900">Setup</Link>
            </div>
          </form>
        </div>

        <div className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-slate-950 p-6 sm:p-8 shadow-[0_30px_100px_rgba(15,23,42,0.18)] text-white">
          <div className="absolute inset-0 bg-[radial-gradient(680px_circle_at_10%_0%,rgba(99,102,241,0.35),transparent_45%),radial-gradient(620px_circle_at_100%_20%,rgba(16,185,129,0.24),transparent_42%)]" />
          <div className="relative">
            <div className="text-sm text-white/65">What you get</div>
            <div className="mt-2 text-3xl font-display font-semibold tracking-tight">One cockpit for outbound.</div>
            <div className="mt-3 text-sm text-white/70 max-w-prose leading-6">
              Campaigns, sender pools, warmup, reply inbox, tracking, suppressions, and logs — built for self-hosting but polished like a SaaS product.
            </div>

            <div className="mt-7 grid sm:grid-cols-2 gap-3">
              {[
                { t: "Campaigns", d: "QA checks, scheduling, variants." },
                { t: "Mailboxes + Pools", d: "Rotate senders and protect reputation." },
                { t: "Warmup", d: "Seed inboxes and daily progress." },
                { t: "Replies", d: "Shared inbox with pin/snooze." },
              ].map((x) => (
                <div key={x.t} className="rounded-3xl border border-white/10 bg-white/8 p-4 backdrop-blur">
                  <div className="font-semibold text-white">{x.t}</div>
                  <div className="text-sm text-white/65 mt-1 leading-6">{x.d}</div>
                </div>
              ))}
            </div>

            <div className="mt-7 text-xs text-white/55 rounded-2xl border border-white/10 bg-white/8 p-3">
              Tip: Use <span className="font-mono">587 + STARTTLS</span> for most providers, or <span className="font-mono">465 + SSL</span>.
            </div>
          </div>
        </div>
      </div>
    </Container>
  );
}
