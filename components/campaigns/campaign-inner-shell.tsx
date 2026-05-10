import Link from "next/link";
import { Button, Pill } from "@/components/ui";

export function CampaignInnerHero({
  campaignId,
  campaignName,
  status,
  active,
  title,
  subtitle,
  primaryHref,
  primaryLabel,
}: {
  campaignId: string;
  campaignName: string;
  status?: string;
  active: "overview" | "mailboxes" | "settings" | "funnel" | "deliverability" | "analytics" | "steps" | "enroll";
  title: string;
  subtitle: string;
  primaryHref?: string;
  primaryLabel?: string;
}) {
  const tabs = [
    ["overview", "Overview", `/app/campaigns/${campaignId}`],
    ["mailboxes", "Mailboxes", `/app/campaigns/${campaignId}/mailboxes`],
    ["settings", "Settings", `/app/campaigns/${campaignId}/settings`],
    ["funnel", "Funnel", `/app/campaigns/${campaignId}/funnel`],
    ["deliverability", "Deliverability", `/app/campaigns/${campaignId}/deliverability`],
    ["analytics", "Analytics", `/app/campaigns/${campaignId}/analytics`],
    ["steps", "Edit steps", `/app/campaigns/${campaignId}/edit`],
    ["enroll", "Enroll leads", `/app/campaigns/${campaignId}/enroll`],
  ] as const;

  return (
    <div className="mb-6 overflow-hidden rounded-[2.3rem] border border-white/70 bg-slate-950 text-white shadow-[0_30px_90px_rgba(15,23,42,0.18)]">
      <div className="relative p-5 sm:p-7">
        <div className="absolute inset-0 bg-[radial-gradient(900px_circle_at_0%_0%,rgba(99,102,241,0.48),transparent_44%),radial-gradient(760px_circle_at_100%_0%,rgba(20,184,166,0.35),transparent_42%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(30,41,59,0.92))]" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-100">Campaign workspace</span>
              {status ? <Pill tone={status === "running" ? "success" : status === "paused" ? "warning" : "neutral"}>{status}</Pill> : null}
            </div>
            <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200">{subtitle}</p>
            <p className="mt-3 truncate text-xs text-slate-400">{campaignName}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/app/campaigns"><Button variant="ghost" className="border-white/20 bg-white/10 text-white hover:bg-white/15">All campaigns</Button></Link>
            {primaryHref && primaryLabel ? <Link href={primaryHref}><Button className="border-white/20 bg-white text-slate-950 hover:bg-slate-100">{primaryLabel}</Button></Link> : null}
          </div>
        </div>
        <div className="relative mt-6 flex gap-2 overflow-x-auto rounded-[1.5rem] border border-white/10 bg-white/10 p-2 backdrop-blur-xl">
          {tabs.map(([value, label, href]) => (
            <Link key={value} href={href} className={`shrink-0 rounded-2xl px-3 py-2 text-sm font-semibold transition ${active === value ? "bg-white text-slate-950 shadow-md" : "text-slate-200 hover:bg-white/10 hover:text-white"}`}>{label}</Link>
          ))}
        </div>
      </div>
    </div>
  );
}
