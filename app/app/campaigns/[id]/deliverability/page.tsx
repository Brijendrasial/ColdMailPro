import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildCampaignQaReport } from "@/lib/campaign-qa";
import { Container, Card, Button, Badge, Pill } from "@/components/ui";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function scoreDeliverability(opts: {
  hardRate: number;
  bounceRate: number;
  unsubRate: number;
  spamScore: number;
}): number {
  // simple heuristic score 0..100
  const hardPenalty = clamp(opts.hardRate * 1000, 0, 60); // 1% =>10
  const bouncePenalty = clamp(opts.bounceRate * 600, 0, 25); // 1% =>6
  const unsubPenalty = clamp(opts.unsubRate * 1000, 0, 25); // 1% =>10
  const spamPenalty = clamp(opts.spamScore * 0.35, 0, 30);
  const raw = 100 - hardPenalty - bouncePenalty - unsubPenalty - spamPenalty;
  return Math.round(clamp(raw, 0, 100));
}

function fmtPct(rate: number) {
  return `${Math.round(rate * 1000) / 10}%`;
}

export default async function CampaignDeliverabilityPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const s = await requireSession();
  const id = params.id;
  const rule = typeof searchParams?.rule === "string" ? searchParams.rule : "";

  const camp: any = await prisma.campaign.findFirst({ where: { id, workspaceId: s.wid } });
  if (!camp) {
    return (
      <Container>
        <Card title="Not found" subtitle="Campaign does not exist or you don’t have access." />
      </Container>
    );
  }

  const guardEnabled = Boolean(camp.guardEnabled ?? true);
  const windowHours = Number(camp.guardWindowHours ?? 24);
  const guardMinSent = Number(camp.guardMinSent ?? 50);
  const maxHard = Number(camp.guardMaxHardBounceRate ?? 0.05);
  const maxTotal = Number(camp.guardMaxBounceRate ?? 0.08);
  const maxUnsub = Number(camp.guardMaxUnsubRate ?? 0.02);
  const since = new Date(Date.now() - windowHours * 3600 * 1000);

  const [sent, hardBounces, softBounces, unsubs, qa, activeThrottles] = await Promise.all([
    // Message.status can evolve (sent -> opened -> replied). For "Sent", rely on sentAt.
    prisma.message.count({ where: { campaignId: id, workspaceId: s.wid, sentAt: { gte: since } } }).catch(() => 0),
    prisma.event.count({ where: { type: "bounce_hard", createdAt: { gte: since }, message: { campaignId: id, workspaceId: s.wid } } }).catch(() => 0),
    prisma.event.count({ where: { type: "bounce_soft", createdAt: { gte: since }, message: { campaignId: id, workspaceId: s.wid } } }).catch(() => 0),
    // Support both legacy "unsub" and current "unsubscribe" event types.
    prisma.event.count({ where: { type: { in: ["unsubscribe", "unsub"] }, createdAt: { gte: since }, message: { campaignId: id, workspaceId: s.wid } } }).catch(() => 0),
    buildCampaignQaReport(s.wid, id).catch(() => ({ ok: true, spamScore: 0, errors: [], warnings: [] } as any)),
    prisma.mailboxThrottle.findMany({ where: { campaignId: id, until: { gt: new Date() } }, include: { mailbox: { select: { name: true, fromEmail: true } } }, orderBy: { until: "asc" } }).catch(() => [] as any[]),
  ]);

  const hardRate = sent ? hardBounces / sent : 0;
  const bounceRate = sent ? (hardBounces + softBounces) / sent : 0;
  const unsubRate = sent ? unsubs / sent : 0;
  const score = scoreDeliverability({ hardRate, bounceRate, unsubRate, spamScore: Number(qa.spamScore ?? 0) });

  const tone: any = score >= 85 ? "success" : score >= 70 ? "info" : score >= 55 ? "warning" : "danger";

  const suggestions: string[] = [];
  if (qa?.errors?.length) suggestions.push("Fix the blocking pre-send errors in templates (subject/body)." );
  if (Number(qa?.spamScore ?? 0) >= 25) suggestions.push("Reduce spammy phrases, limit links, and use a more conversational subject." );
  if (hardRate > Number(camp.guardMaxHardBounceRate ?? 0.05)) suggestions.push("Hard bounces are high — verify lists, suppress bad domains, and check sender reputation." );
  if (unsubRate > Number(camp.guardMaxUnsubRate ?? 0.02)) suggestions.push("Unsub rate is high — tighten targeting and make the offer clearer/faster." );
  if (activeThrottles.length) suggestions.push("Some sender mailboxes are throttled — check DNS, inbox placement, and list quality." );
  if (suggestions.length === 0) suggestions.push("Looks healthy. Keep ramping slowly and monitor domain caps (Gmail/Yahoo) as volume grows.");

  const guardActive = guardEnabled && sent >= guardMinSent;
  const hitHard = guardActive && hardRate > maxHard;
  const hitTotal = guardActive && bounceRate > maxTotal;
  const hitUnsub = guardActive && unsubRate > maxUnsub;
  const wouldPause = hitHard || hitTotal || hitUnsub;

  return (
    <Container>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-xl font-semibold tracking-tight">Deliverability · {camp.name}</div>
          <div className="text-sm opacity-70">Inbox signals + template risk in one place (window: last {windowHours}h).</div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/app/campaigns/${camp.id}`}><Button variant="ghost">Back</Button></Link>
          <Link href={`/app/campaigns/${camp.id}/funnel`}><Button variant="ghost">Funnel</Button></Link>
          <Link href={`/app/campaigns/${camp.id}/analytics`}><Button>Analytics</Button></Link>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        <Card title="Deliverability score" subtitle="A simple health score based on recent bounces/unsubs + template risk.">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge>Score: {score}/100</Badge>
            <Pill tone={tone}>{score >= 85 ? "Great" : score >= 70 ? "Good" : score >= 55 ? "At risk" : "Critical"}</Pill>
            <Badge>Sent: {sent}</Badge>
          </div>
          <div className="mt-3 grid gap-2 text-sm">
            <div className="flex items-center justify-between"><div>Hard bounce rate</div><div className="font-semibold">{fmtPct(hardRate)}</div></div>
            <div className="flex items-center justify-between"><div>Total bounce rate</div><div className="font-semibold">{fmtPct(bounceRate)}</div></div>
            <div className="flex items-center justify-between"><div>Unsubscribe rate</div><div className="font-semibold">{fmtPct(unsubRate)}</div></div>
            <div className="flex items-center justify-between"><div>Template spam risk</div><div className="font-semibold">{Number(qa.spamScore ?? 0)}</div></div>
          </div>
        </Card>

        <Card title="Template QA" subtitle="What might block campaign start or reduce inboxing.">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge>Errors: {qa?.errors?.length ?? 0}</Badge>
            <Badge>Warnings: {qa?.warnings?.length ?? 0}</Badge>
            <Link href={`/app/campaigns/${camp.id}/settings`}><Button variant="ghost">Open settings</Button></Link>
          </div>
          <div className="mt-3 grid gap-2 text-sm">
            {(qa?.errors?.slice(0, 5) || []).map((e: any, idx: number) => (
              <div key={idx} className="rounded-xl border border-black/10 dark:border-white/10 p-3">
                <div className="font-medium">{e.message}</div>
                <div className="text-xs opacity-70">Step {e.stepNumber ?? "-"}{e.variantName ? ` · Variant ${e.variantName}` : ""}</div>
              </div>
            ))}
            {(!qa?.errors?.length ? (
              <div className="text-sm opacity-70">No blocking errors.</div>
            ) : null)}
            {(qa?.warnings?.length ? (
              <div className="text-xs opacity-70">Warnings are non-blocking but can affect deliverability.</div>
            ) : null)}
          </div>
        </Card>

        <Card title="Guardrails (auto-pause)" subtitle="When guardrails are enabled, the campaign can auto-pause if recent rates exceed thresholds.">
          <div className="flex items-center gap-2 flex-wrap">
            <Pill tone={guardEnabled ? "success" : "neutral"}>{guardEnabled ? "Enabled" : "Disabled"}</Pill>
            <Badge>Window: {windowHours}h</Badge>
            <Badge>Min sent: {guardMinSent}</Badge>
            {guardActive ? <Badge>Active</Badge> : <Badge>Not active yet</Badge>}
            {wouldPause ? <Pill tone="danger">Would pause</Pill> : <Pill tone="success">Within limits</Pill>}
          </div>

          <div className="mt-3 grid gap-2 text-sm">
            <div className={`rounded-xl border border-black/10 dark:border-white/10 p-3 ${rule === "hard_bounce" ? "bg-black/[0.03] dark:bg-white/[0.06]" : ""}`}>
              <div className="flex items-center justify-between">
                <div className="font-medium">Hard bounce rate</div>
                <div className="flex items-center gap-2">
                  <Badge>{fmtPct(hardRate)} / {fmtPct(maxHard)}</Badge>
                  {hitHard ? <Pill tone="danger">Hit</Pill> : <Pill tone="success">OK</Pill>}
                </div>
              </div>
              <div className="text-xs opacity-70 mt-1">Rule: if sent ≥ {guardMinSent} in last {windowHours}h and hard bounce rate &gt; {fmtPct(maxHard)}.</div>
            </div>

            <div className={`rounded-xl border border-black/10 dark:border-white/10 p-3 ${rule === "bounce" || rule === "bounce_spike" ? "bg-black/[0.03] dark:bg-white/[0.06]" : ""}`}>
              <div className="flex items-center justify-between">
                <div className="font-medium">Total bounce rate</div>
                <div className="flex items-center gap-2">
                  <Badge>{fmtPct(bounceRate)} / {fmtPct(maxTotal)}</Badge>
                  {hitTotal ? <Pill tone="danger">Hit</Pill> : <Pill tone="success">OK</Pill>}
                </div>
              </div>
              <div className="text-xs opacity-70 mt-1">Rule: if sent ≥ {guardMinSent} in last {windowHours}h and total bounce rate &gt; {fmtPct(maxTotal)}.</div>
            </div>

            <div className={`rounded-xl border border-black/10 dark:border-white/10 p-3 ${rule === "unsub" || rule === "unsub_spike" ? "bg-black/[0.03] dark:bg-white/[0.06]" : ""}`}>
              <div className="flex items-center justify-between">
                <div className="font-medium">Unsubscribe rate</div>
                <div className="flex items-center gap-2">
                  <Badge>{fmtPct(unsubRate)} / {fmtPct(maxUnsub)}</Badge>
                  {hitUnsub ? <Pill tone="danger">Hit</Pill> : <Pill tone="success">OK</Pill>}
                </div>
              </div>
              <div className="text-xs opacity-70 mt-1">Rule: if sent ≥ {guardMinSent} in last {windowHours}h and unsub rate &gt; {fmtPct(maxUnsub)}.</div>
            </div>

            {camp?.pausedReason ? (
              <div className={`rounded-xl border border-black/10 dark:border-white/10 p-3 ${rule === "paused" ? "bg-black/[0.03] dark:bg-white/[0.06]" : ""}`}>
                <div className="font-medium">Paused reason</div>
                <div className="text-xs opacity-70 mt-1 whitespace-pre-wrap">{String(camp.pausedReason)}</div>
              </div>
            ) : null}
          </div>

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <Link href={`/app/campaigns/${camp.id}/settings`}><Button variant="ghost">Edit guardrails</Button></Link>
            <Link href={`/app/campaigns?status=running&health=risk`}><Button variant="ghost">View other risky campaigns</Button></Link>
          </div>
        </Card>

        <Card title="Active sender throttles" subtitle="Mailboxes temporarily on cooldown due to bounce spikes.">
          <div className="grid gap-2">
            {activeThrottles.length === 0 ? (
              <div className="text-sm opacity-70">No active throttles.</div>
            ) : (
              activeThrottles.slice(0, 8).map((t: any) => (
                <div key={t.id} className="rounded-xl border border-black/10 dark:border-white/10 p-3">
                  <div className="font-medium truncate">{t.mailbox?.name || "Mailbox"} · {t.mailbox?.fromEmail}</div>
                  <div className="text-xs opacity-70 mt-1">Until: {new Date(t.until).toLocaleString()}</div>
                  {t.reason ? <div className="text-xs opacity-70 mt-1">{String(t.reason)}</div> : null}
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <Card title="Suggestions" subtitle="What to do next to keep inbox placement strong.">
        <ul className="text-sm grid gap-2">
          {suggestions.map((sug, idx) => (
            <li key={idx} className="flex gap-2"><span className="mt-0.5">•</span><div>{sug}</div></li>
          ))}
        </ul>
      </Card>
    </Container>
  );
}
