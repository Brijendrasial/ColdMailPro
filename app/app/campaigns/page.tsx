import { Container } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import CampaignsTable from "@/components/campaigns/campaigns-table";

function extractEmailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
}

function safeJsonParse(v: any): any | null {
  try {
    return JSON.parse(String(v || "{}"));
  } catch {
    return null;
  }
}


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
  pausedReason?: string | null;
  mailboxPoolId?: string | null;
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

  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

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


  // Manual mailbox selection (CampaignMailbox) and pool membership (MailboxPool)
  const selectedLinks = ids.length
    ? await prisma.campaignMailbox.findMany({
        where: { campaignId: { in: ids }, isActive: true },
        select: { campaignId: true, mailboxId: true },
      })
    : [];

  const poolIds = Array.from(new Set(campaigns.map((c: any) => (c.mailboxPoolId ? String(c.mailboxPoolId) : "")).filter(Boolean)));

  const poolMembers = poolIds.length
    ? await prisma.mailboxPoolMember.findMany({
        where: { poolId: { in: poolIds } },
        select: { poolId: true, mailboxId: true },
      })
    : [];

  const activeMailboxRows = await prisma.mailbox.findMany({
    where: { workspaceId: s.wid, isActive: true },
    select: { id: true, fromEmail: true, dailyLimit: true },
  });

  // Sender domains + DNS health (latest domain_dns_check job)
  const domains = await prisma.domain.findMany({
    where: { workspaceId: s.wid },
    select: { id: true, name: true },
  });

  const dnsJobs = await prisma.job.findMany({
    where: {
      type: "domain_dns_check",
      payload: { contains: s.wid },
    },
    orderBy: { createdAt: "desc" },
    take: 600,
    select: { status: true, payload: true, lastError: true, createdAt: true },
  });

  // 24h + 7d spikes (bounce/unsub rates)
  const sent24hGroups = ids.length
    ? await prisma.message.groupBy({
        by: ["campaignId"],
        where: { workspaceId: s.wid, campaignId: { in: ids }, sentAt: { gte: since24h } },
        _count: { _all: true },
      })
    : [];

  const sent7dGroups = ids.length
    ? await prisma.message.groupBy({
        by: ["campaignId"],
        where: { workspaceId: s.wid, campaignId: { in: ids }, sentAt: { gte: since7d } },
        _count: { _all: true },
      })
    : [];

  // NOTE: Event does not have campaignId. We must join via Message.
  // We count DISTINCT messageId so "rates" can't exceed 100% for bounce/unsub.
  const ev24hRows: Array<{ campaignId: string; type: string; cnt: bigint }> = ids.length
    ? await prisma.$queryRaw`
        SELECT m.campaignId as campaignId, e.type as type, COUNT(DISTINCT e.messageId) as cnt
        FROM Event e
        JOIN Message m ON e.messageId = m.id
        WHERE m.workspaceId = ${s.wid}
          AND m.campaignId IN (${Prisma.join(ids)})
          AND e.type IN ('bounce','unsubscribe')
          AND e.createdAt >= ${since24h}
        GROUP BY m.campaignId, e.type
      `
    : [];

  const ev7dRows: Array<{ campaignId: string; type: string; cnt: bigint }> = ids.length
    ? await prisma.$queryRaw`
        SELECT m.campaignId as campaignId, e.type as type, COUNT(DISTINCT e.messageId) as cnt
        FROM Event e
        JOIN Message m ON e.messageId = m.id
        WHERE m.workspaceId = ${s.wid}
          AND m.campaignId IN (${Prisma.join(ids)})
          AND e.type IN ('bounce','unsubscribe')
          AND e.createdAt >= ${since7d}
        GROUP BY m.campaignId, e.type
      `
    : [];

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
  // NOTE: poolIds is already computed above (as string[]) and reused here.
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

  const activeMailboxes = activeMailboxRows.length;

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
// Next run time is derived from enrollments, but must respect campaign startAt.
// If startAt is in the future, show that instead of an older enrollment.nextRunAt.
nextRunAt: (() => {
  let next = nextRunMap[c.id] || null;
  const startAt = (c as any).startAt || null;
  if (startAt && startAt instanceof Date && startAt.getTime() > now.getTime()) {
    if (!next || next.getTime() < startAt.getTime()) next = startAt;
  }
  return next;
})(),
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



  // -----------------------------
  // Ops panel signals (Deliverability + Ops)
  // -----------------------------
  const selectedByCampaign: Record<string, string[]> = {};
  for (const l of selectedLinks as any[]) {
    const cid = String(l.campaignId);
    if (!selectedByCampaign[cid]) selectedByCampaign[cid] = [];
    selectedByCampaign[cid].push(String(l.mailboxId));
  }

  const poolMembersByPool: Record<string, string[]> = {};
  for (const m of poolMembers as any[]) {
    const pid = String(m.poolId);
    if (!poolMembersByPool[pid]) poolMembersByPool[pid] = [];
    poolMembersByPool[pid].push(String(m.mailboxId));
  }

  const mailboxDomain: Record<string, string> = {};
  const mailboxDailyLimit: Record<string, number> = {};
  for (const mb of activeMailboxRows as any[]) {
    mailboxDomain[String(mb.id)] = extractEmailDomain(String(mb.fromEmail || ""));
    mailboxDailyLimit[String(mb.id)] = Number(mb.dailyLimit || 0);
  }

  // DNS latest status per domainId
  const domainIdByName: Record<string, string> = {};
  for (const d of domains as any[]) domainIdByName[String(d.name).toLowerCase()] = String(d.id);

  const latestDnsByDomainId = new Map<string, any>();
  for (const j of dnsJobs as any[]) {
    const payload = safeJsonParse(j.payload);
    if (!payload) continue;
    if (String(payload.workspaceId || "") !== String(s.wid)) continue;
    const did = String(payload.domainId || "");
    if (!did) continue;
    if (latestDnsByDomainId.has(did)) continue; // first is latest due to ordering
    const r = safeJsonParse(j.lastError);
    latestDnsByDomainId.set(did, r);
  }

  const dnsStatusByName: Record<string, "healthy" | "warning" | "fail" | "unknown" | "not_checked"> = {};
  for (const d of domains as any[]) {
    const did = String(d.id);
    const name = String(d.name).toLowerCase();
    const r = latestDnsByDomainId.get(did);
    if (!r) {
      dnsStatusByName[name] = "not_checked";
      continue;
    }
    const st = String(r?.summary?.status || "unknown");
    if (st === "healthy" || st === "warning" || st === "fail") dnsStatusByName[name] = st;
    else dnsStatusByName[name] = "unknown";
  }

  const failingSenderDomains = new Set<string>();
  let dnsWarnCount = 0;
  let dnsFailCount = 0;
  for (const [name, st] of Object.entries(dnsStatusByName)) {
    if (st === "warning") dnsWarnCount += 1;
    if (st === "fail") dnsFailCount += 1;
    if (st === "warning" || st === "fail") failingSenderDomains.add(name);
  }

  const sent24hByCampaign: Record<string, number> = {};
  for (const g of sent24hGroups as any[]) sent24hByCampaign[String(g.campaignId)] = Number(g._count?._all || 0);

  const sent7dByCampaign: Record<string, number> = {};
  for (const g of sent7dGroups as any[]) sent7dByCampaign[String(g.campaignId)] = Number(g._count?._all || 0);

  const ev24hByCampaign: Record<string, { bounce: number; unsubscribe: number }> = {};
  for (const g of ev24hRows as any[]) {
    const cid = String(g.campaignId);
    if (!ev24hByCampaign[cid]) ev24hByCampaign[cid] = { bounce: 0, unsubscribe: 0 };
    const n = Number(g.cnt || 0);
    if (g.type === "bounce") ev24hByCampaign[cid].bounce += n;
    if (g.type === "unsubscribe") ev24hByCampaign[cid].unsubscribe += n;
  }

  const ev7dByCampaign: Record<string, { bounce: number; unsubscribe: number }> = {};
  for (const g of ev7dRows as any[]) {
    const cid = String(g.campaignId);
    if (!ev7dByCampaign[cid]) ev7dByCampaign[cid] = { bounce: 0, unsubscribe: 0 };
    const n = Number(g.cnt || 0);
    if (g.type === "bounce") ev7dByCampaign[cid].bounce += n;
    if (g.type === "unsubscribe") ev7dByCampaign[cid].unsubscribe += n;
  }

  type OpsPausedItem = { id: string; name: string; reason: string };
  type OpsSpikeItem = { id: string; name: string; rate24h: number; rate7d: number; sent24h: number };
  type OpsDnsItem = { id: string; name: string; domains: string[]; domainIds: string[] };
  type OpsSatItem = { id: string; name: string; limit: number; capacity: number };

  const pausedWithReason: OpsPausedItem[] = [];
  const bounceSpikes: OpsSpikeItem[] = [];
  const unsubSpikes: OpsSpikeItem[] = [];
  const dnsIssues: OpsDnsItem[] = [];
  const saturation: OpsSatItem[] = [];

  for (const c of campaigns as any[]) {
    const cid = String(c.id);

    if (String(c.status) === "paused" && c.pausedReason) {
      pausedWithReason.push({ id: cid, name: String(c.name || ""), reason: String(c.pausedReason || "") });
    }

    const sent24h = sent24hByCampaign[cid] || 0;
    const sent7d = sent7dByCampaign[cid] || 0;

    const b24 = ev24hByCampaign[cid]?.bounce || 0;
    const u24 = ev24hByCampaign[cid]?.unsubscribe || 0;

    const b7 = ev7dByCampaign[cid]?.bounce || 0;
    const u7 = ev7dByCampaign[cid]?.unsubscribe || 0;

    const br24 = sent24h ? b24 / sent24h : 0;
    const ur24 = sent24h ? u24 / sent24h : 0;
    const br7 = sent7d ? b7 / sent7d : 0;
    const ur7 = sent7d ? u7 / sent7d : 0;

    // Spike rules (simple + high-signal)
    if (sent24h >= 50) {
      if (br24 >= Math.max(0.06, br7 * 2) && br24 - br7 >= 0.03) {
        bounceSpikes.push({ id: cid, name: String(c.name || ""), rate24h: br24, rate7d: br7, sent24h });
      }
      if (ur24 >= Math.max(0.01, ur7 * 2) && ur24 - ur7 >= 0.005) {
        unsubSpikes.push({ id: cid, name: String(c.name || ""), rate24h: ur24, rate7d: ur7, sent24h });
      }
    }

    // Determine effective mailboxes for DNS + capacity
    const manual = selectedByCampaign[cid] || [];
    const poolId = c.mailboxPoolId ? String(c.mailboxPoolId) : "";
    const poolMbs = poolId ? (poolMembersByPool[poolId] || []) : [];

    const usedMailboxIds = manual.length ? manual : poolId ? poolMbs : activeMailboxRows.map((m: any) => String(m.id));

    // DNS issues (sender domains)
    const domainsUsed = Array.from(
      new Set(
        usedMailboxIds
          .map((mid) => mailboxDomain[String(mid)] || "")
          .filter(Boolean)
          .map((d) => d.toLowerCase())
      )
    );

    const bad = domainsUsed.filter((d) => failingSenderDomains.has(d));
    if (bad.length) {
      const badTop = bad.slice(0, 3);
      const idsTop = badTop
        .map((dn) => domainIdByName[String(dn || "").toLowerCase()] || "")
        .filter(Boolean);
      dnsIssues.push({ id: cid, name: String(c.name || ""), domains: badTop, domainIds: idsTop });
    }

    // Sender pool saturation
    let cap = 0;
    for (const mid of usedMailboxIds) cap += Number(mailboxDailyLimit[String(mid)] || 0);
    const limit = Number(c.dailySendLimit || 0);
    if (cap > 0 && limit > cap * 0.9 && String(c.status) === "running") {
      saturation.push({ id: cid, name: String(c.name || ""), limit, capacity: cap });
    }
  }

  // Sort spikes desc by 24h rate
  bounceSpikes.sort((a, b) => b.rate24h - a.rate24h);
  unsubSpikes.sort((a, b) => b.rate24h - a.rate24h);
  dnsIssues.sort((a, b) => b.domains.length - a.domains.length);
  saturation.sort((a, b) => (b.limit / Math.max(1, b.capacity)) - (a.limit / Math.max(1, a.capacity)));
  pausedWithReason.sort((a, b) => a.name.localeCompare(b.name));

  const opsSummary = {
    pausedWithReason: pausedWithReason.slice(0, 20),
    bounceSpikes: bounceSpikes.slice(0, 20),
    unsubSpikes: unsubSpikes.slice(0, 20),
    dnsIssues: dnsIssues.slice(0, 20),
    saturation: saturation.slice(0, 20),
    dnsWarnCount,
    dnsFailCount,
  };

  return (
    <Container wide>
      {resumeDraft ? (
        <div className="mb-5 overflow-hidden rounded-[2rem] border border-amber-200/70 bg-gradient-to-r from-amber-50 via-white to-indigo-50 p-5 shadow-[0_18px_55px_rgba(15,23,42,0.07)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center rounded-full border border-amber-200 bg-white/80 px-3 py-1 text-xs font-semibold text-amber-800">Draft waiting</div>
              <div className="mt-2 text-lg font-semibold text-slate-950">Resume campaign setup</div>
              <div className="mt-1 text-sm text-slate-600">
                Continue <span className="font-semibold text-slate-950">{resumeDraft.name}</span> — last updated {resumeDraft.updatedAt.toLocaleString()}.
              </div>
            </div>
            <a href={`/app/campaigns/new?resume=${resumeDraft.id}`} className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-slate-800">
              Continue wizard →
            </a>
          </div>
        </div>
      ) : null}

      <CampaignsTable
        opsSummary={opsSummary}
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
