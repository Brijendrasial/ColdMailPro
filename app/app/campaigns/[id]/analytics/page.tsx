import Link from "next/link";
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

function pct(a: number, b: number) {
  if (!b) return "0.0%";
  return `${Math.round((a / b) * 1000) / 10}%`;
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
    if (!m.sentAt) continue;
    const v = m.stepVariantId ? variantName.get(m.stepVariantId) || "A" : "A";
    const key = `${m.stepNumber}|${v}`;
    const row = agg.get(key) || {
      stepNumber: m.stepNumber,
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

  return (
    <Container>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div className="min-w-0">
          <div className="text-2xl font-semibold tracking-tight">Campaign Analytics</div>
          <div className="mt-1 text-sm opacity-70">Step-level performance + A/B testing breakdown.</div>
          <div className="mt-2 flex gap-2 flex-wrap">
            <Badge>Campaign: {camp.name}</Badge>
            <Pill tone={camp.status === "running" ? "success" : camp.status === "paused" ? "warning" : "neutral"}>{camp.status}</Pill>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/app/campaigns/${camp.id}`}><Button variant="ghost">← Back</Button></Link>
          <Link href={`/app/campaigns/${camp.id}/settings`}><Button variant="ghost">Settings</Button></Link>
          <Link href={`/app/campaigns/${camp.id}/edit`}><Button variant="ghost">Edit steps</Button></Link>
        </div>
      </div>

      <Card title="Steps & variants" subtitle="Unique counts by message (open/click/reply counted once per message).">
        {rows.length === 0 ? (
          <div className="text-sm opacity-70">No sent messages yet.</div>
        ) : (
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
        )}
      </Card>
    </Container>
  );
}
