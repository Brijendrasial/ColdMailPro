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

export default async function Dashboard({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const s = await requireSession();

  const now = new Date();
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
    domainsTotal,
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
  ] = await Promise.all([
    prisma.campaign.count({ where: { workspaceId: s.wid, archivedAt: null } }),
    prisma.campaign.count({ where: { workspaceId: s.wid, status: "running", archivedAt: null } }),
    prisma.campaign.count({ where: { workspaceId: s.wid, status: "paused", archivedAt: null } }),
    prisma.campaign.count({ where: { workspaceId: s.wid, status: "draft", archivedAt: null } }),
    prisma.lead.count({ where: { workspaceId: s.wid } }),
    prisma.lead.count({ where: { workspaceId: s.wid, status: "active" } }),
    prisma.domain.count({ where: { workspaceId: s.wid } }),
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
  ]);

  // Support legacy "unsub" events too.
  const unsubLegacyRange = await prisma.event.count({
    where: { type: "unsub", createdAt: { gte: rangeStart, lte: rangeEnd }, message: { workspaceId: s.wid } },
  });
  const unsubTotalRange = unsubRange + unsubLegacyRange;

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
