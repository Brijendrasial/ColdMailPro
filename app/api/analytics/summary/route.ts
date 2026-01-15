import { NextResponse } from "next/server";
import dayjs from "dayjs";
import { Prisma } from "@prisma/client";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function andAll(parts: Prisma.Sql[]): Prisma.Sql {
  if (parts.length === 0) return Prisma.sql`1=1`;
  let out = parts[0];
  for (let i = 1; i < parts.length; i++) {
    out = Prisma.sql`${out} AND ${parts[i]}`;
  }
  return out;
}

function buildWhereEM(params: {
  workspaceId: string;
  from: Date;
  toExcl: Date;
  campaignId?: string;
  mailboxId?: string;
  bounceType?: string;
  eAlias?: string;
  mAlias?: string;
}): Prisma.Sql {
  const e = params.eAlias ?? "e";
  const m = params.mAlias ?? "m";

  // NOTE: aliases are constant strings from this file (not user input).
  const parts: Prisma.Sql[] = [
    Prisma.sql`${Prisma.raw(`${m}.workspaceId`)} = ${params.workspaceId}`,
    Prisma.sql`${Prisma.raw(`${e}.createdAt`)} >= ${params.from}`,
    Prisma.sql`${Prisma.raw(`${e}.createdAt`)} < ${params.toExcl}`,
  ];
  if (params.campaignId) parts.push(Prisma.sql`${Prisma.raw(`${m}.campaignId`)} = ${params.campaignId}`);
  if (params.mailboxId) parts.push(Prisma.sql`${Prisma.raw(`${m}.mailboxId`)} = ${params.mailboxId}`);
  if (params.bounceType) {
    if (params.bounceType === "unknown") {
      parts.push(
        Prisma.sql`(${Prisma.raw(`${m}.bounceType`)} IS NULL OR ${Prisma.raw(`${m}.bounceType`)} = '' OR ${Prisma.raw(`${m}.bounceType`)} = 'unknown')`
      );
    } else {
      parts.push(Prisma.sql`${Prisma.raw(`${m}.bounceType`)} = ${params.bounceType}`);
    }
  }
  return Prisma.sql`WHERE ${andAll(parts)}`;
}

function toNum(v: any): number {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  return Number(v ?? 0);
}

function safeRatio(numer: number, denom: number) {
  return denom > 0 ? numer / denom : 0;
}

export async function GET(req: Request) {
  const s = await requireSession();
  const url = new URL(req.url);
  const range = (url.searchParams.get("range") || "7d") as "7d" | "30d" | "90d" | "custom";
  const campaignId = url.searchParams.get("campaignId") || "";
  const mailboxId = url.searchParams.get("mailboxId") || "";
  const bounceTypeRaw = String(url.searchParams.get("bounceType") || "").trim().toLowerCase();
  const bounceType = ["blocked", "policy", "hard", "soft", "mailbox_full", "unknown"].includes(bounceTypeRaw)
    ? bounceTypeRaw
    : "";

  const now = dayjs();
  let from = now.subtract(6, "day").startOf("day");
  let toExcl = now.add(1, "day").startOf("day");

  if (range === "30d") {
    from = now.subtract(29, "day").startOf("day");
  }
  if (range === "90d") {
    from = now.subtract(89, "day").startOf("day");
  }
  if (range === "custom") {
    const f = url.searchParams.get("from");
    const t = url.searchParams.get("to");
    if (f) from = dayjs(f).startOf("day");
    if (t) toExcl = dayjs(t).add(1, "day").startOf("day");
  }

  // Guard: avoid absurd ranges that could DOS the DB
  const days = Math.max(1, Math.min(180, toExcl.diff(from, "day")));

  const fromDate = from.toDate();
  const toExclDate = toExcl.toDate();

  // Common WHERE builder (Event + Message join) with correct aliases
  const whereEM = buildWhereEM({
    workspaceId: s.wid,
    from: fromDate,
    toExcl: toExclDate,
    campaignId: campaignId || undefined,
    mailboxId: mailboxId || undefined,
    bounceType: bounceType || undefined,
    eAlias: "e",
    mAlias: "m",
  });

  // For subqueries that use different aliases
  const whereEM2 = buildWhereEM({ workspaceId: s.wid, from: fromDate, toExcl: toExclDate, campaignId: campaignId || undefined, mailboxId: mailboxId || undefined, bounceType: bounceType || undefined, eAlias: "e2", mAlias: "m2" });
  const whereEM3 = buildWhereEM({ workspaceId: s.wid, from: fromDate, toExcl: toExclDate, campaignId: campaignId || undefined, mailboxId: mailboxId || undefined, bounceType: bounceType || undefined, eAlias: "e3", mAlias: "m3" });
  const whereEM4 = buildWhereEM({ workspaceId: s.wid, from: fromDate, toExcl: toExclDate, campaignId: campaignId || undefined, mailboxId: mailboxId || undefined, bounceType: bounceType || undefined, eAlias: "e4", mAlias: "m4" });
  const whereEM5 = buildWhereEM({ workspaceId: s.wid, from: fromDate, toExcl: toExclDate, campaignId: campaignId || undefined, mailboxId: mailboxId || undefined, bounceType: bounceType || undefined, eAlias: "e5", mAlias: "m5" });

  // Prisma where clause for Event → Message relationship (used by fast counts)
  const messageWhere: any = {
    workspaceId: s.wid,
    ...(campaignId ? { campaignId } : {}),
    ...(mailboxId ? { mailboxId } : {}),
  };
  if (bounceType) {
    if (bounceType === "unknown") {
      messageWhere.OR = [{ bounceType: null }, { bounceType: "" }, { bounceType: "unknown" }];
    } else {
      messageWhere.bounceType = bounceType;
    }
  }

  const [
    sent,
    opens,
    clicks,
    replies,
    bounces,
    unsubscribes,
    leadsAdded,
    enrollments,
    leadsContacted,
    timesRows,
    topCampaignReplies,
    topCampaignSent,
    topMailboxReplies,
    topMailboxSent,
    topMailboxBounces,
    heatReplies,
    heatSent,
    funnelRows,
    recentEvents,
    campaigns,
    mailboxes,
  ] = await Promise.all([
    prisma.event.count({ where: { type: "sent", createdAt: { gte: from.toDate(), lt: toExcl.toDate() }, message: messageWhere } }),
    prisma.event.count({ where: { type: "open", createdAt: { gte: from.toDate(), lt: toExcl.toDate() }, message: messageWhere } }),
    prisma.event.count({ where: { type: "click", createdAt: { gte: from.toDate(), lt: toExcl.toDate() }, message: messageWhere } }),
    prisma.event.count({ where: { type: "reply", createdAt: { gte: from.toDate(), lt: toExcl.toDate() }, message: messageWhere } }),
    prisma.event.count({ where: { type: { in: ["bounce","bounce_hard","bounce_soft"] }, createdAt: { gte: from.toDate(), lt: toExcl.toDate() }, message: messageWhere } }),
    prisma.event.count({ where: { type: "unsubscribe", createdAt: { gte: from.toDate(), lt: toExcl.toDate() }, message: messageWhere } }),

    prisma.lead.count({ where: { workspaceId: s.wid, createdAt: { gte: from.toDate(), lt: toExcl.toDate() } } }),
    prisma.enrollment.count({ where: { campaign: { workspaceId: s.wid }, createdAt: { gte: from.toDate(), lt: toExcl.toDate() }, ...(campaignId ? { campaignId } : {}) } }),

    prisma.$queryRaw<{ c: any }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT m.leadId) as c
      FROM \`Event\` e
      JOIN \`Message\` m ON m.id = e.messageId
      ${whereEM} AND e.type = 'sent' AND m.leadId IS NOT NULL
    `),

    prisma.$queryRaw<{ d: any; type: string; c: any }[]>(Prisma.sql`
      SELECT DATE(e.createdAt) as d, e.type as type, COUNT(*) as c
      FROM \`Event\` e
      JOIN \`Message\` m ON m.id = e.messageId
      ${whereEM}
      GROUP BY DATE(e.createdAt), e.type
      ORDER BY DATE(e.createdAt) ASC
    `),

    prisma.$queryRaw<{ id: string; name: string; c: any }[]>(Prisma.sql`
      SELECT c.id as id, c.name as name, COUNT(*) as c
      FROM \`Event\` e
      JOIN \`Message\` m ON m.id = e.messageId
      JOIN \`Campaign\` c ON c.id = m.campaignId
      ${whereEM} AND e.type = 'reply' AND m.campaignId IS NOT NULL
      GROUP BY c.id, c.name
      ORDER BY c DESC
      LIMIT 12
    `),
    prisma.$queryRaw<{ id: string; c: any }[]>(Prisma.sql`
      SELECT m.campaignId as id, COUNT(*) as c
      FROM \`Event\` e
      JOIN \`Message\` m ON m.id = e.messageId
      ${whereEM} AND e.type = 'sent' AND m.campaignId IS NOT NULL
      GROUP BY m.campaignId
    `),

    prisma.$queryRaw<{ id: string; name: string; fromEmail: string; c: any }[]>(Prisma.sql`
      SELECT mb.id as id, mb.name as name, mb.fromEmail as fromEmail, COUNT(*) as c
      FROM \`Event\` e
      JOIN \`Message\` m ON m.id = e.messageId
      JOIN \`Mailbox\` mb ON mb.id = m.mailboxId
      ${whereEM} AND e.type = 'reply' AND m.mailboxId IS NOT NULL
      GROUP BY mb.id, mb.name, mb.fromEmail
      ORDER BY c DESC
      LIMIT 12
    `),
    prisma.$queryRaw<{ id: string; c: any }[]>(Prisma.sql`
      SELECT m.mailboxId as id, COUNT(*) as c
      FROM \`Event\` e
      JOIN \`Message\` m ON m.id = e.messageId
      ${whereEM} AND e.type = 'sent' AND m.mailboxId IS NOT NULL
      GROUP BY m.mailboxId
    `),
    prisma.$queryRaw<{ id: string; c: any }[]>(Prisma.sql`
      SELECT m.mailboxId as id, COUNT(*) as c
      FROM \`Event\` e
      JOIN \`Message\` m ON m.id = e.messageId
      ${whereEM} AND e.type IN ('bounce','bounce_hard','bounce_soft') AND m.mailboxId IS NOT NULL
      GROUP BY m.mailboxId
    `),

    prisma.$queryRaw<{ dow: any; hr: any; c: any }[]>(Prisma.sql`
      SELECT DAYOFWEEK(e.createdAt) as dow, HOUR(e.createdAt) as hr, COUNT(*) as c
      FROM \`Event\` e
      JOIN \`Message\` m ON m.id = e.messageId
      ${whereEM} AND e.type = 'reply'
      GROUP BY DAYOFWEEK(e.createdAt), HOUR(e.createdAt)
    `),
    prisma.$queryRaw<{ dow: any; hr: any; c: any }[]>(Prisma.sql`
      SELECT DAYOFWEEK(e.createdAt) as dow, HOUR(e.createdAt) as hr, COUNT(*) as c
      FROM \`Event\` e
      JOIN \`Message\` m ON m.id = e.messageId
      ${whereEM} AND e.type = 'sent'
      GROUP BY DAYOFWEEK(e.createdAt), HOUR(e.createdAt)
    `),

    prisma.$queryRaw<{ replied: any; bounced: any; unsub: any; contacted: any }[]>(Prisma.sql`
      SELECT
        (SELECT COUNT(DISTINCT m2.leadId)
         FROM \`Event\` e2 JOIN \`Message\` m2 ON m2.id = e2.messageId
         ${whereEM2} AND e2.type = 'reply' AND m2.leadId IS NOT NULL) as replied,
        (SELECT COUNT(DISTINCT m3.leadId)
         FROM \`Event\` e3 JOIN \`Message\` m3 ON m3.id = e3.messageId
         ${whereEM3} AND e3.type IN ('bounce','bounce_hard','bounce_soft') AND m3.leadId IS NOT NULL) as bounced,
        (SELECT COUNT(DISTINCT m4.leadId)
         FROM \`Event\` e4 JOIN \`Message\` m4 ON m4.id = e4.messageId
         ${whereEM4} AND e4.type = 'unsubscribe' AND m4.leadId IS NOT NULL) as unsub,
        (SELECT COUNT(DISTINCT m5.leadId)
         FROM \`Event\` e5 JOIN \`Message\` m5 ON m5.id = e5.messageId
         ${whereEM5} AND e5.type = 'sent' AND m5.leadId IS NOT NULL) as contacted
    `),

    prisma.event.findMany({
      where: {
        type: { in: ["reply", "bounce", "bounce_hard", "bounce_soft", "unsubscribe"] },
        createdAt: { gte: from.toDate(), lt: toExcl.toDate() },
        message: messageWhere,
      },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: {
        message: {
          select: {
            subject: true,
            campaign: { select: { name: true } },
            mailbox: { select: { fromEmail: true } },
            lead: { select: { email: true } },
          },
        },
      },
    }),

    prisma.campaign.findMany({ where: { workspaceId: s.wid }, select: { id: true, name: true }, orderBy: { updatedAt: "desc" }, take: 200 }),
    prisma.mailbox.findMany({ where: { workspaceId: s.wid }, select: { id: true, name: true, fromEmail: true }, orderBy: { updatedAt: "desc" }, take: 200 }),
  ]);

  // Normalize days list
  const dayList: string[] = [];
  for (let i = 0; i < days; i++) {
    dayList.push(from.add(i, "day").format("YYYY-MM-DD"));
  }

  const empty = () => Array.from({ length: days }, () => 0);
  const seriesMap: Record<string, number[]> = {
    sent: empty(),
    open: empty(),
    click: empty(),
    reply: empty(),
    bounce: empty(),
    unsubscribe: empty(),
  };

  for (const r of timesRows) {
    const d = dayjs(r.d).format("YYYY-MM-DD");
    const idx = dayList.indexOf(d);
    // Fold bounce_hard/bounce_soft into bounce series for UI compatibility
    const t = String((r as any).type || "");
    const key = t === "bounce_hard" || t === "bounce_soft" ? "bounce" : t;
    if (idx >= 0 && seriesMap[key]) {
      seriesMap[key][idx] += toNum(r.c);
    }
  }

  const sentN = sent;
  const openRate = safeRatio(opens, sentN);
  const replyRate = safeRatio(replies, sentN);
  const bounceRate = safeRatio(bounces, sentN);
  const unsubRate = safeRatio(unsubscribes, sentN);

  // Top campaigns merge (replies + sent)
  const sentByCampaign = new Map(topCampaignSent.map((r) => [r.id, toNum(r.c)]));
  const campaignsByReplies = topCampaignReplies.map((r) => ({
    id: r.id,
    name: r.name,
    replies: toNum(r.c),
    sent: sentByCampaign.get(r.id) || 0,
  }));

  // Top mailboxes merge (replies + sent + bounces)
  const sentByMailbox = new Map(topMailboxSent.map((r) => [r.id, toNum(r.c)]));
  const bouncesByMailbox = new Map(topMailboxBounces.map((r) => [r.id, toNum(r.c)]));
  const mailboxesByReplies = topMailboxReplies.map((r) => ({
    id: r.id,
    name: r.name,
    fromEmail: r.fromEmail,
    replies: toNum(r.c),
    sent: sentByMailbox.get(r.id) || 0,
    bounces: bouncesByMailbox.get(r.id) || 0,
  }));

  // Heatmaps: 7 x 24 (Mon..Sun)
  const mkHeat = () => Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const hReplies = mkHeat();
  const hSent = mkHeat();
  const putHeat = (rows: { dow: any; hr: any; c: any }[], target: number[][]) => {
    for (const r of rows) {
      const dow = toNum(r.dow); // 1..7, Sunday=1
      const hr = clampInt(toNum(r.hr), 0, 23);
      const row = (dow + 5) % 7; // Mon=0 ... Sun=6
      target[row][hr] = toNum(r.c);
    }
  };
  putHeat(heatReplies, hReplies);
  putHeat(heatSent, hSent);

  const funnel = {
    leadsAdded,
    enrolled: enrollments,
    contacted: toNum(funnelRows?.[0]?.contacted),
    replied: toNum(funnelRows?.[0]?.replied),
    bounced: toNum(funnelRows?.[0]?.bounced),
    unsubscribed: toNum(funnelRows?.[0]?.unsub),
  };

  const recent = recentEvents.map((e) => ({
    id: e.id,
    type: e.type,
    createdAt: e.createdAt.toISOString(),
    campaignName: e.message.campaign?.name ?? null,
    mailboxFrom: e.message.mailbox?.fromEmail ?? null,
    leadEmail: e.message.lead?.email ?? null,
    subject: e.message.subject ?? null,
  }));

  const insights: { tone: "info" | "success" | "warning" | "danger"; title: string; detail: string }[] = [];

  if (sentN < 20) {
    insights.push({
      tone: "info",
      title: "Low volume",
      detail: "Not enough sends in this range to confidently judge performance. Run more volume or expand the date range.",
    });
  }

  if (bounceRate >= 0.06) {
    insights.push({
      tone: "danger",
      title: "High bounce rate",
      detail: `Bounce rate is ${(bounceRate * 100).toFixed(1)}%. Consider reducing daily limits, warming up, and cleaning leads.`,
    });
  } else if (bounceRate >= 0.03) {
    insights.push({
      tone: "warning",
      title: "Bounces trending up",
      detail: `Bounce rate is ${(bounceRate * 100).toFixed(1)}%. Review mailbox/domain health and lead quality.`,
    });
  }

  if (replyRate >= 0.05) {
    insights.push({
      tone: "success",
      title: "Strong reply rate",
      detail: `Reply rate is ${(replyRate * 100).toFixed(1)}%. Keep scaling gradually while watching bounces.`,
    });
  } else if (replyRate > 0 && replyRate < 0.015 && sentN >= 50) {
    insights.push({
      tone: "info",
      title: "Replies are low",
      detail: "Try improving the first-touch subject/body, tighten targeting, and A/B test your copy.",
    });
  }

  if (openRate > 0 && openRate < 0.08 && sentN >= 50) {
    insights.push({
      tone: "warning",
      title: "Low open rate",
      detail: "If tracking is enabled, low opens can mean inbox placement issues. Check bounces, reduce volume, and warm up domains.",
    });
  }

  if (mailboxesByReplies.length) {
    const best = mailboxesByReplies[0];
    const bestRate = safeRatio(best.replies, best.sent);
    insights.push({
      tone: "info",
      title: "Top mailbox",
      detail: `${best.fromEmail} leads with ${(bestRate * 100).toFixed(1)}% reply rate in this range.`,
    });
  }

  const res = {
    range: { from: from.toISOString(), to: toExcl.subtract(1, "millisecond").toISOString(), days },
    filters: { campaigns, mailboxes },
    kpis: {
      sent,
      opens,
      clicks,
      replies,
      bounces,
      unsubscribes,
      leadsAdded,
      leadsContacted: toNum(leadsContacted?.[0]?.c),
      enrollments,
      openRate,
      replyRate,
      bounceRate,
      unsubRate,
    },
    timeseries: {
      days: dayList,
      sent: seriesMap.sent,
      opens: seriesMap.open,
      clicks: seriesMap.click,
      replies: seriesMap.reply,
      bounces: seriesMap.bounce,
      unsubscribes: seriesMap.unsubscribe,
    },
    top: {
      campaignsByReplies,
      mailboxesByReplies,
    },
    heatmap: {
      replies: hReplies,
      sent: hSent,
    },
    funnel,
    recent,
    insights,
  };

  return NextResponse.json(res);
}

function clampInt(n: number, a: number, b: number) {
  if (!isFinite(n)) return a;
  return Math.max(a, Math.min(b, Math.floor(n)));
}
