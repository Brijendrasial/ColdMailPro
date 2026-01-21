import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Container, Card, Button, Pill, Badge } from "@/components/ui";

function uniq<T extends string>(arr: (T | null | undefined)[]): T[] {
  const s = new Set<T>();
  for (const x of arr) {
    if (x) s.add(x);
  }
  return Array.from(s);
}

function leadScore(opts: { replied: boolean; clicked: boolean; opened: boolean; sent: boolean; bounced: boolean; unsub: boolean }): number {
  if (opts.unsub || opts.bounced) return 0;
  if (opts.replied) return 100;
  if (opts.clicked) return 70;
  if (opts.opened) return 40;
  if (opts.sent) return 10;
  return 0;
}

export default async function CampaignFunnelPage({ params }: { params: { id: string } }) {
  const s = await requireSession();
  const id = params.id;

  const camp = await prisma.campaign.findFirst({ where: { id, workspaceId: s.wid }, select: { id: true, name: true, status: true } });
  if (!camp) {
    return (
      <Container>
        <Card title="Not found" subtitle="Campaign does not exist or you don’t have access." />
      </Container>
    );
  }

  const [enrolledCount, messages, openEvs, clickEvs, replyEvs, unsubEvs, bounceHardEvs, bounceSoftEvs] = await Promise.all([
    // Enrollment doesn't have workspaceId in schema; campaign ownership was checked above.
    prisma.enrollment.count({ where: { campaignId: id } }).catch(() => 0),
    prisma.message.findMany({ where: { campaignId: id, workspaceId: s.wid }, select: { id: true, leadId: true, sentAt: true } }).catch(() => [] as any[]),
    prisma.event.findMany({ where: { type: "open", message: { campaignId: id, workspaceId: s.wid } }, select: { message: { select: { leadId: true } } } }).catch(() => [] as any[]),
    prisma.event.findMany({ where: { type: "click", message: { campaignId: id, workspaceId: s.wid } }, select: { message: { select: { leadId: true } } } }).catch(() => [] as any[]),
    prisma.event.findMany({ where: { type: "reply", message: { campaignId: id, workspaceId: s.wid } }, select: { message: { select: { leadId: true } } } }).catch(() => [] as any[]),
    // Support both legacy "unsub" and current "unsubscribe" event types.
    prisma.event.findMany({ where: { type: { in: ["unsubscribe", "unsub"] }, message: { campaignId: id, workspaceId: s.wid } }, select: { message: { select: { leadId: true } } } }).catch(() => [] as any[]),
    prisma.event.findMany({ where: { type: "bounce_hard", message: { campaignId: id, workspaceId: s.wid } }, select: { message: { select: { leadId: true } } } }).catch(() => [] as any[]),
    prisma.event.findMany({ where: { type: "bounce_soft", message: { campaignId: id, workspaceId: s.wid } }, select: { message: { select: { leadId: true } } } }).catch(() => [] as any[]),
  ]);

  // Message.status may change after delivery (e.g. sent -> opened -> replied), so
  // use sentAt to determine whether a lead was sent an email.
  const sentLeads = new Set(uniq(messages.filter((m) => Boolean(m.sentAt)).map((m) => m.leadId)));
  const openedLeads = new Set(uniq(openEvs.map((e) => e.message?.leadId)));
  const clickedLeads = new Set(uniq(clickEvs.map((e) => e.message?.leadId)));
  const repliedLeads = new Set(uniq(replyEvs.map((e) => e.message?.leadId)));
  const unsubLeads = new Set(uniq(unsubEvs.map((e) => e.message?.leadId)));
  const bouncedLeads = new Set(uniq([...bounceHardEvs, ...bounceSoftEvs].map((e) => e.message?.leadId)));

  const deliveredLeads = new Set<string>();
  for (const lid of sentLeads) {
    if (!bouncedLeads.has(lid)) deliveredLeads.add(lid);
  }

  const stage = {
    enrolled: enrolledCount,
    sent: sentLeads.size,
    delivered: deliveredLeads.size,
    opened: openedLeads.size,
    clicked: clickedLeads.size,
    replied: repliedLeads.size,
    unsub: unsubLeads.size,
    bounced: bouncedLeads.size,
  };

  const allLeadIds = uniq([
    ...Array.from(sentLeads),
    ...Array.from(openedLeads),
    ...Array.from(clickedLeads),
    ...Array.from(repliedLeads),
    ...Array.from(unsubLeads),
    ...Array.from(bouncedLeads),
  ]);

  const leads = allLeadIds.length
    ? await prisma.lead.findMany({ where: { id: { in: allLeadIds }, workspaceId: s.wid }, select: { id: true, email: true, firstName: true, lastName: true, company: true, status: true } })
    : [];

  const leadMap = new Map(leads.map((l) => [l.id, l] as const));

  const scored = allLeadIds
    .map((lid) => {
      const l = leadMap.get(lid);
      const score = leadScore({
        replied: repliedLeads.has(lid),
        clicked: clickedLeads.has(lid),
        opened: openedLeads.has(lid),
        sent: sentLeads.has(lid),
        bounced: bouncedLeads.has(lid),
        unsub: unsubLeads.has(lid),
      });
      return { lid, score, lead: l };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  return (
    <Container>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-xl font-semibold tracking-tight">Funnel · {camp.name}</div>
          <div className="text-sm opacity-70">A quick stage-by-stage view (enrolled → sent → delivered → opened → clicked → replied).</div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/app/campaigns/${camp.id}`}><Button variant="ghost">Back</Button></Link>
          <Link href={`/app/campaigns/${camp.id}/deliverability`}><Button variant="ghost">Deliverability</Button></Link>
          <Link href={`/app/campaigns/${camp.id}/analytics`}><Button>Analytics</Button></Link>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        <Card title="Stage counts" subtitle="Distinct leads per stage (approx).">
          <div className="grid gap-2 text-sm">
            {["enrolled","sent","delivered","opened","clicked","replied"].map((k) => (
              <div key={k} className="flex items-center justify-between gap-3">
                <div className="capitalize">{k}</div>
                <div className="font-semibold">{(stage as any)[k]}</div>
              </div>
            ))}
            <div className="h-px bg-black/10 dark:bg-white/10 my-2" />
            <div className="flex items-center justify-between gap-3">
              <div className="">Bounced</div>
              <div className="font-semibold">{stage.bounced}</div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="">Unsubscribed</div>
              <div className="font-semibold">{stage.unsub}</div>
            </div>
          </div>
        </Card>

        <Card title="Conversion" subtitle="How leads move through your funnel.">
          <div className="grid gap-2 text-sm">
            <div className="flex items-center justify-between"><div>Open rate</div><div className="font-semibold">{stage.sent ? Math.round((stage.opened / stage.sent) * 1000) / 10 : 0}%</div></div>
            <div className="flex items-center justify-between"><div>Click rate</div><div className="font-semibold">{stage.sent ? Math.round((stage.clicked / stage.sent) * 1000) / 10 : 0}%</div></div>
            <div className="flex items-center justify-between"><div>Reply rate</div><div className="font-semibold">{stage.sent ? Math.round((stage.replied / stage.sent) * 1000) / 10 : 0}%</div></div>
            <div className="flex items-center justify-between"><div>Bounce rate</div><div className="font-semibold">{stage.sent ? Math.round((stage.bounced / stage.sent) * 1000) / 10 : 0}%</div></div>
            <div className="flex items-center justify-between"><div>Unsub rate</div><div className="font-semibold">{stage.sent ? Math.round((stage.unsub / stage.sent) * 1000) / 10 : 0}%</div></div>
            <div className="h-px bg-black/10 dark:bg-white/10 my-2" />
            <div className="text-xs opacity-70">
              Notes: “Delivered” is computed as sent leads without any bounce event. Replies are based on the Replies/IMAP ingestion.
            </div>
          </div>
        </Card>

        <Card title="Top intent leads" subtitle="Based on open/click/reply signals.">
          <div className="grid gap-2">
            {scored.length === 0 ? (
              <div className="text-sm opacity-70">No engagement yet.</div>
            ) : (
              <div className="grid gap-2">
                {scored.map((x) => (
                  <div key={x.lid} className="flex items-center justify-between gap-3 rounded-xl border border-black/10 dark:border-white/10 p-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{x.lead?.firstName || x.lead?.email || "Lead"}</div>
                      <div className="text-xs opacity-70 truncate">{x.lead?.email}{x.lead?.company ? ` · ${x.lead.company}` : ""}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge>Intent {x.score}</Badge>
                      <Pill tone={x.score >= 70 ? "success" : x.score >= 40 ? "info" : "neutral"}>{x.score >= 70 ? "Hot" : x.score >= 40 ? "Warm" : "Cold"}</Pill>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </Container>
  );
}
