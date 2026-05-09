import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Row = {
  id: string;
  name: string;
  fromEmail: string;
  replyTo: string | null;
  isActive: boolean;
  warmupEnabled: boolean;
  dailyLimit: number;
  localAddress: string | null;
  smtpHost: string;
  smtpPort: number;
  createdAt: Date;
};

function safeJsonParse(v: any) {
  try {
    return JSON.parse(String(v || "{}"));
  } catch {
    return null;
  }
}

type HealthResult = {
  checkedAt?: string;
  smtp?: { ok: boolean; ms?: number; error?: string };
  imap?: { ok: boolean; ms?: number; error?: string; skipped?: boolean };
};

type TestResult = {
  at?: string;
  ok?: boolean;
  to?: string;
  ms?: number;
  error?: string;
  messageId?: string | null;
  messageRowId?: string | null;
};

function isHealthOk(r: HealthResult | null | undefined) {
  if (!r) return false;
  if (r.smtp && r.smtp.ok === false) return false;
  if (r.imap) {
    if ((r.imap as any).skipped) return true;
    if (r.imap.ok === false) return false;
  }
  return true;
}

export async function GET() {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const mailboxes = (await prisma.mailbox.findMany({
    where: { workspaceId: s.wid },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      fromEmail: true,
      replyTo: true,
      isActive: true,
      warmupEnabled: true,
      dailyLimit: true,
      localAddress: true,
      smtpHost: true,
      smtpPort: true,
      createdAt: true,
    },
  })) as Row[];

  const now = new Date();
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sinceToday = new Date(now);
  sinceToday.setUTCHours(0, 0, 0, 0);

  const mailboxIds = mailboxes.map((m) => m.id);
  if (mailboxIds.length === 0) {
    return NextResponse.json({ mailboxes: [] });
  }

  // Healthcheck + test-send (recent jobs). We store structured result JSON in job.lastError.
  // NOTE: Job table has no workspaceId field, so we filter by parsing payload.
  const recentJobs = await prisma.job.findMany({
    where: {
      type: { in: ["mailbox_healthcheck", "mailbox_test_send"] },
      status: { in: ["queued", "running", "done", "failed"] },
    },
    orderBy: { createdAt: "desc" },
    take: 1200,
    select: { id: true, type: true, status: true, payload: true, lastError: true, createdAt: true },
  });

  const healthPending = new Set<string>();
  const testPending = new Set<string>();
  const healthByMailbox = new Map<string, { status: string; createdAt: Date; result: HealthResult | null }>();
  const testByMailbox = new Map<string, { status: string; createdAt: Date; result: TestResult | null }>();
  const healthFailCount24h = new Map<string, number>();

  for (const j of recentJobs as any[]) {
    const p = safeJsonParse(j.payload);
    if (!p) continue;
    if (String(p.workspaceId || "") !== String(s.wid)) continue;
    const mbid = String(p.mailboxId || "");
    if (!mbid) continue;
    if (!mailboxIds.includes(mbid)) continue;

    if (j.type === "mailbox_healthcheck") {
      if (j.status === "queued" || j.status === "running") healthPending.add(mbid);
      if (j.status === "failed" && j.createdAt && j.createdAt >= since24h) {
        healthFailCount24h.set(mbid, (healthFailCount24h.get(mbid) || 0) + 1);
      }
      if (!healthByMailbox.has(mbid) && (j.status === "done" || j.status === "failed")) {
        const r = safeJsonParse(j.lastError);
        healthByMailbox.set(mbid, { status: j.status, createdAt: j.createdAt, result: r });
      }
    }

    if (j.type === "mailbox_test_send") {
      if (j.status === "queued" || j.status === "running") testPending.add(mbid);
      if (!testByMailbox.has(mbid) && (j.status === "done" || j.status === "failed")) {
        const r = safeJsonParse(j.lastError);
        testByMailbox.set(mbid, { status: j.status, createdAt: j.createdAt, result: r });
      }
    }
  }

  // Throttle (cooldowns) per mailbox (across campaigns)
  const throttles = await prisma.mailboxThrottle.findMany({
    where: {
      mailboxId: { in: mailboxIds },
      until: { gt: now },
    },
    select: { mailboxId: true, until: true, reason: true, campaignId: true },
  });

  const cooldownMap = new Map<
    string,
    { until: Date; count: number; reasons: string[]; campaigns: number }
  >();

  for (const t of throttles as any[]) {
    const id = String(t.mailboxId);
    const cur = cooldownMap.get(id);
    const until = t.until as Date;
    const reason = (t.reason || "").toString().trim();
    if (!cur) {
      cooldownMap.set(id, {
        until,
        count: 1,
        reasons: reason ? [reason] : [],
        campaigns: 1,
      });
    } else {
      const minUntil = cur.until && until < cur.until ? until : cur.until;
      const reasons = cur.reasons.slice();
      if (reason && !reasons.includes(reason)) reasons.push(reason);
      cooldownMap.set(id, {
        until: minUntil,
        count: cur.count + 1,
        reasons,
        campaigns: cur.campaigns + 1,
      });
    }
  }

  // sent today (by sentAt)
  const sentToday = await prisma.message.groupBy({
    by: ["mailboxId"],
    where: {
      workspaceId: s.wid,
      mailboxId: { in: mailboxIds },
      sentAt: { gte: sinceToday },
    },
    _count: { _all: true },
  });

  // last sent
  const lastSent = await prisma.message.groupBy({
    by: ["mailboxId"],
    where: {
      workspaceId: s.wid,
      mailboxId: { in: mailboxIds },
      sentAt: { not: null },
    },
    _max: { sentAt: true },
  });

  // last 7d by status (denominator uses all messages with sentAt in window)
  const byStatus7d = await prisma.message.groupBy({
    by: ["mailboxId", "status"],
    where: {
      workspaceId: s.wid,
      mailboxId: { in: mailboxIds },
      sentAt: { gte: since7d },
    },
    _count: { _all: true },
  });

  // last 24h by status
  const byStatus24h = await prisma.message.groupBy({
    by: ["mailboxId", "status"],
    where: {
      workspaceId: s.wid,
      mailboxId: { in: mailboxIds },
      sentAt: { gte: since24h },
    },
    _count: { _all: true },
  });

  const sentTodayMap = new Map<string, number>();
  for (const r of sentToday) sentTodayMap.set(String(r.mailboxId), (r as any)._count?._all || 0);

  const lastSentMap = new Map<string, Date | null>();
  for (const r of lastSent) lastSentMap.set(String(r.mailboxId), (r as any)._max?.sentAt || null);

  const sent7dMap = new Map<string, number>();
  const bounced7dMap = new Map<string, number>();
  const replied7dMap = new Map<string, number>();

  for (const r of byStatus7d as any[]) {
    const id = String(r.mailboxId);
    const c = Number(r._count?._all || 0);
    sent7dMap.set(id, (sent7dMap.get(id) || 0) + c);
    if (String(r.status) === "bounced") bounced7dMap.set(id, (bounced7dMap.get(id) || 0) + c);
    if (String(r.status) === "replied") replied7dMap.set(id, (replied7dMap.get(id) || 0) + c);
  }

  const sent24hMap = new Map<string, number>();
  const bounced24hMap = new Map<string, number>();
  for (const r of byStatus24h as any[]) {
    const id = String(r.mailboxId);
    const c = Number(r._count?._all || 0);
    sent24hMap.set(id, (sent24hMap.get(id) || 0) + c);
    if (String(r.status) === "bounced") bounced24hMap.set(id, (bounced24hMap.get(id) || 0) + c);
  }

  // Compute needs-attention flags (Upgrade C)
  const out = mailboxes.map((m) => {
    const sent7d = sent7dMap.get(m.id) || 0;
    const bounced7d = bounced7dMap.get(m.id) || 0;
    const replied7d = replied7dMap.get(m.id) || 0;
    const bounceRate7d = sent7d > 0 ? bounced7d / sent7d : 0;
    const replyRate7d = sent7d > 0 ? replied7d / sent7d : 0;

    const sent24h = sent24hMap.get(m.id) || 0;
    const bounced24h = bounced24hMap.get(m.id) || 0;
    const bounceRate24h = sent24h > 0 ? bounced24h / sent24h : 0;

    const h = healthByMailbox.get(m.id);
    const t = testByMailbox.get(m.id);
    const cd = cooldownMap.get(m.id);

    const healthOk = isHealthOk(h?.result || null);
    const hf24 = healthFailCount24h.get(m.id) || 0;

    const reasons: string[] = [];

    // Cooldown (throttle)
    if (cd?.until) {
      reasons.push(cd.reasons?.[0] ? `Cooldown: ${cd.reasons[0]}` : "Cooldown active");
    }

    // Bounce spikes
    if (sent24h >= 20 && bounceRate24h >= 0.08) {
      reasons.push(`High bounces (24h)`);
    } else if (sent7d >= 50 && bounceRate7d >= 0.05) {
      reasons.push(`High bounces (7d)`);
    }

    // Health check failures
    if (!healthOk && (h?.status === "failed" || h?.result?.smtp?.ok === false || h?.result?.imap?.ok === false)) {
      reasons.push("Health check failing");
    }
    if (hf24 >= 3) {
      reasons.push(`Health fails: ${hf24}/24h`);
    }

    // Enabled but not sending (often a misconfig)
    if (m.isActive && m.createdAt.getTime() < Date.now() - 48 * 60 * 60 * 1000 && sent7d === 0) {
      reasons.push("No sends in 7d");
    }

    const needsAttention = reasons.length > 0;

    return {
      id: m.id,
      name: m.name,
      fromEmail: m.fromEmail,
      replyTo: m.replyTo,
      isActive: m.isActive,
      warmupEnabled: m.warmupEnabled,
      dailyLimit: m.dailyLimit,
      localAddress: m.localAddress,
      smtpHost: m.smtpHost,
      smtpPort: m.smtpPort,

      sentToday: sentTodayMap.get(m.id) || 0,

      sent7d,
      bounced7d,
      replied7d,
      bounceRate7d,
      replyRate7d,

      sent24h,
      bounced24h,
      bounceRate24h,

      lastSentAt: (lastSentMap.get(m.id) || null)?.toISOString?.() || null,

      cooldown: {
        active: !!cd?.until,
        until: cd?.until ? cd.until.toISOString() : null,
        count: cd?.count || 0,
        reason: cd?.reasons?.[0] || null,
      },

      needsAttention,
      attentionReasons: reasons,
      healthFailCount24h: hf24,

      health: {
        pending: healthPending.has(m.id),
        checkedAt: h?.result?.checkedAt || h?.createdAt?.toISOString?.() || null,
        ok: healthOk,
        smtp: h?.result?.smtp || null,
        imap: h?.result?.imap || null,
      },

      lastTest: {
        pending: testPending.has(m.id),
        at: t?.result?.at || t?.createdAt?.toISOString?.() || null,
        ok: typeof t?.result?.ok === "boolean" ? t?.result?.ok : null,
        to: t?.result?.to || null,
        error: t?.result?.error || null,
        messageId: (t?.result as any)?.messageId || null,
      },

      created: m.createdAt.getTime(),
    };
  });

  return NextResponse.json({ mailboxes: out });
}
