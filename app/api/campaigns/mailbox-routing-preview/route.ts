import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function clampInt(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function hashString(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

function toIso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

type PreviewRow = {
  mailboxId: string;
  name: string;
  fromEmail: string;
  isActive: boolean;
  dailyLimit: number;
  warmupEnabled: boolean;
  excluded: boolean;
  weight: number;
  throttled: { until: string; reason?: string | null } | null;
  lastSentAt: string | null;
  idleMinutes: number | null;
  idleOk: boolean;
  routingScore: number | null; // lower is better (score strategies)
  eligible: boolean;
  reasons: string[];
};

export async function GET(req: NextRequest) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const campaignId = String(searchParams.get("campaignId") || "").trim();
  if (!campaignId) return NextResponse.json({ error: "MISSING_CAMPAIGN_ID" }, { status: 400 });

  const camp: any = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId: s.wid },
    select: {
      id: true,
      name: true,
      status: true,
      mailboxStrategy: true,
      mailboxMinIdleMinutes: true,
      mailboxPoolId: true,
    },
  });
  if (!camp) return NextResponse.json({ error: "CAMPAIGN_NOT_FOUND" }, { status: 404 });

  // Resolve sender set (mirrors worker pickMailbox priority)
  const selected = await prisma.campaignMailbox
    .findMany({
      where: { campaignId, isActive: true, mailbox: { workspaceId: s.wid, isActive: true } },
      include: { mailbox: true },
      orderBy: { createdAt: "asc" },
    })
    .catch(() => [] as any[]);

  let members: Array<{ mailbox: any; weight: number }> = selected
    .map((x: any) => ({ mailbox: x.mailbox, weight: 1 }))
    .filter((x) => x.mailbox);

  if (members.length === 0 && camp.mailboxPoolId) {
    const pool = await prisma.mailboxPoolMember
      .findMany({
        where: {
          poolId: camp.mailboxPoolId,
          isActive: true,
          mailbox: { workspaceId: s.wid, isActive: true },
        },
        include: { mailbox: true },
        orderBy: { createdAt: "asc" },
      })
      .catch(() => [] as any[]);

    members = pool
      .map((m: any) => ({ mailbox: m.mailbox, weight: Math.max(1, Number(m.weight || 1)) }))
      .filter((x) => x.mailbox);
  }

  if (members.length === 0) {
    const all = await prisma.mailbox.findMany({
      where: { workspaceId: s.wid, isActive: true },
      orderBy: { createdAt: "asc" },
    });
    members = all.map((m: any) => ({ mailbox: m, weight: 1 }));
  }

  const mailboxes = members.map((m) => m.mailbox).filter(Boolean);
  const ids = mailboxes.map((m: any) => String(m.id));

  const excludedSet = new Set<string>();
  // Exclusion overrides: CampaignMailbox.isActive=false can exclude a mailbox for this campaign in pool/all modes.
  if (selected.length === 0) {
    const excluded = await prisma.campaignMailbox
      .findMany({
        where: { campaignId, isActive: false, mailbox: { workspaceId: s.wid, isActive: true } },
        select: { mailboxId: true },
      })
      .catch(() => [] as any[]);
    for (const e of excluded as any[]) excludedSet.add(String(e.mailboxId));
  }


  const now = new Date();
  const throttles = await prisma.mailboxThrottle
    .findMany({
      where: { campaignId, mailboxId: { in: ids }, until: { gt: now } },
      select: { mailboxId: true, until: true, reason: true },
      orderBy: { until: "asc" },
    })
    .catch(() => [] as any[]);

  const throttleMap = new Map<string, { until: string; reason?: string | null }>();
  for (const t of throttles as any[]) {
    throttleMap.set(String(t.mailboxId), { until: new Date(t.until).toISOString(), reason: t.reason });
  }

  // Last sent (campaign scope) for explainability
  const last = await prisma.message
    .groupBy({
      by: ["mailboxId"],
      where: { campaignId, mailboxId: { in: ids }, sentAt: { not: null } },
      _max: { sentAt: true },
    })
    .catch(() => [] as any[]);

  const lastMap = new Map<string, number>();
  for (const r of last as any[]) {
    const t = (r._max?.sentAt as Date | null) ? new Date(r._max.sentAt).getTime() : 0;
    lastMap.set(String(r.mailboxId), t);
  }

  const mailboxStrategy = String(camp.mailboxStrategy || "round_robin");
  const idleMin = mailboxStrategy === "score_idle" ? clampInt(Number(camp.mailboxMinIdleMinutes || 0), 0, 60 * 24 * 365) : 0;
  const nowTs = Date.now();
  const idleCutoff = idleMin > 0 ? nowTs - idleMin * 60 * 1000 : 0;

  let routingScoreMap = new Map<string, number>();

  if (mailboxStrategy === "score" || mailboxStrategy === "score_idle") {
    const since7d = new Date(nowTs - 7 * 24 * 60 * 60 * 1000);
    const since24h = new Date(nowTs - 24 * 60 * 60 * 1000);

    const [totals, bounces, fails, replies] = await Promise.all([
      prisma.message
        .groupBy({
          by: ["mailboxId"],
          where: { campaignId, mailboxId: { in: ids }, sentAt: { not: null, gte: since7d } },
          _count: { _all: true },
        })
        .catch(() => [] as any[]),
      prisma.message
        .groupBy({
          by: ["mailboxId"],
          where: { campaignId, mailboxId: { in: ids }, status: "bounced", sentAt: { not: null, gte: since7d } },
          _count: { _all: true },
        })
        .catch(() => [] as any[]),
      prisma.message
        .groupBy({
          by: ["mailboxId"],
          where: { campaignId, mailboxId: { in: ids }, status: "failed", createdAt: { gte: since24h } },
          _count: { _all: true },
        })
        .catch(() => [] as any[]),
      prisma.message
        .groupBy({
          by: ["mailboxId"],
          where: { campaignId, mailboxId: { in: ids }, status: "replied", sentAt: { not: null, gte: since7d } },
          _count: { _all: true },
        })
        .catch(() => [] as any[]),
    ]);

    const totalMap = new Map<string, number>();
    for (const r of totals as any[]) totalMap.set(String(r.mailboxId), Number(r._count?._all || 0));

    const bounceMap = new Map<string, number>();
    for (const r of bounces as any[]) bounceMap.set(String(r.mailboxId), Number(r._count?._all || 0));

    const failMap = new Map<string, number>();
    for (const r of fails as any[]) failMap.set(String(r.mailboxId), Number(r._count?._all || 0));

    const replyMap = new Map<string, number>();
    for (const r of replies as any[]) replyMap.set(String(r.mailboxId), Number(r._count?._all || 0));

    for (const id of ids) {
      const total = totalMap.get(id) || 0;
      const bounced = bounceMap.get(id) || 0;
      const failed = failMap.get(id) || 0;
      const replied = replyMap.get(id) || 0;

      const bounceRate = total > 0 ? bounced / total : 0;
      const score = bounceRate * 1000 + failed * 10 - replied * 0.5 + (total === 0 ? -50 : 0);
      routingScoreMap.set(id, score);
    }
  }

  const rows: PreviewRow[] = mailboxes.map((mb: any) => {
    const id = String(mb.id);
    const thr = throttleMap.get(id) || null;
    const lastSent = lastMap.get(id) || 0;
    const lastSentAt = lastSent ? new Date(lastSent) : null;
    const idleMinutes = lastSent ? Math.round((nowTs - lastSent) / 60000) : null;

    const reasons: string[] = [];
    if (!mb.isActive) reasons.push("Mailbox inactive");
    if (thr) reasons.push(`On cooldown until ${thr.until}`);
    if (excludedSet.has(id)) reasons.push("Excluded from this campaign");

    let idleOk = true;
    if (mailboxStrategy === "score_idle") {
      idleOk = idleMin <= 0 || lastSent === 0 || lastSent <= idleCutoff;
      if (!idleOk) reasons.push(`Idle < ${idleMin}m`);
    }

    const routingScore = routingScoreMap.has(id) ? Number(routingScoreMap.get(id)) : null;

    const excluded = excludedSet.has(id);
    const eligible = !thr && !excluded && mb.isActive && (mailboxStrategy !== "score_idle" ? true : idleOk);
    if (eligible && reasons.length === 0) reasons.push("Eligible");

    const weight = members.find((m) => String(m.mailbox.id) === id)?.weight ?? 1;

    return {
      mailboxId: id,
      name: String(mb.name || ""),
      fromEmail: String(mb.fromEmail || ""),
      isActive: !!mb.isActive,
      dailyLimit: Number(mb.dailyLimit || 0),
      warmupEnabled: !!mb.warmupEnabled,
      excluded,
      weight: Number(weight || 1),
      throttled: thr,
      lastSentAt: toIso(lastSentAt),
      idleMinutes,
      idleOk,
      routingScore: routingScore !== null ? Math.round(routingScore * 100) / 100 : null,
      eligible,
      reasons,
    };
  });

  // Choose a mailbox (deterministically for preview where possible)
  const available = rows.filter((r) => r.isActive && !r.throttled && !r.excluded);
  if (available.length === 0) {
    return NextResponse.json({ ok: true, data: { campaign: camp, strategy: mailboxStrategy, chosenMailboxId: null, note: "All mailboxes are throttled for this campaign.", rows } });
  }

  let chosenMailboxId: string | null = null;
  let note = "";

  if (mailboxStrategy === "score" || mailboxStrategy === "score_idle") {
    const scored = available
      .map((r) => ({
        id: r.mailboxId,
        score: typeof r.routingScore === "number" ? r.routingScore : 0,
        lastSentTs: r.lastSentAt ? new Date(r.lastSentAt).getTime() : 0,
        idleOk: r.idleOk,
      }))
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        if (a.lastSentTs !== b.lastSentTs) return a.lastSentTs - b.lastSentTs;
        return String(a.id).localeCompare(String(b.id));
      });

    const eligible = mailboxStrategy === "score_idle" ? scored.filter((x) => x.idleOk) : scored;
    const pool = eligible.length ? eligible : scored;
    if (mailboxStrategy === "score_idle" && eligible.length === 0) {
      note = "No mailboxes satisfy the idle requirement right now; selecting best overall.";
    }
    chosenMailboxId = pool[0]?.id || null;
  } else if (mailboxStrategy === "least_recent") {
    const pool = [...available].sort((a, b) => {
      const ta = a.lastSentAt ? new Date(a.lastSentAt).getTime() : 0;
      const tb = b.lastSentAt ? new Date(b.lastSentAt).getTime() : 0;
      // 0 (never used) is preferred; else oldest first
      if (ta === 0 && tb !== 0) return -1;
      if (tb === 0 && ta !== 0) return 1;
      if (ta !== tb) return ta - tb;
      return a.mailboxId.localeCompare(b.mailboxId);
    });
    chosenMailboxId = pool[0]?.mailboxId || null;
  } else if (mailboxStrategy === "random" || mailboxStrategy === "weighted") {
    // Preview uses deterministic pseudo-random so the UI is explainable/repeatable.
    const base = Math.floor(nowTs / 60000);
    const seed = (base + hashString(campaignId)) >>> 0;
    const rnd = (seed % 100000) / 100000;

    if (mailboxStrategy === "weighted") {
      const totalW = available.reduce((a, b) => a + Math.max(1, b.weight), 0);
      let r = rnd * Math.max(1, totalW);
      for (const m of available) {
        r -= Math.max(1, m.weight);
        if (r <= 0) {
          chosenMailboxId = m.mailboxId;
          break;
        }
      }
      chosenMailboxId = chosenMailboxId || available[0].mailboxId;
      note = "Weighted routing is random; this is a deterministic preview for this minute.";
    } else {
      const idx = Math.floor(rnd * available.length);
      chosenMailboxId = available[idx]?.mailboxId || available[0].mailboxId;
      note = "Random routing is random; this is a deterministic preview for this minute.";
    }
  } else {
    // round_robin (default): mirrors worker logic (minute + campaign hash)
    const base = Math.floor(nowTs / 60000);
    const h = hashString(campaignId);
    const idx = (base + h) % available.length;
    chosenMailboxId = available[idx]?.mailboxId || available[0].mailboxId;
  }

  return NextResponse.json({
    ok: true,
    data: {
      campaign: {
        id: camp.id,
        name: camp.name,
        status: camp.status,
      },
      strategy: mailboxStrategy,
      mailboxMinIdleMinutes: idleMin,
      chosenMailboxId,
      note,
      rows,
    },
  });
}
