import type { ReactNode } from "react";
import { Container, Button, Input, PageHeader, SegmentedNav, Card, Pill } from "@/components/ui";
import MailboxesClient from "./MailboxesClient";
import { requireSession } from "@/lib/auth";

function Field({ label, children, hint }: { label: string; children?: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      {children}
      {hint ? <div className="mt-1.5 text-xs leading-5 text-slate-500">{hint}</div> : null}
    </label>
  );
}

export default async function Mailboxes({ searchParams }: { searchParams?: { ok?: string; sent?: string; err?: string; to?: string; mid?: string } }) {
  await requireSession();
  return (
    <Container wide>
      {searchParams?.ok ? (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm font-medium text-emerald-800 shadow-sm">
          ✅ Mailbox saved.
        </div>
      ) : null}
      {searchParams?.sent ? (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm font-medium text-emerald-800 shadow-sm">
          ✅ Test email sent{searchParams.to ? ` to ${searchParams.to}` : ""}{searchParams.mid ? ` (message-id: ${searchParams.mid})` : ""}.
        </div>
      ) : null}
      {searchParams?.err ? (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm font-medium text-red-800 shadow-sm">
          ❌ {searchParams.err}
        </div>
      ) : null}

      <PageHeader
        title="Mailbox Command Center"
        subtitle="Connect SMTP/IMAP senders, watch health signals, run tests, and keep every inbox campaign-ready."
        right={
          <div className="flex items-center gap-3 flex-wrap justify-end">
            <SegmentedNav
              active="mailboxes"
              items={[
                { value: "mailboxes", label: "📮 Mailboxes", href: "/app/mailboxes" },
                { value: "pools", label: "🧺 Pools", href: "/app/mailboxes/pools" },
                { value: "warmup", label: "🔥 Warmup", href: "/app/mailboxes/warmup" },
              ]}
            />
            <a href="#add-mailbox">
              <Button type="button">+ Add sender</Button>
            </a>
          </div>
        }
      />

      <div className="mt-6 grid grid-cols-1 xl:grid-cols-[430px_minmax(0,1fr)] gap-6 items-start">
        <aside className="xl:sticky xl:top-6 grid gap-4">
          <section className="relative overflow-hidden rounded-[2rem] border border-slate-900/10 bg-slate-950 p-6 text-white shadow-[0_30px_90px_rgba(15,23,42,0.22)]">
            <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-indigo-500/30 blur-3xl" />
            <div className="absolute -left-20 bottom-0 h-40 w-40 rounded-full bg-cyan-400/20 blur-3xl" />
            <div className="relative">
              <Pill tone="info">Sender fleet</Pill>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight font-display">Launch safer from healthy inboxes.</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Add SMTP for sending, IMAP for reply detection, then use health checks and test sends before attaching inboxes to campaigns.
              </p>
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
                  <div className="text-slate-400">Step 1</div>
                  <div className="mt-1 font-semibold">Connect SMTP</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
                  <div className="text-slate-400">Step 2</div>
                  <div className="mt-1 font-semibold">Enable IMAP</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
                  <div className="text-slate-400">Step 3</div>
                  <div className="mt-1 font-semibold">Run checks</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
                  <div className="text-slate-400">Step 4</div>
                  <div className="mt-1 font-semibold">Assign to campaign</div>
                </div>
              </div>
            </div>
          </section>

          <Card title="Operator shortcuts" subtitle="Common sender-fleet actions.">
            <div className="grid gap-2">
              <a className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" href="/app/mailboxes/pools">
                🧺 Build mailbox pools
              </a>
              <a className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" href="/app/mailboxes/warmup">
                🔥 Manage warmup
              </a>
              <a className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" href="/app/campaigns">
                🚀 Attach senders to campaigns
              </a>
            </div>
          </Card>
        </aside>

        <main className="grid gap-6 min-w-0">
          <Card
            title="Add a mailbox"
            subtitle="SMTP sends mail. IMAP is optional but strongly recommended for reply detection and auto-stop."
            right={<Pill tone="success">Secure credentials</Pill>}
            className="scroll-mt-6"
          >
            <form id="add-mailbox" action="/api/mailboxes/create" method="post" className="grid gap-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Field label="Display name">
                  <Input name="name" required placeholder="Brijendra Sial" />
                </Field>
                <Field label="From email">
                  <Input name="fromEmail" required placeholder="brijendra@yourdomain.com" />
                </Field>
              </div>

              <div className="rounded-[1.6rem] border border-indigo-100 bg-indigo-50/50 p-4 sm:p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-950">SMTP sending settings</div>
                    <div className="mt-1 text-xs text-slate-600">Required for sending campaigns and test emails.</div>
                  </div>
                  <Pill tone="info">Required</Pill>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_160px] gap-4">
                  <Field label="SMTP host">
                    <Input name="smtpHost" required placeholder="smtp.yourdomain.com" />
                  </Field>
                  <Field label="SMTP port">
                    <Input name="smtpPort" type="number" required defaultValue="587" />
                  </Field>
                </div>
                <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Field label="SMTP user">
                    <Input name="smtpUser" required placeholder="usually your full email" />
                  </Field>
                  <Field label="SMTP password">
                    <Input name="smtpPass" type="password" required placeholder="app password or mailbox password" />
                  </Field>
                </div>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                  <label className="flex items-center gap-2 rounded-2xl border border-white/70 bg-white/70 px-4 py-3 text-sm font-medium text-slate-700 shadow-sm">
                    <Input name="smtpSecure" type="checkbox" />
                    SMTP SSL / secure
                  </label>
                  <Field label="Daily send limit">
                    <Input name="dailyLimit" type="number" defaultValue="50" min="1" />
                  </Field>
                  <Field label="Local bind IP" hint="Optional: force this sender through a specific outbound IP.">
                    <Input name="localAddress" placeholder="15.204.x.x" />
                  </Field>
                </div>
              </div>

              <div className="rounded-[1.6rem] border border-emerald-100 bg-emerald-50/50 p-4 sm:p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-950">IMAP reply detection</div>
                    <div className="mt-1 text-xs text-slate-600">Used by the worker to poll INBOX and auto-stop sequences after replies.</div>
                  </div>
                  <Pill tone="success">Recommended</Pill>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_160px] gap-4">
                  <Field label="IMAP host">
                    <Input name="imapHost" placeholder="imap.gmail.com" />
                  </Field>
                  <Field label="IMAP port">
                    <Input name="imapPort" type="number" defaultValue="993" />
                  </Field>
                </div>
                <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Field label="IMAP user">
                    <Input name="imapUser" placeholder="same as from email" />
                  </Field>
                  <Field label="IMAP password">
                    <Input name="imapPass" type="password" placeholder="leave blank if not using IMAP" />
                  </Field>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <label className="flex items-center gap-2 rounded-2xl border border-white/70 bg-white/70 px-4 py-3 text-sm font-medium text-slate-700 shadow-sm">
                    <Input name="imapSecure" type="checkbox" defaultChecked />
                    IMAP SSL / secure
                  </label>
                  <label className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm font-medium text-amber-800 shadow-sm">
                    <Input name="imapTlsSkipVerify" type="checkbox" />
                    TEMP: skip TLS certificate verification
                  </label>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-[1.6rem] border border-slate-200 bg-white/70 p-4">
                <div className="text-sm text-slate-600">
                  After saving, run a health check and send a test message before using this mailbox in campaigns.
                </div>
                <Button type="submit" className="sm:min-w-[180px]">Save mailbox</Button>
              </div>
            </form>
          </Card>

          <Card title="Sender fleet" subtitle="Search, test, health-check, throttle, and edit existing mailboxes.">
            <MailboxesClient />
          </Card>
        </main>
      </div>
    </Container>
  );
}
