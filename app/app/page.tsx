import Link from "next/link";
import { Container, Card, Pill, Button, Badge } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import DateRangeControls from "@/components/dashboard/date-range-controls";

function fmtDateUTC(d: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(d);
}

function fmtDateTimeUTC(d: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function pct(n: number) {
  if (!Number.isFinite(n)) return "0%";
  return `${Math.round(n * 100)}%`;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function Sparkline({ values }: { values: number[] }) {
  const w = 160;
  const h = 42;
  const pad = 4;
  const n = values.length;
  const max = Math.max(1, ...values);
  const min = Math.min(...values);
  const span = Math.max(1, max - min);
  const step = n > 1 ? (w - pad * 2) / (n - 1) : 0;
  const pts = values.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (h - pad * 2) * (1 - (v - min) / span);
    return [x, y] as const;
  });
  const d = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="text-indigo-600">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function parseDateOnlyUTC(s?: string | string[] | null) {
  if (!s || Array.isArray(s)) return null;
  const m = /^\d{4}-\d{2}-\d{2}$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = s.split("-").map((x) => Number(x));
  if (!y || !mo || !d) return null;
  return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
}

function dayKeyUTC(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function toNumber(x: any) {
  if (typeof x === "bigint") return Number(x);
  if (typeof x === "number") return x;
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function safeJsonParse(v: any) {
  try {
    return JSON.parse(String(v || "{}"));
  } catch {
    return null;
  }
}

function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function dateOnlyUTC(d: Date) {
  // YYYY-MM-DD (UTC)
  return d.toISOString().slice(0, 10);
}

function analyticsRangeParams(rangeKey: string, rangeStart: Date, rangeEnd: Date) {
  const p = new URLSearchParams();
  // Analytics supports: 7d | 30d | 90d | custom
  if (rangeKey === "30d") {
    p.set("range", "30d");
    return p;
  }
  if (rangeKey === "custom") {
    p.set("range", "custom");
    p.set("from", dateOnlyUTC(rangeStart));
    p.set("to", dateOnlyUTC(rangeEnd));
    return p;
  }
  if (rangeKey === "24h") {
    // Analytics ranges are day-based; map 24h into a 2-day custom range (close enough for drill-down).
    p.set("range", "custom");
    p.set("from", dateOnlyUTC(rangeStart));
    p.set("to", dateOnlyUTC(rangeEnd));
    return p;
  }
  p.set("range", "7d");
  return p;
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const s = await requireSession();

  const now = new Date();
  const todayStart = startOfUtcDay(now);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const nowPlus60m = new Date(now.getTime() + 60 * 60 * 1000);
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const rangeKey = (searchParams?.range as string | undefined) || "7d";

  let rangeStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  let rangeEnd = now;
  let rangeLabel = "Last 7 days";

  if (rangeKey === "24h") {
    rangeStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    rangeLabel = "Last 24 hours";
  } else if (rangeKey === "30d") {
    rangeStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    rangeLabel = "Last 30 days";
  } else if (rangeKey === "custom") {
    const from = parseDateOnlyUTC(searchParams?.from);
    const to = parseDateOnlyUTC(searchParams?.to);
    if (from && to) {
      const toEnd = new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1);
      rangeStart = from;
      rangeEnd = toEnd;
      rangeLabel = `${fmtDateUTC(from)} → ${fmtDateUTC(to)}`;
    }
  }

  // Trend window (sparkline) - keep it readable regardless of range.
  let trendDays = 14;
  if (rangeKey === "30d") trendDays = 30;
  if (rangeKey === "24h") trendDays = 7;
  if (rangeKey === "custom") {
    const from = parseDateOnlyUTC(searchParams?.from);
    const to = parseDateOnlyUTC(searchParams?.to);
    if (from && to) {
      const diff = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;
      trendDays = clamp(diff, 2, 60);
    }
  }

  const endDay = new Date(Date.UTC(rangeEnd.getUTCFullYear(), rangeEnd.getUTCMonth(), rangeEnd.getUTCDate(), 0, 0, 0, 0));
  const trendStartDay = new Date(endDay.getTime() - (trendDays - 1) * 24 * 60 * 60 * 1000);
  const trendEndExclusive = new Date(endDay.getTime() + 24 * 60 * 60 * 1000);

  const since24 = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    campaignsTotal,
    campaignsRunning,
    campaignsPaused,
    campaignsDraft,
    leadsTotal,
    leadsActive,
    domains,
    mailboxesActive,
    warmupEnabled,
    mailboxesMissingImap,
    mailboxesSkipVerify,
    sentRange,
    openRange,
    replyRange,
    bounceRange,
    unsubRange,
    recentCampaigns,
    draftCampaigns,
    pausedWithReason,
    activeThrottles,
    recentEvents,
    // Command center
    mailboxDailyAgg,
    sentToday,
    queuedNow,
    failedToday,
    enrollDueSoon,
    warmupPlacement7d,
    domainDnsJobs,
    replyThreadsAgg,
    bounceTypeAgg,
    recipientDomainAgg,
  ] = await Promise.all([
    prisma.campaign.count({ where: { workspaceId: s.wid, archivedAt: null } }),
    prisma.campaign.count({ where: { workspaceId: s.wid, status: "running", archivedAt: null } }),
    prisma.campaign.count({ where: { workspaceId: s.wid, status: "paused", archivedAt: null } }),
    prisma.campaign.count({ where: { workspaceId: s.wid, status: "draft", archivedAt: null } }),
    prisma.lead.count({ where: { workspaceId: s.wid } }),
    prisma.lead.count({ where: { workspaceId: s.wid, status: "active" } }),
    prisma.domain.findMany({
      where: { workspaceId: s.wid },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
    prisma.mailbox.count({ where: { workspaceId: s.wid, isActive: true } }),
    prisma.mailbox.count({ where: { workspaceId: s.wid, isActive: true, warmupEnabled: true } }),
    prisma.mailbox.count({
      where: {
        workspaceId: s.wid,
        isActive: true,
        OR: [{ imapHost: null }, { imapUser: null }, { imapPassEnc: null }],
      },
    }),
    prisma.mailbox.count({ where: { workspaceId: s.wid, isActive: true, imapTlsSkipVerify: true } }),
    prisma.message.count({ where: { workspaceId: s.wid, sentAt: { gte: rangeStart, lte: rangeEnd } } }),
    // NOTE: use UNIQUE-by-message counts for rates, otherwise opens/clicks/replies can exceed 100%
    // because a single message can fire multiple events (multiple opens, security scanners, etc.).
    prisma.event
      .findMany({
        where: { type: "open", createdAt: { gte: rangeStart, lte: rangeEnd }, message: { workspaceId: s.wid } },
        distinct: ["messageId"],
        select: { messageId: true },
      })
      .then((rows) => rows.length),
    prisma.event
      .findMany({
        where: { type: "reply", createdAt: { gte: rangeStart, lte: rangeEnd }, message: { workspaceId: s.wid } },
        distinct: ["messageId"],
        select: { messageId: true },
      })
      .then((rows) => rows.length),
    prisma.event
      .findMany({
        where: { type: { in: ["bounce","bounce_hard","bounce_soft"] }, createdAt: { gte: rangeStart, lte: rangeEnd }, message: { workspaceId: s.wid } },
        distinct: ["messageId"],
        select: { messageId: true },
      })
      .then((rows) => rows.length),
    prisma.event
      .findMany({
        where: { type: "unsubscribe", createdAt: { gte: rangeStart, lte: rangeEnd }, message: { workspaceId: s.wid } },
        distinct: ["messageId"],
        select: { messageId: true },
      })
      .then((rows) => rows.length),
    prisma.campaign.findMany({
      where: { workspaceId: s.wid, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: { id: true, name: true, status: true, updatedAt: true, timezone: true, sendingWindow: true, dailySendLimit: true },
    }),
    prisma.campaign.findMany({
      where: { workspaceId: s.wid, setupCompleted: false, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 3,
      select: { id: true, name: true, setupStep: true, updatedAt: true },
    }),
    prisma.campaign.findMany({
      where: { workspaceId: s.wid, status: "paused", pausedReason: { not: null }, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 3,
      select: { id: true, name: true, updatedAt: true },
    }),
    prisma.mailboxThrottle.findMany({
      where: { until: { gt: now }, campaign: { workspaceId: s.wid } },
      orderBy: { until: "asc" },
      take: 5,
      select: {
        id: true,
        until: true,
        reason: true,
        campaign: { select: { id: true, name: true } },
        mailbox: { select: { id: true, fromEmail: true } },
      },
    }),
    prisma.event.findMany({
      where: { createdAt: { gte: since24 }, message: { workspaceId: s.wid } },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        type: true,
        createdAt: true,
        message: {
          select: {
            campaignId: true,
            campaign: { select: { id: true, name: true } },
            lead: { select: { id: true, email: true } },
            mailbox: { select: { id: true, fromEmail: true } },
            subject: true,
          },
        },
      },
    }),

    // -------------------------------
    // Command center: Today / Replies / Queue / DNS+Warmup
    // -------------------------------
    prisma.mailbox.aggregate({
      where: { workspaceId: s.wid, isActive: true },
      _sum: { dailyLimit: true },
    }),
    prisma.message.count({ where: { workspaceId: s.wid, sentAt: { gte: todayStart, lt: tomorrowStart } } }),
    prisma.message.count({ where: { workspaceId: s.wid, status: "queued" } }),
    prisma.message.count({
      where: { workspaceId: s.wid, status: "failed", createdAt: { gte: todayStart, lt: tomorrowStart } },
    }),
    prisma.enrollment.count({
      where: {
        campaign: { workspaceId: s.wid },
        status: { in: ["queued", "active"] },
        nextRunAt: { lte: nowPlus60m },
      },
    }),
    prisma.warmupMessage.groupBy({
      by: ["placement"],
      where: { workspaceId: s.wid, seedInboxId: { not: null }, receivedAt: { gte: since7d } },
      _count: { _all: true },
    }),
    prisma.job.findMany({
      where: { type: "domain_dns_check", status: { in: ["queued", "running", "done", "failed"] } },
      orderBy: { createdAt: "desc" },
      take: 1200,
      select: { status: true, payload: true, lastError: true, createdAt: true },
    }),
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS totalThreads,
        SUM(CASE WHEN (rs.lastReadAt IS NULL OR r.lastReplyAt > rs.lastReadAt) THEN 1 ELSE 0 END) AS unreadThreads,
        SUM(
          CASE
            WHEN (rs.snoozeUntil IS NOT NULL AND rs.snoozeUntil <= ${now} AND COALESCE(rs.status,'open') IN ('open','follow_up'))
              THEN 1
            ELSE 0
          END
        ) AS dueThreads,
        SUM(
          CASE
            WHEN (rs.assignedToUserId = ${s.uid} AND COALESCE(rs.status,'open') IN ('open','follow_up'))
              THEN 1
            ELSE 0
          END
        ) AS mineThreads,
        SUM(CASE WHEN COALESCE(rs.status,'open') = 'open' THEN 1 ELSE 0 END) AS openThreads,
        SUM(CASE WHEN COALESCE(rs.status,'open') = 'follow_up' THEN 1 ELSE 0 END) AS followUpThreads
      FROM (
        SELECT m.leadId AS leadId, MAX(e.createdAt) AS lastReplyAt
        FROM Event e
        JOIN Message m ON m.id = e.messageId
        WHERE m.workspaceId = ${s.wid}
          AND m.leadId IS NOT NULL
          AND e.type = 'reply'
        GROUP BY m.leadId
      ) r
      LEFT JOIN ReplyLeadState rs
        ON rs.workspaceId = ${s.wid} AND rs.leadId = r.leadId
    `,

    // Bounce reasons breakdown (unique-by-message) for the selected range
    prisma.$queryRaw`
      SELECT COALESCE(m.bounceType,'unknown') AS bounceType, COUNT(DISTINCT e.messageId) AS cnt
      FROM Event e
      JOIN Message m ON m.id = e.messageId
      WHERE m.workspaceId = ${s.wid}
        AND e.createdAt >= ${rangeStart}
        AND e.createdAt <= ${rangeEnd}
        AND e.type IN ('bounce','bounce_hard','bounce_soft')
      GROUP BY COALESCE(m.bounceType,'unknown')
      ORDER BY cnt DESC
    `,

    // Recipient domain hotspots (top domains by volume) + bounce/unsub signals
    prisma.$queryRaw`
      SELECT s.domain AS domain,
             COUNT(*) AS sent,
             SUM(CASE WHEN b.messageId IS NOT NULL THEN 1 ELSE 0 END) AS bounced,
             SUM(CASE WHEN u.messageId IS NOT NULL THEN 1 ELSE 0 END) AS unsub
      FROM (
        SELECT m.id AS messageId, LOWER(SUBSTRING_INDEX(l.email,'@',-1)) AS domain
        FROM Message m
        JOIN Lead l ON l.id = m.leadId
        WHERE m.workspaceId = ${s.wid}
          AND m.sentAt IS NOT NULL
          AND m.sentAt >= ${rangeStart}
          AND m.sentAt <= ${rangeEnd}
          AND l.email IS NOT NULL
          AND l.email <> ''
          AND l.email LIKE '%@%'
      ) s
      LEFT JOIN (
        SELECT DISTINCT e.messageId
        FROM Event e
        WHERE e.type IN ('bounce','bounce_hard','bounce_soft')
          AND e.createdAt >= ${rangeStart}
          AND e.createdAt <= ${rangeEnd}
      ) b ON b.messageId = s.messageId
      LEFT JOIN (
        SELECT DISTINCT e.messageId
        FROM Event e
        WHERE e.type IN ('unsubscribe','unsub')
          AND e.createdAt >= ${rangeStart}
          AND e.createdAt <= ${rangeEnd}
      ) u ON u.messageId = s.messageId
      GROUP BY s.domain
      ORDER BY sent DESC
      LIMIT 8
    `,
  ]);

  // Support legacy "unsub" events too.
  const unsubLegacyRange = await prisma.event.count({
    where: { type: "unsub", createdAt: { gte: rangeStart, lte: rangeEnd }, message: { workspaceId: s.wid } },
  });
  const unsubTotalRange = unsubRange + unsubLegacyRange;

  const domainsTotal = Array.isArray(domains) ? domains.length : 0;

  // -------------------------------
  // Command center derived values
  // -------------------------------
  // Today pacing
  const capacityToday = toNumber((mailboxDailyAgg as any)?._sum?.dailyLimit ?? 0);
  const remainingToday = Math.max(0, capacityToday - sentToday);
  const dayProgress = clamp((now.getTime() - todayStart.getTime()) / (24 * 60 * 60 * 1000), 0, 1);
  const expectedByNow = Math.round(capacityToday * dayProgress);

  let paceTone: "success" | "warning" | "info" = "success";
  let paceText = "On pace";
  if (capacityToday >= 20) {
    if (sentToday < expectedByNow * 0.85) {
      paceTone = "warning";
      paceText = "Behind";
    } else if (sentToday > expectedByNow * 1.15) {
      paceTone = "info";
      paceText = "Ahead";
    }
  }

  // Replies snapshot (threads are leads with at least 1 reply)
  const ra = Array.isArray(replyThreadsAgg) && replyThreadsAgg[0] ? (replyThreadsAgg[0] as any) : {};
  const replyThreadsTotal = toNumber(ra.totalThreads);
  const replyUnreadThreads = toNumber(ra.unreadThreads);
  const replyDueThreads = toNumber(ra.dueThreads);
  const replyMineThreads = toNumber(ra.mineThreads);
  const replyOpenThreads = toNumber(ra.openThreads);
  const replyFollowUpThreads = toNumber(ra.followUpThreads);

  // Warmup placement (last 7d)
  let warmInbox = 0;
  let warmSpam = 0;
  let warmUnknown = 0;
  for (const r of (warmupPlacement7d as any[])) {
    const c = toNumber((r as any)?._count?._all);
    if ((r as any).placement === "inbox") warmInbox += c;
    else if ((r as any).placement === "spam") warmSpam += c;
    else warmUnknown += c;
  }
  const warmTotal = warmInbox + warmSpam + warmUnknown;
  const warmInboxRate = warmTotal ? warmInbox / warmTotal : 0;
  const warmSpamRate = warmTotal ? warmSpam / warmTotal : 0;

  // DNS summary (latest check per domain)
  const domainIds = new Set((domains as any[]).map((d) => d.id));
  const pendingDomains = new Set<string>();
  const latestResultByDomain = new Map<string, any>();

  for (const j of (domainDnsJobs as any[])) {
    const p = safeJsonParse((j as any).payload);
    if (!p) continue;
    if (String(p.workspaceId || "") !== String(s.wid)) continue;
    const did = String(p.domainId || "");
    if (!did || !domainIds.has(did)) continue;

    if ((j as any).status === "queued" || (j as any).status === "running") pendingDomains.add(did);
    if (!latestResultByDomain.has(did) && ((j as any).status === "done" || (j as any).status === "failed")) {
      latestResultByDomain.set(did, safeJsonParse((j as any).lastError));
    }
  }

  let dnsHealthy = 0;
  let dnsWarn = 0;
  let dnsFail = 0;
  let dnsNotChecked = 0;

  for (const d of domains as any[]) {
    const did = d.id;
    const r = latestResultByDomain.get(did);
    if (!r) {
      if (!pendingDomains.has(did)) dnsNotChecked += 1;
      continue;
    }
    const st = String(r?.summary?.status || "unknown");
    if (st === "healthy") dnsHealthy += 1;
    else if (st === "warning") dnsWarn += 1;
    else if (st === "fail") dnsFail += 1;
    else dnsWarn += 1;
  }
  const dnsPending = pendingDomains.size;

  // Top broken domains (fail/warning/not-checked), for quick access
  const domainHealth = (domains as any[]).map((d) => {
    const did = String(d.id);
    const r = latestResultByDomain.get(did);
    const pending = pendingDomains.has(did);
    const status = pending
      ? "pending"
      : String(r?.summary?.status || (r ? "unknown" : "not_checked"));
    const score = toNumber(r?.summary?.score);
    const issues = Array.isArray(r?.summary?.issues) ? (r.summary.issues as string[]) : [];
    return { id: did, name: String(d.name || ""), status, pending, score, issues };
  });

  const domainWeight = (st: string) => {
    if (st === "fail") return 0;
    if (st === "warning") return 1;
    if (st === "unknown") return 2;
    if (st === "not_checked") return 3;
    if (st === "pending") return 4;
    return 5;
  };

  const brokenDomainsTop = domainHealth
    .filter((x) => x.status !== "healthy")
    .sort((a, b) => {
      const wa = domainWeight(a.status);
      const wb = domainWeight(b.status);
      if (wa !== wb) return wa - wb;
      // lower score = more urgent
      if (Number.isFinite(a.score) && Number.isFinite(b.score) && a.score !== b.score) return a.score - b.score;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 3);

  const dnsTone = (st: string) => {
    if (st === "fail") return "danger" as const;
    if (st === "warning") return "warning" as const;
    if (st === "pending") return "info" as const;
    if (st === "not_checked") return "neutral" as const;
    return "neutral" as const;
  };

  const dnsLabel = (st: string) => {
    if (st === "fail") return "misconfigured";
    if (st === "warning") return "needs work";
    if (st === "pending") return "checking";
    if (st === "not_checked") return "not checked";
    return st;
  };

  // Bounce reasons breakdown
  const bounceByType = new Map<string, number>();
  for (const r of (bounceTypeAgg as any[])) {
    const k = String((r as any)?.bounceType || "unknown");
    bounceByType.set(k, (bounceByType.get(k) || 0) + toNumber((r as any)?.cnt));
  }
  const bounceTotal = [...bounceByType.values()].reduce((a, b) => a + b, 0);

  const bounceTypeOrder = ["blocked", "policy", "hard", "soft", "mailbox_full", "unknown"];
  const bounceBreakdown = bounceTypeOrder
    .map((k) => ({ type: k, count: bounceByType.get(k) || 0 }))
    .filter((x) => x.count > 0);

  // Recipient domain hotspots
  const recipientDomains = (recipientDomainAgg as any[])
    .map((r) => {
      const domain = String((r as any)?.domain || "").trim();
      const sent = toNumber((r as any)?.sent);
      const bounced = toNumber((r as any)?.bounced);
      const unsub = toNumber((r as any)?.unsub);
      return {
        domain,
        sent,
        bounced,
        unsub,
        bounceRate: sent > 0 ? bounced / sent : 0,
        unsubRate: sent > 0 ? unsub / sent : 0,
      };
    })
    .filter((x) => x.domain && x.sent > 0)
    .slice(0, 8);

  // Trend buckets via SQL (fast + accurate)
  const trendRows = (await prisma.$queryRaw`
    SELECT DATE(sentAt) AS day, COUNT(*) AS cnt
    FROM Message
    WHERE workspaceId = ${s.wid}
      AND sentAt IS NOT NULL
      AND sentAt >= ${trendStartDay}
      AND sentAt < ${trendEndExclusive}
    GROUP BY DATE(sentAt)
    ORDER BY day ASC
  `) as Array<{ day: any; cnt: any }>;

  const trendMap = new Map<string, number>();
  for (const r of trendRows) {
    const k = r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10);
    trendMap.set(k, toNumber(r.cnt));
  }

  const days: { key: string; label: string; count: number }[] = [];
  for (let i = 0; i < trendDays; i++) {
    const d = new Date(trendStartDay.getTime() + i * 24 * 60 * 60 * 1000);
    const key = dayKeyUTC(d);
    const label = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "2-digit" }).format(d);
    days.push({ key, label, count: trendMap.get(key) || 0 });
  }

  // Leaderboard aggregates (SQL join for speed)
  const sentByCamp = (await prisma.$queryRaw`
    SELECT campaignId AS campaignId, COUNT(*) AS sent
    FROM Message
    WHERE workspaceId = ${s.wid}
      AND campaignId IS NOT NULL
      AND sentAt IS NOT NULL
      AND sentAt >= ${rangeStart}
      AND sentAt <= ${rangeEnd}
    GROUP BY campaignId
  `) as Array<{ campaignId: string; sent: any }>;

  const eventsByCamp = (await prisma.$queryRaw`
    -- NOTE: unique-by-message counts to keep rates sane (no >100% open rate)
    SELECT m.campaignId AS campaignId, e.type AS type, COUNT(DISTINCT e.messageId) AS cnt
    FROM Event e
    JOIN Message m ON m.id = e.messageId
    WHERE m.workspaceId = ${s.wid}
      AND m.campaignId IS NOT NULL
      AND e.createdAt >= ${rangeStart}
      AND e.createdAt <= ${rangeEnd}
      AND e.type IN ('open','reply','bounce','unsubscribe','unsub')
    GROUP BY m.campaignId, e.type
  `) as Array<{ campaignId: string; type: string; cnt: any }>;

  const campIds = sentByCamp.map((r) => r.campaignId).filter(Boolean);
  const campMeta = await prisma.campaign.findMany({
    where: { id: { in: campIds }, workspaceId: s.wid, archivedAt: null },
    select: { id: true, name: true, status: true },
  });
  const campName = new Map(campMeta.map((c) => [c.id, c] as const));

  const campAgg = new Map<
    string,
    { sent: number; open: number; reply: number; bounce: number; unsub: number; name: string; status: string }
  >();

  for (const r of sentByCamp) {
    const id = r.campaignId;
    const meta = campName.get(id);
    if (!meta) continue;
    campAgg.set(id, { sent: toNumber(r.sent), open: 0, reply: 0, bounce: 0, unsub: 0, name: meta.name, status: meta.status });
  }

  for (const r of eventsByCamp) {
    const id = r.campaignId;
    const row = campAgg.get(id);
    if (!row) continue;
    const cnt = toNumber(r.cnt);
    if (r.type === "open") row.open += cnt;
    if (r.type === "reply") row.reply += cnt;
    if (r.type === "bounce") row.bounce += cnt;
    if (r.type === "unsubscribe" || r.type === "unsub") row.unsub += cnt;
  }

  const leaderboard = [...campAgg.entries()]
    .map(([id, a]) => {
      const openRate = a.sent > 0 ? a.open / a.sent : 0;
      const replyRate = a.sent > 0 ? a.reply / a.sent : 0;
      const bounceRate = a.sent > 0 ? a.bounce / a.sent : 0;
      const unsubRate = a.sent > 0 ? a.unsub / a.sent : 0;
      return { id, ...a, openRate, replyRate, bounceRate, unsubRate };
    })
    .sort((x, y) => y.replyRate - x.replyRate);

  const topCampaigns = leaderboard.filter((x) => x.sent >= 10).slice(0, 5);
  const watchlist = [...leaderboard]
    .filter((x) => x.sent >= 10)
    .sort((a, b) => (b.bounceRate + b.unsubRate) - (a.bounceRate + a.unsubRate))
    .slice(0, 5);

  const openRate = sentRange > 0 ? openRange / sentRange : 0;
  const replyRate = sentRange > 0 ? replyRange / sentRange : 0;
  const bounceRate = sentRange > 0 ? bounceRange / sentRange : 0;
  const unsubRate = sentRange > 0 ? unsubTotalRange / sentRange : 0;

  let healthTone: "success" | "warning" | "danger" = "success";
  let healthText = "Healthy";
  if (sentRange >= 20 && (bounceRate >= 0.08 || unsubRate >= 0.02)) {
    healthTone = "danger";
    healthText = "At risk";
  } else if (sentRange >= 20 && (bounceRate >= 0.05 || unsubRate >= 0.015)) {
    healthTone = "warning";
    healthText = "Watch";
  }

  const toneForStatus = (st: string) => {
    if (st === "running") return "success" as const;
    if (st === "paused") return "warning" as const;
    if (st === "stopped") return "danger" as const;
    return "neutral" as const;
  };

  // Checklist (simple + actionable)
  const checklist = [
    { done: domainsTotal > 0, label: "Add a sending domain", href: "/app/domains" },
    { done: mailboxesActive > 0, label: "Connect at least 1 mailbox", href: "/app/mailboxes" },
    { done: warmupEnabled > 0, label: "Enable warmup on a mailbox", href: "/app/mailboxes" },
    { done: leadsTotal > 0, label: "Import leads", href: "/app/leads" },
    { done: campaignsTotal > 0, label: "Create a campaign", href: "/app/campaigns/new" },
    { done: campaignsRunning > 0, label: "Launch your first campaign", href: "/app/campaigns" },
  ];
  const checklistDone = checklist.filter((x) => x.done).length;

  // Notifications center (guardrails + setup risks)
  const notifications: Array<{ tone: "info" | "warning" | "danger" | "success"; title: string; body: string; href?: string }> = [];

  if (mailboxesActive === 0) {
    notifications.push({
      tone: "danger",
      title: "No active mailboxes",
      body: "Connect a mailbox to start sending and to enable reply tracking.",
      href: "/app/mailboxes",
    });
  } else {
    if (mailboxesMissingImap > 0) {
      notifications.push({
        tone: "warning",
        title: "Reply detection not fully configured",
        body: `${mailboxesMissingImap} mailbox(es) are missing IMAP settings. Replies tab may stay empty or incomplete.`,
        href: "/app/mailboxes",
      });
    }
    if (mailboxesSkipVerify > 0) {
      notifications.push({
        tone: "warning",
        title: "IMAP TLS verification is disabled",
        body: `${mailboxesSkipVerify} mailbox(es) have TLS hostname verification turned off. Enable it after fixing certificates.`,
        href: "/app/mailboxes",
      });
    }
  }

  if (draftCampaigns.length > 0) {
    notifications.push({
      tone: "info",
      title: "Finish campaign setup",
      body: `${draftCampaigns.length} draft campaign(s) are not fully configured.`,
      href: "/app/campaigns",
    });
  }

  if (pausedWithReason.length > 0) {
    notifications.push({
      tone: "warning",
      title: "Campaigns paused by guardrails",
      body: `${pausedWithReason.length} campaign(s) were auto-paused due to bounce/unsub thresholds.`,
      href: "/app/campaigns",
    });
  }

  if (activeThrottles.length > 0) {
    notifications.push({
      tone: "warning",
      title: "Mailbox throttling active",
      body: `${activeThrottles.length} sender(s) are temporarily cooling down due to bounce spikes.`,
      href: "/app/campaigns",
    });
  }

  if (notifications.length === 0) {
    notifications.push({
      tone: "success",
      title: "All clear",
      body: "No setup issues detected. Keep an eye on bounce + unsub guardrails as volume ramps.",
    });
  }

  return (
    <Container wide>
      <div className="px-1 md:px-0">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
          <div>
            <div className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard</div>
            <div className="text-sm text-slate-600 mt-0.5">{rangeLabel} · Dates shown in UTC to avoid timezone mismatches</div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <DateRangeControls />
            <Link href="/app/campaigns/new">
              <Button>+ New Campaign</Button>
            </Link>
            <Link href="/app/replies">
              <Button variant="ghost">Open Replies</Button>
            </Link>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card title="Deliverability" subtitle="Guardrails snapshot" right={<Pill tone={healthTone}>{healthText}</Pill>}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-slate-600">Bounce</div>
                <div className="font-semibold text-slate-900">{pct(bounceRate)}</div>
              </div>
              <div>
                <div className="text-slate-600">Unsub</div>
                <div className="font-semibold text-slate-900">{pct(unsubRate)}</div>
              </div>
              <div>
                <div className="text-slate-600">Opens</div>
                <div className="font-semibold text-slate-900">{pct(openRate)}</div>
              </div>
              <div>
                <div className="text-slate-600">Replies</div>
                <div className="font-semibold text-slate-900">{pct(replyRate)}</div>
              </div>
            </div>
          </Card>

          <Card title="Sending" subtitle={`Volume · trend ${trendDays}d`} right={<Sparkline values={days.map((d) => d.count)} />}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-slate-600">Sent</div>
                <div className="text-2xl font-semibold text-slate-900">{sentRange}</div>
              </div>
              <div>
                <div className="text-slate-600">Avg/day</div>
                <div className="text-2xl font-semibold text-slate-900">{Math.round(sentRange / Math.max(1, Math.min(trendDays, 30)))}</div>
              </div>
            </div>
            <div className="mt-2 text-xs text-slate-600">UTC buckets: {days[0]?.label} → {days[days.length - 1]?.label}</div>
          </Card>

          <Card title="Workspace" subtitle="Inventory">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-slate-600">Campaigns</div>
                <div className="text-2xl font-semibold text-slate-900">{campaignsTotal}</div>
                <div className="mt-1 flex gap-2 flex-wrap">
                  <Pill tone="success">Running: {campaignsRunning}</Pill>
                  <Pill tone="warning">Paused: {campaignsPaused}</Pill>
                  <Pill tone="neutral">Draft: {campaignsDraft}</Pill>
                </div>
              </div>
              <div>
                <div className="text-slate-600">Mailboxes</div>
                <div className="text-2xl font-semibold text-slate-900">{mailboxesActive}</div>
                <div className="mt-3">
                  <div className="text-slate-600">Leads</div>
                  <div className="text-2xl font-semibold text-slate-900">{leadsTotal}</div>
                  <div className="text-xs text-slate-600">Active: {leadsActive}</div>
                </div>
              </div>
            </div>
          </Card>

          <Card title="Quick Actions" subtitle="Next best steps">
            <div className="grid gap-2">
              <Link href="/app/mailboxes" className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-2 text-sm">
                ➜ Add / verify mailboxes
              </Link>
              <Link href="/app/leads" className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-2 text-sm">
                ➜ Import leads (CSV wizard)
              </Link>
              <Link href="/app/campaigns/new" className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-2 text-sm">
                ➜ Create campaign (wizard)
              </Link>
              <Link href="/app/analytics" className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-2 text-sm">
                ➜ Analytics & deliverability
              </Link>
            </div>
          </Card>
        </div>

        {/* Command center */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
          <Card title="Today pacing" subtitle="Capacity + remaining" right={<Pill tone={paceTone}>{paceText}</Pill>}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-slate-600">Sent today</div>
                <div className="text-2xl font-semibold text-slate-900">{sentToday}</div>
              </div>
              <div>
                <div className="text-slate-600">Remaining</div>
                <div className="text-2xl font-semibold text-slate-900">{remainingToday}</div>
              </div>
            </div>

            <div className="mt-3 text-xs text-slate-600">
              Capacity: <b>{capacityToday}</b> · Expected by now: <b>{expectedByNow}</b>
            </div>

            <div className="mt-2 h-2 rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-full bg-indigo-600"
                style={{ width: `${Math.round(100 * clamp(capacityToday ? sentToday / capacityToday : 0, 0, 1))}%` }}
              />
            </div>
          </Card>

          <Card
            title="Replies"
            subtitle="Triage snapshot"
            right={<Link href="/app/replies" className="text-sm text-indigo-700 hover:underline">Inbox</Link>}
          >
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-slate-600">Unread</div>
                <div className="text-2xl font-semibold text-slate-900">{replyUnreadThreads}</div>
              </div>
              <div>
                <div className="text-slate-600">Due now</div>
                <div className="text-2xl font-semibold text-slate-900">{replyDueThreads}</div>
              </div>
              <div>
                <div className="text-slate-600">Open</div>
                <div className="font-semibold text-slate-900">{replyOpenThreads}</div>
              </div>
              <div>
                <div className="text-slate-600">Follow-up</div>
                <div className="font-semibold text-slate-900">{replyFollowUpThreads}</div>
              </div>
            </div>
            <div className="mt-2 text-xs text-slate-600">
              Threads: {replyThreadsTotal} · Mine: {replyMineThreads}
            </div>
          </Card>

          <Card
            title="Queue health"
            subtitle="Scheduler + failures"
            right={<Pill tone={failedToday > 0 ? "warning" : "success"}>{failedToday > 0 ? "Watch" : "OK"}</Pill>}
          >
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-slate-600">Queued now</div>
                <div className="text-2xl font-semibold text-slate-900">{queuedNow}</div>
              </div>
              <div>
                <div className="text-slate-600">Due next 60m</div>
                <div className="text-2xl font-semibold text-slate-900">{enrollDueSoon}</div>
              </div>
            </div>
            <div className="mt-2 text-xs text-slate-600">
              Failed today: <b>{failedToday}</b>
            </div>
          </Card>

          <Card
            title="DNS + Warmup"
            subtitle="Deliverability signals"
            right={<Link href="/app/domains" className="text-sm text-indigo-700 hover:underline">Domains</Link>}
          >
            <div className="text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">DNS healthy</span>
                <span className="font-semibold text-slate-900">{dnsHealthy}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Needs work</span>
                <span className="font-semibold text-slate-900">{dnsWarn}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Misconfigured</span>
                <span className="font-semibold text-slate-900">{dnsFail}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Pending / Not checked</span>
                <span className="font-semibold text-slate-900">{dnsPending} / {dnsNotChecked}</span>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-slate-200/70 text-xs text-slate-600">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium text-slate-700">Top domain issues</div>
                <Link href="/app/domains" className="text-indigo-700 hover:underline">View</Link>
              </div>

              {brokenDomainsTop.length === 0 ? (
                <div className="mt-2">No DNS issues detected (or not checked yet).</div>
              ) : (
                <div className="mt-2 grid gap-2">
                  {brokenDomainsTop.map((d) => (
                    <div key={d.id} className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/app/domains/${d.id}`} className="text-slate-900 hover:underline font-medium truncate block">
                          {d.name}
                        </Link>
                        <div className="text-[11px] text-slate-600 truncate max-w-[260px]">
                          {d.issues?.[0] ? String(d.issues[0]) : "Open domain to see details."}
                        </div>
                      </div>
                      <Pill tone={dnsTone(d.status)}>{dnsLabel(d.status)}</Pill>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 pt-3 border-t border-slate-200/70">
                Warmup (7d): Inbox <b>{pct(warmInboxRate)}</b> · Spam <b>{pct(warmSpamRate)}</b>
                <div className="mt-1">
                  <Link href="/app/mailboxes/warmup" className="text-indigo-700 hover:underline">Warmup</Link>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Deliverability insights */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          <Card
            title="Bounce reasons"
            subtitle={rangeLabel}
            right={<Link href="/app/analytics" className="text-sm text-indigo-700 hover:underline">Analytics</Link>}
          >
            {bounceTotal === 0 ? (
              <div className="text-sm text-slate-600">No bounces detected in this range.</div>
            ) : (
              <div className="grid gap-2">
                <div className="text-xs text-slate-600">Total bounced messages: <b>{bounceTotal}</b></div>
                <div className="grid gap-2">
                  {bounceBreakdown.map((x) => {
                    const p = analyticsRangeParams(rangeKey, rangeStart, rangeEnd);
                    p.set("tab", "deliverability");
                    p.set("bounceType", x.type);
                    const href = `/app/analytics?${p.toString()}`;
                    const label =
                      x.type === "blocked"
                        ? "Blocked"
                        : x.type === "policy"
                          ? "Policy"
                          : x.type === "hard"
                            ? "Hard"
                            : x.type === "soft"
                              ? "Soft"
                              : x.type === "mailbox_full"
                                ? "Mailbox full"
                                : "Unknown";
                    return (
                      <Link
                        key={x.type}
                        href={href}
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/60 px-3 py-2 hover:bg-white transition"
                        title="Open analytics drill-down"
                      >
                        <div className="text-sm text-slate-700">{label}</div>
                        <div className="text-sm font-semibold text-slate-900">
                          {x.count} <span className="text-slate-600 font-normal">({pct(x.count / Math.max(1, bounceTotal))})</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>

          <Card
            title="Recipient domains"
            subtitle={`Top domains by sent volume · ${rangeLabel}`}
            right={<Link href="/app/leads" className="text-sm text-indigo-700 hover:underline">Leads</Link>}
          >
            {recipientDomains.length === 0 ? (
              <div className="text-sm text-slate-600">No sent messages with lead emails in this range.</div>
            ) : (
              <div className="grid gap-2">
                {recipientDomains.map((d) => (
                  <Link
                    key={d.domain}
                    href={`/app/leads?prefill=${encodeURIComponent("@" + d.domain)}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/60 px-3 py-2 hover:bg-white transition"
                    title="Open leads filtered by this domain"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{d.domain}</div>
                      <div className="text-xs text-slate-600">
                        Bounce {pct(d.bounceRate)} · Unsub {pct(d.unsubRate)}
                      </div>
                    </div>
                    <Badge>{d.sent} sent</Badge>
                  </Link>
                ))}
                <div className="text-xs text-slate-500">Tip: if a single domain dominates volume, consider per-domain caps to reduce risk.</div>
              </div>
            )}
          </Card>
        </div>

        {/* Leaderboard + checklist + notifications */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
          <Card
            title="Top campaigns"
            subtitle="Sorted by reply rate"
            right={<Link href="/app/campaigns" className="text-sm text-indigo-700 hover:underline">Campaigns</Link>}
            className="lg:col-span-2"
          >
            {topCampaigns.length === 0 ? (
              <div className="text-sm text-slate-600">No campaigns have sent enough emails in this range yet.</div>
            ) : (
              <div className="grid gap-2">
                {topCampaigns.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/app/campaigns/${c.id}`} className="font-medium text-slate-900 hover:underline truncate max-w-[520px]">
                          {c.name}
                        </Link>
                        <Pill tone={toneForStatus(c.status)}>{c.status}</Pill>
                        <Badge>{c.sent} sent</Badge>
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5">
                        Replies {pct(c.replyRate)} · Opens {pct(c.openRate)} · Bounce {pct(c.bounceRate)} · Unsub {pct(c.unsubRate)}
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-slate-900 shrink-0">{pct(c.replyRate)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Setup checklist" subtitle={`${checklistDone}/${checklist.length} completed`}>
            <div className="grid gap-2">
              {checklist.map((t) => (
                <Link
                  key={t.label}
                  href={t.href}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm ${t.done ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-5 w-5 rounded-full grid place-items-center text-xs ${t.done ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700"}`}>
                      {t.done ? "✓" : "•"}
                    </span>
                    <span className="text-slate-900">{t.label}</span>
                  </div>
                  <span className="text-slate-600">→</span>
                </Link>
              ))}
            </div>
          </Card>

          <Card title="Needs attention" subtitle="Highest bounce + unsub" className="lg:col-span-2">
            {watchlist.length === 0 ? (
              <div className="text-sm text-slate-600">Nothing stands out yet. As volume grows, this list will highlight risk.</div>
            ) : (
              <div className="grid gap-2">
                {watchlist.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/app/campaigns/${c.id}/deliverability`} className="font-medium text-slate-900 hover:underline truncate max-w-[520px]">
                          {c.name}
                        </Link>
                        <Pill tone={toneForStatus(c.status)}>{c.status}</Pill>
                        <Badge>{c.sent} sent</Badge>
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5">
                        Bounce {pct(c.bounceRate)} · Unsub {pct(c.unsubRate)} · Replies {pct(c.replyRate)}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Pill tone={c.bounceRate >= 0.08 || c.unsubRate >= 0.02 ? "danger" : "warning"}>
                        {pct(c.bounceRate + c.unsubRate)}
                      </Pill>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Notifications" subtitle="Setup + deliverability alerts">
            <div className="grid gap-2">
              {notifications.map((n, idx) => (
                <div key={idx} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Pill tone={n.tone}>{n.tone}</Pill>
                        <div className="font-medium text-slate-900">{n.title}</div>
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5">{n.body}</div>
                    </div>
                    {n.href ? (
                      <Link href={n.href} className="text-sm text-indigo-700 hover:underline shrink-0">
                        Fix
                      </Link>
                    ) : null}
                  </div>
                </div>
              ))}

              {activeThrottles.length > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-slate-700">
                  <div className="font-medium text-slate-900 mb-1">Active cooldowns</div>
                  <div className="grid gap-1">
                    {activeThrottles.map((t) => (
                      <div key={t.id} className="flex items-center justify-between gap-2">
                        <div className="truncate">{t.mailbox?.fromEmail || "Mailbox"} · {t.campaign?.name || "Campaign"}</div>
                        <div className="shrink-0">until {fmtDateTimeUTC(t.until)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </Card>
        </div>

        {/* Setup reminders (keep the existing high-signal boxes) */}
        {(draftCampaigns.length > 0 || pausedWithReason.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
            {draftCampaigns.length > 0 && (
              <Card title="Finish setup" subtitle="Draft campaigns that need attention">
                <div className="grid gap-2">
                  {draftCampaigns.map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 truncate">{c.name}</div>
                        <div className="text-xs text-slate-600">Step {c.setupStep + 1} · Updated {fmtDateUTC(c.updatedAt)}</div>
                      </div>
                      <Link href={`/app/campaigns/new?resume=${c.id}`} className="text-sm text-indigo-700 hover:underline">
                        Continue
                      </Link>
                    </div>
                  ))}
                </div>
              </Card>
            )}
            {pausedWithReason.length > 0 && (
              <Card title="Paused by guardrails" subtitle="Review and fix before resuming">
                <div className="grid gap-2">
                  {pausedWithReason.map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 truncate">{c.name}</div>
                        <div className="text-xs text-slate-700">Updated {fmtDateUTC(c.updatedAt)}</div>
                      </div>
                      <Link href={`/app/campaigns/${c.id}/settings`} className="text-sm text-slate-900 hover:underline">
                        View
                      </Link>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Bottom: lists */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          <Card
            title="Recent campaigns"
            subtitle="Last updated"
            right={
              <Link href="/app/campaigns" className="text-sm text-indigo-700 hover:underline">
                View all
              </Link>
            }
          >
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="py-2 pr-3">Campaign</th>
                    <th className="py-2 pr-3">Schedule</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {recentCampaigns.map((c) => (
                    <tr key={c.id} className="border-t border-slate-100">
                      <td className="py-2 pr-3">
                        <Link href={`/app/campaigns/${c.id}`} className="font-medium text-slate-900 hover:underline">
                          {c.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-slate-600">
                        {c.sendingWindow} · {c.timezone}
                      </td>
                      <td className="py-2 pr-3">
                        <Pill tone={toneForStatus(c.status)}>{c.status}</Pill>
                      </td>
                      <td className="py-2 text-slate-600">{fmtDateUTC(c.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card
            title="Activity (24h)"
            subtitle="Opens, replies, bounces, and unsubscribes"
            right={
              <Link href="/app/analytics" className="text-sm text-indigo-700 hover:underline">
                Analytics
              </Link>
            }
          >
            <div className="grid gap-2">
              {recentEvents.length === 0 ? (
                <div className="text-sm text-slate-600">No recent events.</div>
              ) : (
                recentEvents.map((e) => {
                  const leadEmail = e.message?.lead?.email || "";
                  const campName = e.message?.campaign?.name || "—";
                  const subj = e.message?.subject || "(no subject)";
                  const box = e.message?.mailbox?.fromEmail || "";
                  const tone = e.type === "reply" ? "success" : e.type === "bounce" ? "danger" : e.type === "unsubscribe" || e.type === "unsub" ? "warning" : "info";
                  return (
                    <div key={e.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Pill tone={tone as any}>{e.type}</Pill>
                          <div className="text-slate-900 truncate max-w-[520px]">
                            <span className="font-medium">{leadEmail || "Lead"}</span>
                            <span className="text-slate-600"> · {campName}</span>
                          </div>
                        </div>
                        <div className="text-xs text-slate-600 truncate mt-0.5">
                          {subj} {box ? `· via ${box}` : ""}
                        </div>
                      </div>
                      <div className="text-xs text-slate-600 shrink-0">{fmtDateTimeUTC(e.createdAt)}</div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>

        <div className="text-xs text-slate-500 mt-4">
          Pro tip: Bookmark filters using URL params (e.g. <code className="px-1 py-0.5 rounded border border-slate-200 bg-white">?range=30d</code>).
        </div>
      </div>
    </Container>
  );
}
