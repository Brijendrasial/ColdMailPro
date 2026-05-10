import Link from "next/link";
import { CampaignInnerHero } from "@/components/campaigns/campaign-inner-shell";
import { Container, Card, Badge, Pill, Button } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Row = {
  stepNumber: number;
  variant: string;
  sent: number;
  opens: number;
  clicks: number;
  replies: number;
  hardBounces: number;
  softBounces: number;
  unsubs: number;
};

type StepSummary = {
  stepNumber: number;
  sent: number;
  opens: number;
  clicks: number;
  replies: number;
  hardBounces: number;
  softBounces: number;
  unsubs: number;
};

type WinnerRow = {
  stepNumber: number;
  winner: string;
  winnerRate: number;
  winnerSent: number;
  runnerUp?: string;
  runnerUpRate?: number;
  uplift?: number;
};

function pct(a: number, b: number) {
  if (!b) return "0.0%";
  return `${Math.round((a / b) * 1000) / 10}%`;
}

function fmtRate(rate: number) {
  return `${Math.round((rate || 0) * 1000) / 10}%`;
}

export default async function CampaignAnalytics({ params }: { params: { id: string } }) {
  const s = await requireSession();
  const id = params.id;

  const camp = await prisma.campaign.findFirst({
    where: { id, workspaceId: s.wid },
    include: { steps: { orderBy: { stepNumber: "asc" }, include: { variants: { orderBy: { createdAt: "asc" } } } } },
  });
  if (!camp) {
    return (
      <Container>
        <Card title="Not found">Campaign not found.</Card>
      </Container>
    );
  }

  const msgs = await prisma.message.findMany({
    where: { workspaceId: s.wid, campaignId: id },
    select: { id: true, stepNumber: true, stepVariantId: true, sentAt: true },
  });

  const evs = await prisma.event.findMany({
    where: { message: { campaignId: id } },
    select: { messageId: true, type: true },
  });

  // variant id -> name
  const variantName = new Map<string, string>();
  for (const st of camp.steps as any[]) {
    for (const v of (st.variants || []) as any[]) {
      if (v?.id) variantName.set(String(v.id), String(v.name || "A").toUpperCase());
    }
  }

  // messageId -> flags
  const flags = new Map<string, Set<string>>();
  for (const e of evs) {
    const set = flags.get(e.messageId) || new Set<string>();
    set.add(e.type);
    flags.set(e.messageId, set);
  }

  const agg = new Map<string, Row>();
  for (const m of msgs) {
    if (!m.sentAt || m.stepNumber == null) continue;
    const stepNumber = m.stepNumber;
    const v = m.stepVariantId ? variantName.get(m.stepVariantId) || "A" : "A";
    const key = `${stepNumber}|${v}`;
    const row = agg.get(key) || {
      stepNumber,
      variant: v,
      sent: 0,
      opens: 0,
      clicks: 0,
      replies: 0,
      hardBounces: 0,
      softBounces: 0,
      unsubs: 0,
    };
    row.sent += 1;
    const f = flags.get(m.id);
    if (f?.has("open")) row.opens += 1;
    if (f?.has("click")) row.clicks += 1;
    if (f?.has("reply")) row.replies += 1;
    if (f?.has("bounce_hard")) row.hardBounces += 1;
    if (f?.has("bounce_soft")) row.softBounces += 1;
    if (f?.has("unsubscribe")) row.unsubs += 1;
    agg.set(key, row);
  }

  const rows = Array.from(agg.values()).sort((a, b) => a.stepNumber - b.stepNumber || a.variant.localeCompare(b.variant));

  // Winner hints per step (reply rate)
  const winners = new Map<number, { variant: string; rate: number; sent: number }>();
  for (const r of rows) {
    const rate = r.replies / Math.max(1, r.sent);
    const cur = winners.get(r.stepNumber);
    if (!cur || rate > cur.rate) winners.set(r.stepNumber, { variant: r.variant, rate, sent: r.sent });
  }

  // Step-level summary across variants
  const stepAgg = new Map<number, StepSummary>();
  for (const r of rows) {
    const srow = stepAgg.get(r.stepNumber) || {
      stepNumber: r.stepNumber,
      sent: 0,
      opens: 0,
      clicks: 0,
      replies: 0,
      hardBounces: 0,
      softBounces: 0,
      unsubs: 0,
    };
    srow.sent += r.sent;
    srow.opens += r.opens;
    srow.clicks += r.clicks;
    srow.replies += r.replies;
    srow.hardBounces += r.hardBounces;
    srow.softBounces += r.softBounces;
    srow.unsubs += r.unsubs;
    stepAgg.set(r.stepNumber, srow);
  }
  const stepSummaries = Array.from(stepAgg.values()).sort((a, b) => a.stepNumber - b.stepNumber);

  // Winner table (winner + runner up + uplift)
  const winnerRows: WinnerRow[] = [];
  for (const srow of stepSummaries) {
    const perStep = rows
      .filter((r) => r.stepNumber === srow.stepNumber)
      .map((r) => ({ variant: r.variant, sent: r.sent, rate: r.replies / Math.max(1, r.sent) }))
      .sort((a, b) => b.rate - a.rate);
    if (perStep.length === 0) continue;
    const w = perStep[0];
    const ru = perStep.length > 1 ? perStep[1] : null;
    const uplift = ru ? w.rate - ru.rate : undefined;
    winnerRows.push({
      stepNumber: srow.stepNumber,
      winner: w.variant,
      winnerRate: w.rate,
      winnerSent: w.sent,
      runnerUp: ru?.variant,
      runnerUpRate: ru?.rate,
      uplift,
    });
  }

  return (
    <Container>
      <CampaignInnerHero
        campaignId={camp.id}
        campaignName={camp.name}
        status={camp.status}
        active="analytics"
        title="Campaign analytics"
        subtitle="Step-level performance, variant winners, engagement rates, and reply movement in one readable view."
        primaryHref={`/app/campaigns/${camp.id}/deliverability`}
        primaryLabel="Deliverability"
      />

      <Card title="Steps & variants" subtitle="Unique counts by message (open/click/reply counted once per message).">
        {rows.length === 0 ? (
          <div className="text-sm opacity-70">No sent messages yet.</div>
        ) : (
          <div className="grid gap-4">
            <Card title="Step summary" subtitle="Aggregated across variants (useful for pacing + diagnosing dropoffs).">
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left opacity-70">
                      <th className="py-2 pr-3">Step</th>
                      <th className="py-2 pr-3">Sent</th>
                      <th className="py-2 pr-3">Replies</th>
                      <th className="py-2 pr-3">Opens</th>
                      <th className="py-2 pr-3">Clicks</th>
                      <th className="py-2 pr-3">Bounces</th>
                      <th className="py-2 pr-3">Unsubs</th>
                      <th className="py-2 pr-3">Winner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stepSummaries.map((r) => {
                      const win = winners.get(r.stepNumber);
                      return (
                        <tr key={`step-${r.stepNumber}`} className="border-t border-black/10 dark:border-white/10">
                          <td className="py-2 pr-3 font-medium">{r.stepNumber}</td>
                          <td className="py-2 pr-3">{r.sent}</td>
                          <td className="py-2 pr-3">{r.replies} <span className="opacity-60">({pct(r.replies, r.sent)})</span></td>
                          <td className="py-2 pr-3">{r.opens} <span className="opacity-60">({pct(r.opens, r.sent)})</span></td>
                          <td className="py-2 pr-3">{r.clicks} <span className="opacity-60">({pct(r.clicks, r.sent)})</span></td>
                          <td className="py-2 pr-3">{r.hardBounces + r.softBounces} <span className="opacity-60">({pct(r.hardBounces + r.softBounces, r.sent)})</span></td>
                          <td className="py-2 pr-3">{r.unsubs} <span className="opacity-60">({pct(r.unsubs, r.sent)})</span></td>
                          <td className="py-2 pr-3">
                            {win ? <Pill tone={win.variant === "A" ? "neutral" : "success"}>{win.variant}</Pill> : <span className="opacity-60">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Variant winners" subtitle="Winner is based on reply rate per step (runner-up + uplift shown when available).">
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left opacity-70">
                      <th className="py-2 pr-3">Step</th>
                      <th className="py-2 pr-3">Winner</th>
                      <th className="py-2 pr-3">Reply rate</th>
                      <th className="py-2 pr-3">Runner-up</th>
                      <th className="py-2 pr-3">Uplift</th>
                    </tr>
                  </thead>
                  <tbody>
                    {winnerRows.map((w) => (
                      <tr key={`win-${w.stepNumber}`} className="border-t border-black/10 dark:border-white/10">
                        <td className="py-2 pr-3 font-medium">{w.stepNumber}</td>
                        <td className="py-2 pr-3"><Pill tone={w.winner === "A" ? "neutral" : "success"}>{w.winner}</Pill> <span className="text-xs opacity-60">(sent {w.winnerSent})</span></td>
                        <td className="py-2 pr-3">{fmtRate(w.winnerRate)}</td>
                        <td className="py-2 pr-3">{w.runnerUp ? <Pill tone={w.runnerUp === "A" ? "neutral" : "info"}>{w.runnerUp}</Pill> : <span className="opacity-60">—</span>}</td>
                        <td className="py-2 pr-3">{typeof w.uplift === "number" ? <span className="font-medium">+{fmtRate(w.uplift)}</span> : <span className="opacity-60">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Steps & variants" subtitle="Unique counts by message (open/click/reply counted once per message).">
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left opacity-70">
                      <th className="py-2 pr-3">Step</th>
                      <th className="py-2 pr-3">Variant</th>
                      <th className="py-2 pr-3">Sent</th>
                      <th className="py-2 pr-3">Opens</th>
                      <th className="py-2 pr-3">Clicks</th>
                      <th className="py-2 pr-3">Replies</th>
                      <th className="py-2 pr-3">Hard bounces</th>
                      <th className="py-2 pr-3">Soft bounces</th>
                      <th className="py-2 pr-3">Unsubs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.stepNumber}-${r.variant}`} className="border-t border-black/10 dark:border-white/10">
                        <td className="py-2 pr-3 font-medium">{r.stepNumber}</td>
                        <td className="py-2 pr-3">
                          <span className="inline-flex items-center gap-2">
                            <Pill tone={r.variant === "A" ? "neutral" : "success"}>{r.variant}</Pill>
                            {winners.get(r.stepNumber)?.variant === r.variant ? (
                              <span className="text-xs opacity-70">best reply rate</span>
                            ) : null}
                          </span>
                        </td>
                        <td className="py-2 pr-3">{r.sent}</td>
                        <td className="py-2 pr-3">{r.opens} <span className="opacity-60">({pct(r.opens, r.sent)})</span></td>
                        <td className="py-2 pr-3">{r.clicks} <span className="opacity-60">({pct(r.clicks, r.sent)})</span></td>
                        <td className="py-2 pr-3">{r.replies} <span className="opacity-60">({pct(r.replies, r.sent)})</span></td>
                        <td className="py-2 pr-3">{r.hardBounces} <span className="opacity-60">({pct(r.hardBounces, r.sent)})</span></td>
                        <td className="py-2 pr-3">{r.softBounces} <span className="opacity-60">({pct(r.softBounces, r.sent)})</span></td>
                        <td className="py-2 pr-3">{r.unsubs} <span className="opacity-60">({pct(r.unsubs, r.sent)})</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}
      </Card>
    </Container>
  );
}
