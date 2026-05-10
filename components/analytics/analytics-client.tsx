"use client";

import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { Badge, Button, Card, EmptyState, Input, Pill, Select } from "@/components/ui";
import type { AnalyticsRangeKey, AnalyticsSummary } from "@/components/analytics/types";
import { BarList, Heatmap, LineAreaChart, Sparkline } from "@/components/analytics/charts";

type TabKey = "overview" | "campaigns" | "mailboxes" | "deliverability" | "funnel" | "heatmap" | "events";
type BounceTypeKey = "" | "blocked" | "policy" | "hard" | "soft" | "mailbox_full" | "unknown";

export type AnalyticsInitialParams = {
  tab?: string;
  range?: string;
  from?: string;
  to?: string;
  campaignId?: string;
  mailboxId?: string;
  bounceType?: string;
};

const tabOptions: { key: TabKey; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "✦" },
  { key: "campaigns", label: "Campaigns", icon: "🚀" },
  { key: "mailboxes", label: "Mailboxes", icon: "📬" },
  { key: "deliverability", label: "Deliverability", icon: "🛡️" },
  { key: "funnel", label: "Funnel", icon: "⚡" },
  { key: "heatmap", label: "Heatmap", icon: "▦" },
  { key: "events", label: "Events", icon: "◎" },
];

function isTabKey(v: string): v is TabKey {
  return tabOptions.some((t) => t.key === v);
}

function isRangeKey(v: string): v is AnalyticsRangeKey {
  return ["7d", "30d", "90d", "custom"].includes(v);
}

function isBounceType(v: string): v is BounceTypeKey {
  return ["", "blocked", "policy", "hard", "soft", "mailbox_full", "unknown"].includes(v);
}

function bounceLabel(v: BounceTypeKey) {
  if (v === "blocked") return "Blocked";
  if (v === "policy") return "Policy";
  if (v === "hard") return "Hard";
  if (v === "soft") return "Soft";
  if (v === "mailbox_full") return "Mailbox full";
  if (v === "unknown") return "Unknown";
  return "All";
}

function pct(n: number) {
  if (!isFinite(n)) return "0%";
  return `${Math.round(n * 1000) / 10}%`;
}

function fmt(n: number) {
  return (n ?? 0).toLocaleString();
}

function scoreColor(score: number) {
  if (score >= 80) return "text-emerald-300";
  if (score >= 55) return "text-amber-200";
  return "text-rose-200";
}

function performanceScore(data: AnalyticsSummary | null) {
  if (!data) return 0;
  const reply = Math.min(40, data.kpis.replyRate * 650);
  const open = Math.min(20, data.kpis.openRate * 75);
  const bouncePenalty = Math.min(35, data.kpis.bounceRate * 450);
  const unsubPenalty = Math.min(12, data.kpis.unsubRate * 700);
  const volume = data.kpis.sent >= 50 ? 10 : data.kpis.sent >= 10 ? 6 : data.kpis.sent > 0 ? 3 : 0;
  return Math.max(0, Math.min(100, Math.round(45 + reply + open + volume - bouncePenalty - unsubPenalty)));
}

function rangeLabel(range: AnalyticsRangeKey) {
  if (range === "7d") return "Last 7 days";
  if (range === "30d") return "Last 30 days";
  if (range === "90d") return "Last 90 days";
  return "Custom range";
}

export default function AnalyticsClient({ initial }: { initial?: AnalyticsInitialParams }) {
  const initTab = isTabKey(String(initial?.tab || "")) ? (String(initial?.tab) as TabKey) : "overview";
  const initRange = isRangeKey(String(initial?.range || "")) ? (String(initial?.range) as AnalyticsRangeKey) : "7d";
  const initFrom = String(initial?.from || "").trim();
  const initTo = String(initial?.to || "").trim();
  const initCampaignId = String(initial?.campaignId || "");
  const initMailboxId = String(initial?.mailboxId || "");
  const initBounceType = isBounceType(String(initial?.bounceType || "")) ? (String(initial?.bounceType) as BounceTypeKey) : "";

  const [tab, setTab] = useState<TabKey>(() => initTab);
  const [range, setRange] = useState<AnalyticsRangeKey>(() => initRange);
  const [customFrom, setCustomFrom] = useState<string>(() => (initFrom ? initFrom : dayjs().subtract(7, "day").format("YYYY-MM-DD")));
  const [customTo, setCustomTo] = useState<string>(() => (initTo ? initTo : dayjs().format("YYYY-MM-DD")));
  const [campaignId, setCampaignId] = useState<string>(() => initCampaignId);
  const [mailboxId, setMailboxId] = useState<string>(() => initMailboxId);
  const [bounceType, setBounceType] = useState<BounceTypeKey>(() => initBounceType);

  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set("range", range);
    if (range === "custom") {
      p.set("from", customFrom);
      p.set("to", customTo);
    }
    if (campaignId) p.set("campaignId", campaignId);
    if (mailboxId) p.set("mailboxId", mailboxId);
    if (bounceType) p.set("bounceType", bounceType);
    return p.toString();
  }, [range, customFrom, customTo, campaignId, mailboxId, bounceType]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/analytics/summary?${qs}`, { cache: "no-store" });
      if (!r.ok) throw new Error(await r.text());
      const j = (await r.json()) as AnalyticsSummary;
      setData(j);
    } catch (e: any) {
      setErr(e?.message || "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  const score = performanceScore(data);
  const selectedCampaign = data?.filters.campaigns.find((c) => c.id === campaignId)?.name;
  const selectedMailbox = data?.filters.mailboxes.find((m) => m.id === mailboxId)?.fromEmail;

  const series = useMemo(() => {
    if (!data) return [] as { name: string; values: number[] }[];
    return [
      { name: "Sent", values: data.timeseries.sent },
      { name: "Replies", values: data.timeseries.replies },
      { name: "Bounces", values: data.timeseries.bounces },
    ];
  }, [data]);

  const spark = useMemo(() => {
    if (!data) return { sent: [], replies: [], opens: [], bounces: [] };
    return {
      sent: data.timeseries.sent,
      replies: data.timeseries.replies,
      opens: data.timeseries.opens,
      bounces: data.timeseries.bounces,
    };
  }, [data]);

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)] gap-4">
        <div className="relative overflow-hidden rounded-[2rem] border border-slate-900/10 bg-slate-950 p-6 text-white shadow-[0_24px_70px_rgba(15,23,42,0.14)]">
          <div className="absolute inset-0 bg-[radial-gradient(520px_circle_at_0%_0%,rgba(99,102,241,0.42),transparent_48%),radial-gradient(420px_circle_at_100%_20%,rgba(20,184,166,0.26),transparent_45%)]" />
          <div className="relative">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Performance score</div>
                <div className={`mt-3 text-7xl font-semibold tracking-tight font-display ${scoreColor(score)}`}>{score}</div>
                <div className="mt-1 text-sm text-slate-300">Calculated from reply rate, open rate, bounces, unsubscribes, and volume.</div>
              </div>
              <div className="h-24 w-24 rounded-full border border-white/10 bg-white/5 p-2 shadow-inner">
                <div
                  className="grid h-full w-full place-items-center rounded-full border border-white/10 text-lg font-bold"
                  style={{ background: `conic-gradient(rgb(52 211 153) ${score * 3.6}deg, rgba(255,255,255,0.08) 0deg)` }}
                >
                  <div className="grid h-16 w-16 place-items-center rounded-full bg-slate-950/90">{score}%</div>
                </div>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-2 text-sm">
              <MiniStat label="Reply" value={data ? pct(data.kpis.replyRate) : "—"} />
              <MiniStat label="Bounce" value={data ? pct(data.kpis.bounceRate) : "—"} />
              <MiniStat label="Volume" value={data ? fmt(data.kpis.sent) : "—"} />
            </div>
          </div>
        </div>

        <div className="premium-card p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Insight filters</div>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 font-display">Slice the signal</h2>
              <p className="mt-1 text-sm text-slate-600">Filter by time, campaign, mailbox, and bounce type without losing the dashboard context.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {data ? <Badge>{dayjs(data.range.from).format("MMM D")} – {dayjs(data.range.to).format("MMM D")}</Badge> : null}
              {campaignId ? <Pill tone="info">{selectedCampaign || "Campaign filtered"}</Pill> : null}
              {mailboxId ? <Pill tone="info">{selectedMailbox || "Mailbox filtered"}</Pill> : null}
              {bounceType ? <Pill tone="warning">{bounceLabel(bounceType)}</Pill> : null}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
            <Field label="Range" className="xl:col-span-1">
              <Select value={range} onChange={(e) => setRange(e.target.value as AnalyticsRangeKey)}>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
                <option value="custom">Custom</option>
              </Select>
            </Field>
            <Field label="From" className={range === "custom" ? "" : "opacity-50 pointer-events-none"}>
              <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </Field>
            <Field label="To" className={range === "custom" ? "" : "opacity-50 pointer-events-none"}>
              <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </Field>
            <Field label="Campaign">
              <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                <option value="">All campaigns</option>
                {data?.filters.campaigns?.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Mailbox">
              <Select value={mailboxId} onChange={(e) => setMailboxId(e.target.value)}>
                <option value="">All mailboxes</option>
                {data?.filters.mailboxes?.map((m) => (
                  <option key={m.id} value={m.id}>{m.fromEmail}</option>
                ))}
              </Select>
            </Field>
            <Field label="Bounce type">
              <Select value={bounceType} onChange={(e) => setBounceType(e.target.value as BounceTypeKey)}>
                <option value="">All bounce types</option>
                <option value="blocked">Blocked</option>
                <option value="policy">Policy</option>
                <option value="hard">Hard</option>
                <option value="soft">Soft</option>
                <option value="mailbox_full">Mailbox full</option>
                <option value="unknown">Unknown</option>
              </Select>
            </Field>
          </div>

          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2 rounded-[1.35rem] border border-slate-200/80 bg-white/70 p-1.5 shadow-inner">
              {tabOptions.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`inline-flex items-center gap-2 rounded-2xl px-3.5 py-2 text-sm font-semibold transition ${
                    tab === t.key ? "bg-slate-950 text-white shadow-lg" : "text-slate-600 hover:bg-white hover:text-slate-950"
                  }`}
                >
                  <span>{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setCampaignId("");
                  setMailboxId("");
                  setBounceType("");
                  setRange("7d");
                  setCustomFrom(dayjs().subtract(7, "day").format("YYYY-MM-DD"));
                  setCustomTo(dayjs().format("YYYY-MM-DD"));
                }}
              >
                Reset
              </Button>
              <Button variant="primary" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh data"}</Button>
            </div>
          </div>
        </div>
      </section>

      {err ? (
        <Card title="Analytics failed to load" subtitle={err}>
          <Button onClick={load}>Retry</Button>
        </Card>
      ) : null}

      {!loading && !data ? (
        <EmptyState title="No analytics yet" subtitle="Send a campaign or run warmup. Once events start flowing, this page will populate automatically." />
      ) : null}

      {data ? (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Sent" value={fmt(data.kpis.sent)} sub={`${rangeLabel(range)} volume`} tone="info" spark={spark.sent} />
            <MetricCard label="Replies" value={fmt(data.kpis.replies)} sub={`Reply rate ${pct(data.kpis.replyRate)}`} tone="success" spark={spark.replies} />
            <MetricCard label="Opens" value={fmt(data.kpis.opens)} sub={`Open rate ${pct(data.kpis.openRate)}`} tone="neutral" spark={spark.opens} />
            <MetricCard
              label="Bounces"
              value={fmt(data.kpis.bounces)}
              sub={`Bounce rate ${pct(data.kpis.bounceRate)}`}
              tone={data.kpis.bounceRate >= 0.06 ? "danger" : data.kpis.bounceRate >= 0.03 ? "warning" : "neutral"}
              spark={spark.bounces}
            />
          </section>

          {data.insights?.length ? (
            <section className="grid grid-cols-1 gap-3 xl:grid-cols-3">
              {data.insights.map((it, idx) => (
                <InsightCard key={idx} title={it.title} detail={it.detail} tone={it.tone} />
              ))}
            </section>
          ) : null}

          {tab === "overview" ? (
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.8fr)]">
              <Card title="Performance timeline" subtitle="Sent, replies, and bounces across the selected window" className="min-h-[420px]">
                <LineAreaChart labels={data.timeseries.days} series={series} legend height={260} />
                <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <RatioTile label="Reply rate" value={pct(data.kpis.replyRate)} tone="success" />
                  <RatioTile label="Open rate" value={pct(data.kpis.openRate)} tone="info" />
                  <RatioTile label="Bounce rate" value={pct(data.kpis.bounceRate)} tone={data.kpis.bounceRate >= 0.03 ? "warning" : "neutral"} />
                  <RatioTile label="Unsub rate" value={pct(data.kpis.unsubRate)} tone={data.kpis.unsubRate >= 0.01 ? "warning" : "neutral"} />
                </div>
              </Card>
              <div className="space-y-4">
                <Card title="Top mailboxes" subtitle="By reply count">
                  <BarList
                    items={data.top.mailboxesByReplies}
                    labelKey="fromEmail"
                    valueKey="replies"
                    right={(it) => <div className="text-xs tabular-nums text-slate-600">{it.sent ? pct(it.replies / it.sent) : "0%"}</div>}
                  />
                </Card>
                <Card title="Top campaigns" subtitle="By reply count">
                  <BarList
                    items={data.top.campaignsByReplies}
                    labelKey="name"
                    valueKey="replies"
                    right={(it) => <div className="text-xs tabular-nums text-slate-600">{it.sent ? pct(it.replies / it.sent) : "0%"}</div>}
                  />
                </Card>
              </div>
            </section>
          ) : null}

          {tab === "campaigns" ? (
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
              <Card title="Campaign leaderboard" subtitle="Replies, sent volume, and conversion efficiency">
                <div className="space-y-3">
                  {data.top.campaignsByReplies.length ? data.top.campaignsByReplies.map((c, idx) => (
                    <LeaderboardCard
                      key={c.id}
                      rank={idx + 1}
                      title={c.name}
                      subtitle={`${fmt(c.sent)} sent`}
                      primary={`${fmt(c.replies)} replies`}
                      secondary={c.sent ? pct(c.replies / c.sent) : "0%"}
                    />
                  )) : <EmptyInline text="No campaign performance yet for this range." />}
                </div>
              </Card>
              <Card title="Campaign trend" subtitle="Current filters">
                <LineAreaChart labels={data.timeseries.days} series={series} legend height={260} />
              </Card>
            </section>
          ) : null}

          {tab === "mailboxes" || tab === "deliverability" ? (
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Card title={tab === "deliverability" ? "Mailbox reputation board" : "Mailbox leaderboard"} subtitle="Replies, bounces, and workload balance">
                <div className="grid grid-cols-1 gap-3">
                  {data.top.mailboxesByReplies.length ? data.top.mailboxesByReplies.map((m) => {
                    const br = m.sent ? m.bounces / m.sent : 0;
                    return (
                      <div key={m.id} className="rounded-[1.4rem] border border-slate-200/80 bg-white/76 p-4 shadow-sm">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-950 truncate">{m.fromEmail}</div>
                            <div className="mt-1 text-xs text-slate-500 truncate">{m.name || "Mailbox"}</div>
                          </div>
                          <Pill tone={br >= 0.06 ? "danger" : br >= 0.03 ? "warning" : "success"}>{pct(br)} bounce</Pill>
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                          <RatioTile label="Sent" value={fmt(m.sent)} tone="neutral" compact />
                          <RatioTile label="Replies" value={fmt(m.replies)} tone="success" compact />
                          <RatioTile label="Bounces" value={fmt(m.bounces)} tone={br >= 0.03 ? "warning" : "neutral"} compact />
                        </div>
                      </div>
                    );
                  }) : <EmptyInline text="No mailbox activity in this range." />}
                </div>
              </Card>
              <Card title="Volume & engagement" subtitle="Sent / opens / replies">
                <LineAreaChart
                  labels={data.timeseries.days}
                  series={[
                    { name: "Sent", values: data.timeseries.sent },
                    { name: "Opens", values: data.timeseries.opens },
                    { name: "Replies", values: data.timeseries.replies },
                  ]}
                  legend
                  height={285}
                />
                <p className="mt-4 text-xs leading-5 text-slate-600">
                  Deliverability is estimated from bounce and unsubscribe patterns. External inbox-placement signals can be layered in later.
                </p>
              </Card>
            </section>
          ) : null}

          {tab === "funnel" ? (
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
              <Card title="Conversion funnel" subtitle="Lead → enrollment → contacted → replied">
                <FunnelView data={data} />
              </Card>
              <Card title="Key ratios" subtitle="Quick health snapshot">
                <div className="space-y-3">
                  <RowStat label="Reply rate" value={pct(data.kpis.replyRate)} tone={data.kpis.replyRate >= 0.04 ? "success" : "neutral"} />
                  <RowStat label="Open rate" value={pct(data.kpis.openRate)} tone={data.kpis.openRate >= 0.25 ? "success" : "neutral"} />
                  <RowStat label="Bounce rate" value={pct(data.kpis.bounceRate)} tone={data.kpis.bounceRate >= 0.06 ? "danger" : data.kpis.bounceRate >= 0.03 ? "warning" : "neutral"} />
                  <RowStat label="Unsubscribe rate" value={pct(data.kpis.unsubRate)} tone={data.kpis.unsubRate >= 0.01 ? "warning" : "neutral"} />
                </div>
              </Card>
            </section>
          ) : null}

          {tab === "heatmap" ? (
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card title="Replies heatmap" subtitle="When replies happen by weekday and hour">
                <Heatmap matrix={data.heatmap.replies} rowLabels={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]} colLabels={Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"))} />
              </Card>
              <Card title="Send volume heatmap" subtitle="When sends happen by weekday and hour">
                <Heatmap matrix={data.heatmap.sent} rowLabels={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]} colLabels={Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"))} />
              </Card>
            </section>
          ) : null}

          {tab === "events" ? (
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.1fr)_380px]">
              <Card title="Event stream" subtitle="Replies, bounces, and unsubscribes that matter">
                <div className="space-y-3">
                  {data.recent.length ? data.recent.map((ev) => (
                    <div key={ev.id} className="rounded-[1.35rem] border border-slate-200/80 bg-white/76 p-4 shadow-sm">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <Pill tone={ev.type === "reply" ? "success" : ev.type === "bounce" ? "danger" : ev.type === "unsubscribe" ? "warning" : "info"}>{ev.type.toUpperCase()}</Pill>
                        <div className="text-xs text-slate-500">{dayjs(ev.createdAt).format("MMM D, YYYY HH:mm")}</div>
                      </div>
                      <div className="mt-3 font-medium text-slate-950 truncate">{ev.subject || "(no subject)"}</div>
                      <div className="mt-1 text-xs text-slate-600 truncate">{ev.campaignName ? `Campaign: ${ev.campaignName}` : "Campaign: —"} • {ev.leadEmail ? `Lead: ${ev.leadEmail}` : "Lead: —"}</div>
                      <div className="mt-1 text-xs text-slate-600 truncate">{ev.mailboxFrom ? `Mailbox: ${ev.mailboxFrom}` : "Mailbox: —"}</div>
                    </div>
                  )) : <EmptyInline text="No reply/bounce/unsubscribe events in this range." />}
                </div>
              </Card>
              <div className="space-y-4">
                <Card title="Event counts" subtitle="Captured in this range">
                  <div className="flex flex-wrap gap-2">
                    <Badge>Sent: {fmt(data.kpis.sent)}</Badge>
                    <Badge>Opens: {fmt(data.kpis.opens)}</Badge>
                    <Badge>Clicks: {fmt(data.kpis.clicks)}</Badge>
                    <Badge>Replies: {fmt(data.kpis.replies)}</Badge>
                    <Badge>Bounces: {fmt(data.kpis.bounces)}</Badge>
                    <Badge>Unsubs: {fmt(data.kpis.unsubscribes)}</Badge>
                  </div>
                </Card>
                <Card title="Data freshness" subtitle="Worker-backed event stream">
                  <div className="space-y-3 text-sm text-slate-700">
                    <RowLine label="Range size" value={`${data.range.days} days`} />
                    <RowLine label="Leads added" value={fmt(data.kpis.leadsAdded)} />
                    <RowLine label="Enrollments" value={fmt(data.kpis.enrollments)} />
                    <Button variant="secondary" onClick={() => window.open("/app/logs", "_blank")}>Open Logs</Button>
                  </div>
                </Card>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      {children}
    </label>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur">
      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function MetricCard({ label, value, sub, tone, spark }: { label: string; value: string; sub: string; tone: "neutral" | "info" | "success" | "warning" | "danger"; spark: number[] }) {
  const top = tone === "success" ? "from-emerald-400 to-teal-400" : tone === "warning" ? "from-amber-400 to-orange-500" : tone === "danger" ? "from-rose-500 to-orange-500" : tone === "info" ? "from-indigo-500 to-sky-500" : "from-slate-900 to-slate-500";
  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border border-white/70 bg-white/82 p-5 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${top}`} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</div>
          <div className="mt-2 text-4xl font-semibold tracking-tight text-slate-950 font-display">{value}</div>
          <div className="mt-1 text-sm text-slate-600">{sub}</div>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white/70 p-2 text-indigo-600">
          <Sparkline values={spark} height={30} />
        </div>
      </div>
    </div>
  );
}

function InsightCard({ title, detail, tone }: { title: string; detail: string; tone: "info" | "success" | "warning" | "danger" }) {
  const dot = tone === "success" ? "bg-emerald-500" : tone === "warning" ? "bg-amber-500" : tone === "danger" ? "bg-rose-500" : "bg-indigo-500";
  return (
    <div className="relative overflow-hidden rounded-[1.6rem] border border-white/70 bg-white/82 p-5 shadow-[0_18px_55px_rgba(15,23,42,0.07)] backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <span className={`mt-1 h-2.5 w-2.5 rounded-full ${dot} shadow-[0_0_0_5px_rgba(99,102,241,0.10)]`} />
        <div>
          <div className="text-base font-semibold text-slate-950">{title}</div>
          <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
          <div className="mt-4"><Pill tone={tone}>{tone.toUpperCase()}</Pill></div>
        </div>
      </div>
    </div>
  );
}

function RatioTile({ label, value, tone, compact = false }: { label: string; value: string; tone: "neutral" | "success" | "warning" | "danger" | "info"; compact?: boolean }) {
  return (
    <div className={`rounded-2xl border border-slate-200/80 bg-white/70 ${compact ? "p-3" : "p-4"}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={`${compact ? "mt-1 text-lg" : "mt-2 text-2xl"} font-semibold tracking-tight text-slate-950`}>{value}</div>
      <div className="mt-2"><Pill tone={tone}>{tone === "neutral" ? "steady" : tone}</Pill></div>
    </div>
  );
}

function LeaderboardCard({ rank, title, subtitle, primary, secondary }: { rank: number; title: string; subtitle: string; primary: string; secondary: string }) {
  return (
    <div className="rounded-[1.35rem] border border-slate-200/80 bg-white/76 p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-950 text-sm font-semibold text-white">#{rank}</div>
          <div className="min-w-0">
            <div className="truncate font-semibold text-slate-950">{title}</div>
            <div className="text-xs text-slate-500">{subtitle}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone="success">{primary}</Pill>
          <Pill tone="info">{secondary}</Pill>
        </div>
      </div>
    </div>
  );
}

function RowStat({ label, value, tone }: { label: string; value: string; tone: "neutral" | "success" | "warning" | "danger" }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white/70 p-4">
      <div className="text-sm text-slate-700">{label}</div>
      <Pill tone={tone === "neutral" ? "neutral" : tone}>{value}</Pill>
    </div>
  );
}

function RowLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2 last:border-0">
      <span>{label}</span>
      <span className="font-semibold tabular-nums text-slate-950">{value}</span>
    </div>
  );
}

function EmptyInline({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-6 text-center text-sm text-slate-600">{text}</div>;
}

function FunnelView({ data }: { data: AnalyticsSummary }) {
  const steps = [
    { key: "leadsAdded", label: "Leads added", v: data.funnel.leadsAdded, tone: "info" as const },
    { key: "enrolled", label: "Enrolled", v: data.funnel.enrolled, tone: "info" as const },
    { key: "contacted", label: "Contacted", v: data.funnel.contacted, tone: "success" as const },
    { key: "replied", label: "Replied", v: data.funnel.replied, tone: "success" as const },
    { key: "bounced", label: "Bounced", v: data.funnel.bounced, tone: "warning" as const },
    { key: "unsubscribed", label: "Unsubscribed", v: data.funnel.unsubscribed, tone: "danger" as const },
  ];
  const max = Math.max(1, ...steps.map((s) => s.v));
  return (
    <div className="space-y-3">
      {steps.map((s, idx) => {
        const w = (s.v / max) * 100;
        const drop = idx === 0 ? null : steps[idx - 1].v ? 1 - s.v / steps[idx - 1].v : null;
        return (
          <div key={s.key} className="rounded-[1.35rem] border border-slate-200/80 bg-white/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold text-slate-950">{s.label}</div>
              <Pill tone={s.tone}>{s.v.toLocaleString()}</Pill>
            </div>
            <div className="mt-3 h-3 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
              <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-400" style={{ width: `${Math.max(2, Math.min(100, w))}%` }} />
            </div>
            {drop !== null ? <div className="mt-2 text-xs text-slate-600">Drop-off: {pct(drop)}</div> : null}
          </div>
        );
      })}
      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 text-xs leading-5 text-indigo-900">
        “Contacted” means distinct leads with at least one sent event in the selected range.
      </div>
    </div>
  );
}
