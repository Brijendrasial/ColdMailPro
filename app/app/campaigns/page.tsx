import { Container } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import CampaignsTable from "@/components/campaigns/campaigns-table";

type Row = {
  archivedAt?: Date | null;
  startAt?: Date | null;
  endAt?: Date | null;
  daysOfWeek?: any;
  rampEnabled?: boolean;
  rampStartLimit?: number;
  rampDailyIncrease?: number;
  rampMaxLimit?: number;
  nextRunAt?: Date | null;
  senderPoolCount?: number;
  id: string;
  name: string;
  status: string;
  statusRaw: string;
  timezone: string;
  sendingWindow: string;
  dailySendLimit: number;
  mailboxStrategy: string;
  stopOnReply: boolean;
  stopOnBounce: boolean;
  createdAt: Date;
  updatedAt: Date;
  stepsCount: number;
  leadsTotal: number;
  leadsActive: number;
  leadsCompleted: number;
  sent: number;
  failed: number;
  bounces: number;
  opens: number;
  clicks: number;
  replies: number;
  unsubscribes: number;
  activeMailboxes: number;
};

export default async function Campaigns() {
  const s = await requireSession();

  const resumeDraft = await prisma.campaign.findFirst({
    where: { workspaceId: s.wid, status: "draft", setupCompleted: false, setupStep: { gt: 0 } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, setupStep: true, updatedAt: true },
  });

  const campaigns = await prisma.campaign.findMany({
    where: { workspaceId: s.wid },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { steps: true } } },
  });

  const ids = campaigns.map((c) => c.id);

  const senderPoolGroups = ids.length
    ? await prisma.campaignMailbox.groupBy({
        by: ["campaignId"],
        where: { campaignId: { in: ids }, isActive: true },
        _count: { _all: true },
      })
    : [];

  const senderPoolMap: Record<string, number> = {};
  for (const g of senderPoolGroups as any[]) senderPoolMap[g.campaignId] = Number(g._count?._all || 0);

  // Pool-based routing: count active members for any pool used by campaigns
  const poolIds = Array.from(new Set(campaigns.map((c: any) => c.mailboxPoolId).filter(Boolean) as string[]));
  const poolCountRows: Array<{ poolId: string; cnt: bigint }> = poolIds.length
    ? await prisma.$queryRaw`
        SELECT pm.poolId as poolId, COUNT(*) as cnt
        FROM MailboxPoolMember pm
        JOIN Mailbox mb ON mb.id = pm.mailboxId
        WHERE pm.poolId IN (${Prisma.join(poolIds)})
          AND pm.isActive = true
          AND mb.isActive = true
        GROUP BY pm.poolId
      `
    : [];
  const poolCountMap: Record<string, number> = {};
  for (const r of poolCountRows as any[]) poolCountMap[String(r.poolId)] = Number(r.cnt || 0);

  const nextRunGroups = ids.length
    ? await prisma.enrollment.groupBy({
        by: ["campaignId"],
        where: { campaignId: { in: ids }, status: { in: ["queued", "active"] } },
        _min: { nextRunAt: true },
      })
    : [];

  const nextRunMap: Record<string, Date | null> = {};
  for (const g of nextRunGroups as any[]) nextRunMap[g.campaignId] = (g._min?.nextRunAt as Date) || null;

  const activeMailboxes = await prisma.mailbox.count({ where: { workspaceId: s.wid, isActive: true } });

  // Enrollment counts by campaign & status
  const enrollGroups = ids.length
    ? await prisma.enrollment.groupBy({
        by: ["campaignId", "status"],
        where: { campaignId: { in: ids } },
        _count: { _all: true },
      })
    : [];

  // Message counts by campaign & status
  // NOTE: Message.status is an "active state" and can change (e.g. sent -> opened -> replied).
  // For the "Sent" metric, we must not rely on status === "sent". Use sentAt instead.
  const msgGroups = ids.length
    ? await prisma.message.groupBy({
        by: ["campaignId", "status"],
        where: { workspaceId: s.wid, campaignId: { in: ids } },
        _count: { _all: true },
      })
    : [];

  const sentGroups = ids.length
    ? await prisma.message.groupBy({
        by: ["campaignId"],
        where: { workspaceId: s.wid, campaignId: { in: ids }, sentAt: { not: null } },
        _count: { _all: true },
      })
    : [];

  // Event counts by campaign & type (via join)
  const eventRows: Array<{ campaignId: string; type: string; cnt: bigint }> = ids.length
    ? await prisma.$queryRaw`
        -- Unique-by-message counts so rates can't exceed 100%
        SELECT m.campaignId as campaignId, e.type as type, COUNT(DISTINCT e.messageId) as cnt
        FROM Event e
        JOIN Message m ON e.messageId = m.id
        WHERE m.workspaceId = ${s.wid}
          AND m.campaignId IN (${Prisma.join(ids)})
        GROUP BY m.campaignId, e.type
      `
    : [];

  const enrollMap: Record<string, { total: number; queued: number; active: number; completed: number; stopped: number; done: number }> = {};
  for (const g of enrollGroups as any[]) {
    const cid = g.campaignId as string;
    if (!enrollMap[cid]) enrollMap[cid] = { total: 0, queued: 0, active: 0, completed: 0, stopped: 0, done: 0 };
    const n = Number(g._count?._all || 0);
    enrollMap[cid].total += n;
    if (g.status === "queued") enrollMap[cid].queued += n;
    if (g.status === "active") enrollMap[cid].active += n;
    if (g.status === "completed") enrollMap[cid].completed += n;
    if (g.status === "stopped") enrollMap[cid].stopped += n;
    if (g.status === "completed" || g.status === "stopped") enrollMap[cid].done += n;
  }

  const sentMap: Record<string, number> = {};
  for (const g of sentGroups as any[]) {
    const cid = g.campaignId as string;
    if (!cid) continue;
    sentMap[cid] = Number(g._count?._all || 0);
  }

  const msgMap: Record<string, { sent: number; failed: number; bounced: number }> = {};
  for (const g of msgGroups as any[]) {
    const cid = g.campaignId as string;
    if (!cid) continue;
    if (!msgMap[cid]) msgMap[cid] = { sent: 0, failed: 0, bounced: 0 };
    const n = Number(g._count?._all || 0);
    // sent is populated from sentAt-based aggregation below
    if (g.status === "failed") msgMap[cid].failed += n;
    if (g.status === "bounced") msgMap[cid].bounced += n;
  }

  for (const cid of Object.keys(sentMap)) {
    if (!msgMap[cid]) msgMap[cid] = { sent: 0, failed: 0, bounced: 0 };
    msgMap[cid].sent = sentMap[cid] || 0;
  }

  const eventMap: Record<string, { open: number; click: number; reply: number; bounce: number; unsubscribe: number }> = {};
  for (const r of eventRows as any[]) {
    const cid = r.campaignId as string;
    if (!cid) continue;
    if (!eventMap[cid]) eventMap[cid] = { open: 0, click: 0, reply: 0, bounce: 0, unsubscribe: 0 };
    const n = Number(r.cnt || 0);
    if (r.type === "open") eventMap[cid].open += n;
    if (r.type === "click") eventMap[cid].click += n;
    if (r.type === "reply") eventMap[cid].reply += n;
    if (r.type === "bounce" || r.type === "bounce_hard" || r.type === "bounce_soft") eventMap[cid].bounce += n;
    if (r.type === "unsubscribe") eventMap[cid].unsubscribe += n;
  }

  const rows: Row[] = campaigns.map((c) => {
    const e = enrollMap[c.id] || { total: 0, queued: 0, active: 0, completed: 0, stopped: 0, done: 0 };
    const m = msgMap[c.id] || { sent: 0, failed: 0, bounced: 0 };
    const ev = eventMap[c.id] || { open: 0, click: 0, reply: 0, bounce: 0, unsubscribe: 0 };

    // Derived "completed" state:
    // If campaign is still marked running but all enrollments are done (completed/stopped) and none are queued/active,
    // show it as "completed" in the UI.
    const statusRaw = c.status;
    const status =
      statusRaw === "running" && e.total > 0 && e.active === 0 && e.queued === 0 && e.done === e.total
        ? "completed"
        : statusRaw;

    const manualCount = senderPoolMap[c.id] || 0;
    const poolId = (c as any).mailboxPoolId ? String((c as any).mailboxPoolId) : "";
    const poolCount = poolId ? (poolCountMap[poolId] || 0) : 0;
    const effectiveMailboxCount = manualCount > 0 ? manualCount : poolId ? poolCount : activeMailboxes;

    return {
      id: c.id,
      name: c.name,
      status: (c as any).archivedAt ? "archived" : status,
      statusRaw,
      archivedAt: (c as any).archivedAt || null,
      startAt: (c as any).startAt || null,
      endAt: (c as any).endAt || null,
      daysOfWeek: (c as any).daysOfWeek || null,
      rampEnabled: (c as any).rampEnabled || false,
      rampStartLimit: (c as any).rampStartLimit || 20,
      rampDailyIncrease: (c as any).rampDailyIncrease || 20,
      rampMaxLimit: (c as any).rampMaxLimit || c.dailySendLimit,
      nextRunAt: nextRunMap[c.id] || null,
      senderPoolCount: manualCount > 0 ? manualCount : poolId ? poolCount : 0,
      timezone: c.timezone,
      sendingWindow: c.sendingWindow,
      dailySendLimit: c.dailySendLimit,
      mailboxStrategy: c.mailboxStrategy,
      stopOnReply: c.stopOnReply,
      stopOnBounce: c.stopOnBounce,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,

      stepsCount: (c as any)._count?.steps || 0,

      leadsTotal: e.total,
      leadsActive: e.active,
      leadsCompleted: e.completed,

      sent: m.sent,
      failed: m.failed,
      bounces: Math.max(m.bounced, ev.bounce), // event-based bounce can be higher

      opens: ev.open,
      clicks: ev.click,
      replies: ev.reply,
      unsubscribes: ev.unsubscribe,

      activeMailboxes: effectiveMailboxCount,
    };
  });

  return (
    <Container wide>
      {resumeDraft ? (
        <div className="mb-4 rounded-2xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/10 p-4 flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="font-semibold">Resume campaign setup</div>
            <div className="text-sm opacity-70 mt-1">
              You have an unfinished draft: <span className="font-medium">{resumeDraft.name}</span> (last updated{" "}
              {resumeDraft.updatedAt.toLocaleString()}).
            </div>
          </div>
          <a
            href={`/app/campaigns/new?resume=${resumeDraft.id}`}
            className="inline-flex items-center px-4 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-black hover:bg-black/5 dark:hover:bg-white/10"
          >
            Continue wizard →
          </a>
        </div>
      ) : null}

      <CampaignsTable
        initial={rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          nextRunAt: r.nextRunAt ? r.nextRunAt.toISOString() : null,
          startAt: r.startAt ? r.startAt.toISOString() : null,
          endAt: r.endAt ? r.endAt.toISOString() : null,
          archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
        }))}
      />
    </Container>
  );
}
