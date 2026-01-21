import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function domainGroup(email: string): "gmail" | "yahoo" | "outlook" | "other" {
  const at = email.lastIndexOf("@");
  const d = (at >= 0 ? email.slice(at + 1) : "").trim().toLowerCase();
  if (!d) return "other";
  if (d === "gmail.com" || d === "googlemail.com") return "gmail";
  if (d === "yahoo.com" || d === "ymail.com") return "yahoo";
  if (d.startsWith("yahoo.")) return "yahoo";
  if (["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(d)) return "outlook";
  return "other";
}

export type CampaignMailboxDashboardRow = {
  mailboxId: string;
  name: string;
  fromEmail: string;
  isActive: boolean;
  dailyLimit: number;
  warmupEnabled: boolean;
  excluded: boolean;
  domainBreakdown7d: { gmail: { sent: number; bounced: number }; yahoo: { sent: number; bounced: number }; outlook: { sent: number; bounced: number }; other: { sent: number; bounced: number } };
  sentTrend7d: number[];
  sent24h: number;
  sent7d: number;
  queued: number;
  failed24h: number;
  hardBounces7d: number;
  softBounces7d: number;
  replies7d: number;
  unsubs7d: number;
  lastSentAt?: string | null;
  idleMinutes?: number | null;
  throttle?: { until: string; reason?: string | null } | null;
  healthScore: number; // 0..100 (higher is better)
  healthBand: "great" | "good" | "risk" | "critical";
  notes: string[];
};

export async function getCampaignMailboxDashboard(workspaceId: string, campaignId: string) {
  const camp: any = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    include: {
      mailboxes: { select: { mailboxId: true, isActive: true, createdAt: true } },
      mailboxPool: {
        include: {
          members: { where: { isActive: true }, select: { mailboxId: true } },
        },
      },
    },
  });
  if (!camp) return null;

  // Resolve sender set:
  // Priority mirrors the worker:
  // 1) Explicit campaign senders (CampaignMailbox.isActive=true) => manual mode
  // 2) Pool members if mailboxPoolId set
  // 3) All active workspace mailboxes
  // Additionally: CampaignMailbox.isActive=false is treated as an exclusion override (useful for pool/all modes)

  const campaignMailboxRows = Array.isArray(camp.mailboxes) ? camp.mailboxes : [];
  const manualActive = campaignMailboxRows.filter((m: any) => m.isActive).map((m: any) => String(m.mailboxId));
  const manualAny = campaignMailboxRows.map((m: any) => String(m.mailboxId));

  let mailboxIds: string[] = [];
  if (manualActive.length) {
    // Manual mode: show both included + excluded rows for visibility
    mailboxIds = manualAny;
  } else if (camp.mailboxPool?.members?.length) {
    mailboxIds = camp.mailboxPool.members.map((m: any) => String(m.mailboxId));
  } else {
    const all = await prisma.mailbox.findMany({ where: { workspaceId, isActive: true }, select: { id: true } });
    mailboxIds = all.map((m) => String(m.id));
  }

  mailboxIds = Array.from(new Set(mailboxIds)).filter(Boolean);

  const excludedSet = new Set(
    campaignMailboxRows
      .filter((m: any) => !m.isActive)
      .map((m: any) => String(m.mailboxId))
  );

  const mailboxes = await prisma.mailbox.findMany({
    where: { workspaceId, id: { in: mailboxIds } },
    select: {
      id: true,
      name: true,
      fromEmail: true,
      isActive: true,
      dailyLimit: true,
      warmupEnabled: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 3600 * 1000);
  const since7d = new Date(now.getTime() - 7 * 24 * 3600 * 1000);


  // Domain breakdown (7d) + sent trend (7d) for the dashboard rows.
  // We compute this once and then attach per mailbox.
  const domainByMailbox = new Map<string, { gmail: { sent: number; bounced: number }; yahoo: { sent: number; bounced: number }; outlook: { sent: number; bounced: number }; other: { sent: number; bounced: number } }>();
  const trendByMailbox = new Map<string, number[]>();

  // Build a stable list of last 7 UTC dates (oldest -> newest)
  const dayKeys: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - i);
    dayKeys.push(d.toISOString().slice(0, 10));
  }

  if (mailboxIds.length) {
    // Sent trend per day (7d) - grouped in SQL for performance
    try {
      const rows: any[] = await prisma.$queryRaw(
        Prisma.sql`SELECT mailboxId as mailboxId, DATE(sentAt) as day, COUNT(*) as cnt
                   FROM Message
                   WHERE workspaceId=${workspaceId} AND campaignId=${campaignId}
                     AND sentAt IS NOT NULL AND sentAt >= ${since7d}
                     AND mailboxId IN (${Prisma.join(mailboxIds)})
                   GROUP BY mailboxId, DATE(sentAt)`
      );
      for (const r of rows) {
        const mbid = String(r.mailboxId);
        const day = (r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10));
        const cnt = Number(r.cnt || 0);
        if (!trendByMailbox.has(mbid)) trendByMailbox.set(mbid, dayKeys.map(() => 0));
        const arr = trendByMailbox.get(mbid)!;
        const idx = dayKeys.indexOf(day);
        if (idx >= 0) arr[idx] += cnt;
      }
    } catch {
      // ignore
    }

    // Domain breakdown (7d): sent + bounced (using Message.status='bounced')
    try {
      const msgs: any[] = await prisma.$queryRaw(
        Prisma.sql`SELECT m.mailboxId as mailboxId, l.email as email, m.status as status
                   FROM Message m
                   JOIN Lead l ON l.id = m.leadId
                   WHERE m.workspaceId=${workspaceId} AND m.campaignId=${campaignId}
                     AND m.sentAt IS NOT NULL AND m.sentAt >= ${since7d}
                     AND m.mailboxId IN (${Prisma.join(mailboxIds)})`
      );

      function init() {
        return {
          gmail: { sent: 0, bounced: 0 },
          yahoo: { sent: 0, bounced: 0 },
          outlook: { sent: 0, bounced: 0 },
          other: { sent: 0, bounced: 0 },
        };
      }

      for (const m of msgs) {
        const mbid = String(m.mailboxId);
        const email = String(m.email || "");
        const g = domainGroup(email);
        if (!domainByMailbox.has(mbid)) domainByMailbox.set(mbid, init());
        const d = domainByMailbox.get(mbid)!;
        d[g].sent += 1;
        if (String(m.status || "") === "bounced") d[g].bounced += 1;
      }
    } catch {
      // ignore
    }
  }

  // Campaign scoped message counts
  const [sent24h, sent7d, queued, failed24h] = await Promise.all([
    prisma.message.groupBy({
      by: ["mailboxId"],
      where: { workspaceId, campaignId, mailboxId: { in: mailboxIds }, sentAt: { gte: since24h } },
      _count: { _all: true },
    }).catch(() => [] as any[]),
    prisma.message.groupBy({
      by: ["mailboxId"],
      where: { workspaceId, campaignId, mailboxId: { in: mailboxIds }, sentAt: { gte: since7d } },
      _count: { _all: true },
    }).catch(() => [] as any[]),
    prisma.message.groupBy({
      by: ["mailboxId"],
      where: { workspaceId, campaignId, mailboxId: { in: mailboxIds }, status: "queued" },
      _count: { _all: true },
    }).catch(() => [] as any[]),
    prisma.message.groupBy({
      by: ["mailboxId"],
      where: { workspaceId, campaignId, mailboxId: { in: mailboxIds }, status: "failed", createdAt: { gte: since24h } },
      _count: { _all: true },
    }).catch(() => [] as any[]),
  ]);

  // Campaign scoped events
  const [hard7d, soft7d, replies7d, unsubs7d] = await Promise.all([
    prisma.event.groupBy({
      by: ["messageId"],
      where: {
        type: "bounce_hard",
        createdAt: { gte: since7d },
        message: { campaignId, workspaceId, mailboxId: { in: mailboxIds } },
      },
      _count: { _all: true },
    }).catch(() => [] as any[]),
    prisma.event.groupBy({
      by: ["messageId"],
      where: {
        type: "bounce_soft",
        createdAt: { gte: since7d },
        message: { campaignId, workspaceId, mailboxId: { in: mailboxIds } },
      },
      _count: { _all: true },
    }).catch(() => [] as any[]),
    prisma.event.groupBy({
      by: ["messageId"],
      where: {
        type: "reply",
        createdAt: { gte: since7d },
        message: { campaignId, workspaceId, mailboxId: { in: mailboxIds } },
      },
      _count: { _all: true },
    }).catch(() => [] as any[]),
    prisma.event.groupBy({
      by: ["messageId"],
      where: {
        type: { in: ["unsubscribe", "unsub"] },
        createdAt: { gte: since7d },
        message: { campaignId, workspaceId, mailboxId: { in: mailboxIds } },
      },
      _count: { _all: true },
    }).catch(() => [] as any[]),
  ]);

  // Note: Prisma groupBy cannot "group by mailboxId" on Event directly because mailboxId is on Message.
  // We'll aggregate by loading messageIds and mapping them to mailboxIds via a small lookup.
  const messageIdsForEvents = Array.from(
    new Set([
      ...hard7d.map((x) => String(x.messageId)),
      ...soft7d.map((x) => String(x.messageId)),
      ...replies7d.map((x) => String(x.messageId)),
      ...unsubs7d.map((x) => String(x.messageId)),
    ])
  ).filter(Boolean);

  const msgToMailbox = new Map<string, string>();
  if (messageIdsForEvents.length) {
    const msgs = await prisma.message.findMany({
      where: { id: { in: messageIdsForEvents } },
      select: { id: true, mailboxId: true },
    });
    for (const m of msgs) {
      if (m.mailboxId) msgToMailbox.set(String(m.id), String(m.mailboxId));
    }
  }

  function rollupEventCounts(rows: any[]) {
    const map = new Map<string, number>();
    for (const r of rows) {
      const mid = String(r.messageId);
      const mbid = msgToMailbox.get(mid);
      if (!mbid) continue;
      map.set(mbid, (map.get(mbid) || 0) + Number(r._count?._all || 0));
    }
    return map;
  }

  const hardMap = rollupEventCounts(hard7d);
  const softMap = rollupEventCounts(soft7d);
  const replyMap = rollupEventCounts(replies7d);
  const unsubMap = rollupEventCounts(unsubs7d);

  const sent24Map = new Map(sent24h.map((r: any) => [String(r.mailboxId), Number(r._count?._all || 0)]));
  const sent7Map = new Map(sent7d.map((r: any) => [String(r.mailboxId), Number(r._count?._all || 0)]));
  const qMap = new Map(queued.map((r: any) => [String(r.mailboxId), Number(r._count?._all || 0)]));
  const fail24Map = new Map(failed24h.map((r: any) => [String(r.mailboxId), Number(r._count?._all || 0)]));

  const throttles = await prisma.mailboxThrottle.findMany({
    where: { campaignId, mailboxId: { in: mailboxIds }, until: { gt: now } },
    select: { mailboxId: true, until: true, reason: true },
    orderBy: { until: "asc" },
  });
  const throttleMap = new Map<string, { until: string; reason?: string | null }>();
  for (const t of throttles) {
    throttleMap.set(String(t.mailboxId), { until: t.until.toISOString(), reason: t.reason });
  }

  // Last sent per mailbox (campaign scope)
  const lastSent = await Promise.all(
    mailboxes.map(async (mb) => {
      const m = await prisma.message.findFirst({
        where: { workspaceId, campaignId, mailboxId: mb.id, sentAt: { not: null } },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true },
      });
      return [mb.id, m?.sentAt || null] as const;
    })
  );
  const lastSentMap = new Map<string, Date | null>(lastSent);

  const rows: CampaignMailboxDashboardRow[] = mailboxes.map((mb) => {
    const s24 = sent24Map.get(mb.id) || 0;
    const s7 = sent7Map.get(mb.id) || 0;
    const hb = hardMap.get(mb.id) || 0;
    const sb = softMap.get(mb.id) || 0;
    const rp = replyMap.get(mb.id) || 0;
    const un = unsubMap.get(mb.id) || 0;
    const q = qMap.get(mb.id) || 0;
    const f24 = fail24Map.get(mb.id) || 0;
    const thr = throttleMap.get(mb.id) || null;

    // Health score (simple, explainable): start at 100 and subtract penalties.
    const bounceRate7d = s7 ? (hb + sb) / s7 : 0;
    const hardRate7d = s7 ? hb / s7 : 0;
    const unsubRate7d = s7 ? un / s7 : 0;

    const bouncePenalty = clamp(bounceRate7d * 600, 0, 30); // 1% => 6 points
    const hardPenalty = clamp(hardRate7d * 900, 0, 40); // 1% => 9 points
    const unsubPenalty = clamp(unsubRate7d * 1000, 0, 25); // 1% => 10 points
    const failPenalty = clamp(f24 * 4, 0, 20);
    const throttlePenalty = thr ? 15 : 0;
    const lowSamplePenalty = s7 > 0 && s7 < 20 ? 5 : 0;

    let health = 100 - bouncePenalty - hardPenalty - unsubPenalty - failPenalty - throttlePenalty - lowSamplePenalty;
    health = Math.round(clamp(health, 0, 100));

    const band: CampaignMailboxDashboardRow["healthBand"] = health >= 85 ? "great" : health >= 70 ? "good" : health >= 55 ? "risk" : "critical";

    const notes: string[] = [];
    if (excludedSet.has(mb.id)) notes.push("Excluded from this campaign");
    if (thr) notes.push("On cooldown for this campaign");
    if (f24) notes.push(`${f24} failures in last 24h`);
    if (s7 >= 20 && hardRate7d >= 0.05) notes.push("Hard bounces high (7d)");
    if (s7 >= 20 && bounceRate7d >= 0.08) notes.push("Total bounces high (7d)");
    if (s7 >= 20 && unsubRate7d >= 0.02) notes.push("Unsubs high (7d)");
    if (notes.length === 0) notes.push("Healthy");

    const ls = lastSentMap.get(mb.id) || null;
    const idleMin = ls ? Math.round((now.getTime() - ls.getTime()) / 60000) : null;

    return {
      mailboxId: mb.id,
      name: mb.name,
      fromEmail: mb.fromEmail,
      isActive: mb.isActive,
      dailyLimit: mb.dailyLimit,
      warmupEnabled: mb.warmupEnabled,
      excluded: excludedSet.has(mb.id),
      domainBreakdown7d: domainByMailbox.get(mb.id) || { gmail: { sent: 0, bounced: 0 }, yahoo: { sent: 0, bounced: 0 }, outlook: { sent: 0, bounced: 0 }, other: { sent: 0, bounced: 0 } },
      sentTrend7d: trendByMailbox.get(mb.id) || [0,0,0,0,0,0,0],
      sent24h: s24,
      sent7d: s7,
      queued: q,
      failed24h: f24,
      hardBounces7d: hb,
      softBounces7d: sb,
      replies7d: rp,
      unsubs7d: un,
      lastSentAt: ls ? ls.toISOString() : null,
      idleMinutes: idleMin,
      throttle: thr,
      healthScore: health,
      healthBand: band,
      notes,
    };
  });

  // Default sort: healthiest first, then least queued
  rows.sort((a, b) => (b.healthScore - a.healthScore) || (a.queued - b.queued) || (b.sent7d - a.sent7d));

  const totals = rows.reduce(
    (acc, r) => {
      acc.mailboxes += 1;
      if (r.throttle) acc.throttled += 1;
      acc.sent24h += r.sent24h;
      acc.sent7d += r.sent7d;
      acc.queued += r.queued;
      acc.failed24h += r.failed24h;
      return acc;
    },
    { mailboxes: 0, throttled: 0, sent24h: 0, sent7d: 0, queued: 0, failed24h: 0 }
  );

  return {
    campaign: {
      id: camp.id,
      name: camp.name,
      status: camp.status,
      mailboxStrategy: camp.mailboxStrategy,
      mailboxMinIdleMinutes: Number(camp.mailboxMinIdleMinutes || 0),
      senderMode: (manualActive.length) ? "manual" : camp.mailboxPoolId ? "pool" : "all",
      mailboxPoolId: camp.mailboxPoolId || null,
      mailboxPoolName: camp.mailboxPool?.name || null,
    },
    totals,
    rows,
    windows: {
      since24h: since24h.toISOString(),
      since7d: since7d.toISOString(),
    },
  };
}
