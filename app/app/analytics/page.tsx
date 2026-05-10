import { Container, Pill } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import AnalyticsClient from "@/components/analytics/analytics-client";

function pickStr(v: string | string[] | undefined) {
  return typeof v === "string" ? v : "";
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireSession();

  const tab = pickStr(searchParams?.tab);
  const range = pickStr(searchParams?.range);
  const from = pickStr(searchParams?.from);
  const to = pickStr(searchParams?.to);
  const campaignId = pickStr(searchParams?.campaignId);
  const mailboxId = pickStr(searchParams?.mailboxId);
  const bounceType = pickStr(searchParams?.bounceType);

  return (
    <Container wide className="space-y-6">
      <section className="relative overflow-hidden rounded-[2.2rem] border border-white/70 bg-slate-950 shadow-[0_30px_90px_rgba(15,23,42,0.16)]">
        <div className="absolute inset-0 bg-[radial-gradient(900px_circle_at_5%_0%,rgba(99,102,241,0.32),transparent_42%),radial-gradient(820px_circle_at_92%_5%,rgba(45,212,191,0.28),transparent_45%),linear-gradient(135deg,#070a1a,#10172a_55%,#082f36)]" />
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cyan-300/10 blur-3xl" />
        <div className="absolute left-8 bottom-0 h-px w-1/2 bg-gradient-to-r from-indigo-400/70 via-cyan-300/40 to-transparent" />
        <div className="relative p-6 sm:p-8 lg:p-10">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-4xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.26em] text-cyan-100 shadow-sm backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_0_4px_rgba(52,211,153,0.16)]" />
                Revenue intelligence
              </div>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl font-display">
                Analytics Command Center
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                Track sending performance, reply quality, mailbox health, bounce patterns, and campaign momentum from one polished cockpit.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <Pill tone="success">Live telemetry</Pill>
              <Pill tone="info">Campaign + mailbox drilldown</Pill>
              <Pill tone="neutral">UTC-safe ranges</Pill>
            </div>
          </div>
        </div>
      </section>

      <AnalyticsClient
        initial={{
          tab,
          range,
          from,
          to,
          campaignId,
          mailboxId,
          bounceType,
        }}
      />
    </Container>
  );
}
