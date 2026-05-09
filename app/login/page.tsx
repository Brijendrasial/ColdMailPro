export const dynamic = "force-dynamic";

import Link from "next/link";
import { Container, Input, Button } from "@/components/ui";

export default function Login() {
  return (
    <Container>
      <div className="min-h-[70vh] flex items-center">
        <div className="w-full grid lg:grid-cols-2 gap-6 items-stretch">
          <div className="glass p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-indigo-600 to-emerald-500 text-white flex items-center justify-center font-bold shadow-soft">
                C
              </div>
              <div>
                <div className="text-2xl font-display font-semibold tracking-tight">ColdMail Pro</div>
                <div className="text-sm text-slate-600 mt-0.5">Sign in to your workspace</div>
              </div>
            </div>

            <form action="/api/auth/login" method="post" className="mt-6 grid gap-4">
              <div>
                <div className="text-sm font-medium text-slate-700 mb-1">Email</div>
                <Input name="email" type="email" required placeholder="you@domain.com" />
              </div>
              <div>
                <div className="text-sm font-medium text-slate-700 mb-1">Password</div>
                <Input name="password" type="password" required placeholder="••••••••" />
              </div>
              <Button type="submit" className="w-full">Sign in</Button>

              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>
                  Dev seed: <span className="font-mono">admin@local.test</span> / <span className="font-mono">Admin@12345</span>
                </span>
                <Link href="/setup" className="underline hover:text-slate-900">Setup</Link>
              </div>
            </form>
          </div>

          <div className="glass p-6 sm:p-8">
            <div className="text-sm text-slate-600">What you get</div>
            <div className="mt-2 text-2xl font-display font-semibold tracking-tight">Everything in one place.</div>
            <div className="mt-3 text-sm text-slate-600 max-w-prose">
              Campaigns, sender pools, warmup, reply inbox, tracking, suppressions, and logs — built for self-hosting.
            </div>

            <div className="mt-6 grid gap-3">
              {[
                { t: "Campaigns", d: "Instantly-style controls, QA checks, scheduling." },
                { t: "Mailboxes + Pools", d: "Rotate senders, bind IPs, keep reputation healthy." },
                { t: "Warmup", d: "Seed inboxes, templates, and daily progress." },
                { t: "Replies", d: "Shared inbox workflows with pin/snooze." },
              ].map((x) => (
                <div key={x.t} className="rounded-2xl border border-slate-200 bg-white/50 p-4">
                  <div className="font-medium text-slate-900">{x.t}</div>
                  <div className="text-sm text-slate-600 mt-1">{x.d}</div>
                </div>
              ))}
            </div>

            <div className="mt-6 text-xs text-slate-500">
              Tip: Use <span className="font-mono">587 + STARTTLS</span> for most providers, or <span className="font-mono">465 + SSL</span>.
            </div>
          </div>
        </div>
      </div>
    </Container>
  );
}
