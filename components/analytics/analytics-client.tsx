"use client";

import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { Badge, Button, Card, EmptyState, Input, Kpi, Pill, Select } from "@/components/ui";
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

function isTabKey(v: string): v is TabKey {
  return ["overview", "campaigns", "mailboxes", "deliverability", "funnel", "heatmap", "events"].includes(v);
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

  const tabs: { key: TabKey; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "campaigns", label: "Campaigns" },
    { key: "mailboxes", label: "Mailboxes" },
    { key: "deliverability", label: "Deliverability" },
    { key: "funnel", label: "Funnel" },
    { key: "heatmap", label: "Heatmap" },
    { key: "events", label: "Events" },
  ];

  const series = useMemo(() => {
    if (!data) return [] as { name: string; values: number[] }[];
    return [
      { name: "Sent", values: data.timeseries.sent },
      { name: "Replies", values: data.timeseries.replies },
      { name: "Bounces", values: data.timeseries.bounces },
    ];
  }, [data]);

  const spark = useMemo(() => {
    if (!data) return { sent: [], replies: [], bounces: [] };
    return {
      sent: data.timeseries.sent,
      replies: data.timeseries.replies,
      bounces: data.timeseries.bounces,
    };
  }, [data]);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="glass p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 flex-1">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Range</div>
              <Select value={range} onChange={(e) => setRange(e.target.value as AnalyticsRangeKey)}>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
                <option value="custom">Custom</option>
              </Select>
            </div>
            <div className={`${range === "custom" ? "" : "opacity-50 pointer-events-none"}`}>
              <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">From</div>
              <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </div>
            <div className={`${range === "custom" ? "" : "opacity-50 pointer-events-none"}`}>
              <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">To</div>
              <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Campaign</div>
              <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                <option value="">All campaigns</option>
                {data?.filters.campaigns?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Bounce type</div>
              <Select value={bounceType} onChange={(e) => setBounceType(e.target.value as BounceTypeKey)}>
                <option value="">All bounce types</option>
                <option value="blocked">Blocked</option>
                <option value="policy">Policy</option>
                <option value="hard">Hard</option>
                <option value="soft">Soft</option>
                <option value="mailbox_full">Mailbox full</option>
                <option value="unknown">Unknown</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 lg:w-[520px]">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Mailbox</div>
              <Select value={mailboxId} onChange={(e) => setMailboxId(e.target.value)}>
                <option value="">All mailboxes</option>
                {data?.filters.mailboxes?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fromEmail}
                  </option>
                ))}
              </Select>
            </div>
            <div className="sm:col-span-2 flex items-end justify-end gap-2">
              <Button variant="ghost" onClick={() => {
                setCampaignId("");
                setMailboxId("");
                setBounceType("");
                setRange("7d");
                setCustomFrom(dayjs().subtract(7, "day").format("YYYY-MM-DD"));
                setCustomTo(dayjs().format("YYYY-MM-DD"));
              }}>
                Reset
              </Button>
              <Button variant="primary" onClick={load} disabled={loading}>
                {loading ? "Refreshing…" : "Refresh"}
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-xl text-sm border transition ${
                tab === t.key
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white/60 text-slate-700 border-slate-200 hover:bg-white"
              }`}
            >
              {t.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 text-xs text-slate-600">
            {data ? (
              <>
                <Badge>
                  {dayjs(data.range.from).format("MMM D")} – {dayjs(data.range.to).format("MMM D")}
                </Badge>
                {campaignId ? <Pill tone="info">Campaign filtered</Pill> : null}
                {mailboxId ? <Pill tone="info">Mailbox filtered</Pill> : null}
                {bounceType ? <Pill tone="warning">Bounce type: {bounceLabel(bounceType)}</Pill> : null}
              </>
            ) : null}
          </div>
        </div>
      </div>

      {err ? (
        <Card title="Analytics failed to load" subtitle={err}>
          <div className="flex gap-2">
            <Button onClick={load}>Retry</Button>
          </div>
        </Card>
      ) : null}

      {!loading && !data ? (
        <EmptyState title="No analytics yet" subtitle="Send a campaign or run warmup. Once events start flowing, this page will populate automatically." />
      ) : null}

      {data ? (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi
              label="Sent"
              value={fmt(data.kpis.sent)}
              hint={
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">trend</span>
                  <span className="text-indigo-600">
                    <Sparkline values={spark.sent} />
                  </span>
                </div>
              }
              tone="info"
            />
            <Kpi
              label="Replies"
              value={fmt(data.kpis.replies)}
              hint={
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">rate {pct(data.kpis.replyRate)}</span>
                  <span className="text-indigo-600">
                    <Sparkline values={spark.replies} />
                  </span>
                </div>
              }
              tone="success"
            />
            <Kpi
              label="Opens"
              value={fmt(data.kpis.opens)}
              hint={`open rate ${pct(data.kpis.openRate)}`}
              tone="neutral"
            />
            <Kpi
              label="Bounces"
              value={fmt(data.kpis.bounces)}
              hint={`bounce rate ${pct(data.kpis.bounceRate)}`}
              tone={data.kpis.bounceRate >= 0.06 ? "danger" : data.kpis.bounceRate >= 0.03 ? "warning" : "neutral"}
            />
          </div>

          {/* Insights */}
          {data.insights?.length ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {data.insights.map((it, idx) => (
                <Card key={idx} title={it.title} subtitle={it.detail}>
                  <Pill tone={it.tone}>{it.tone.toUpperCase()}</Pill>
                </Card>
              ))}
            </div>
          ) : null}

          {/* Tab content */}
          {tab === "overview" ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <Card title="Trends" subtitle="Sent vs Replies vs Bounces">
                <LineAreaChart labels={data.timeseries.days} series={series} legend />
              </Card>
              <Card title="Top campaigns" subtitle="By replies">
                <BarList
                  items={data.top.campaignsByReplies}
                  labelKey="name"
                  valueKey="replies"
                  right={(it) => (
                    <div className="text-xs text-slate-600 tabular-nums">
                      {it.sent ? pct(it.replies / it.sent) : "0%"}
                    </div>
                  )}
                />
              </Card>
              <Card title="Top mailboxes" subtitle="By replies">
                <BarList
                  items={data.top.mailboxesByReplies}
                  labelKey="fromEmail"
                  valueKey="replies"
                  right={(it) => (
                    <div className="text-xs text-slate-600 tabular-nums">{it.sent ? pct(it.replies / it.sent) : "0%"}</div>
                  )}
                />
              </Card>
            </div>
          ) : null}

          {tab === "campaigns" ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <Card title="Campaign leaderboard" subtitle="Replies, sent volume, reply rate">
                <div className="table-wrap">
                  <table className="w-full">
                    <thead className="table-head">
                      <tr>
                        <th className="table-cell text-left">Campaign</th>
                        <th className="table-cell text-right">Sent</th>
                        <th className="table-cell text-right">Replies</th>
                        <th className="table-cell text-right">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.top.campaignsByReplies.map((c) => (
                        <tr key={c.id} className="table-row">
                          <td className="table-cell">
                            <div className="font-medium text-slate-900 truncate">{c.name}</div>
                          </td>
                          <td className="table-cell text-right tabular-nums">{fmt(c.sent)}</td>
                          <td className="table-cell text-right tabular-nums">{fmt(c.replies)}</td>
                          <td className="table-cell text-right tabular-nums">{c.sent ? pct(c.replies / c.sent) : "0%"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 text-xs text-slate-600">Tip: click a campaign in the filter to drill down further.</div>
              </Card>
              <Card title="Trend" subtitle="Your current filters">
                <LineAreaChart labels={data.timeseries.days} series={series} legend />
              </Card>
            </div>
          ) : null}

          {tab === "mailboxes" || tab === "deliverability" ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <Card title={tab === "deliverability" ? "Mailbox health" : "Mailbox leaderboard"} subtitle="Replies, bounces and rate">
                <div className="table-wrap">
                  <table className="w-full">
                    <thead className="table-head">
                      <tr>
                        <th className="table-cell text-left">Mailbox</th>
                        <th className="table-cell text-right">Sent</th>
                        <th className="table-cell text-right">Replies</th>
                        <th className="table-cell text-right">Bounces</th>
                        <th className="table-cell text-right">Bounce%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.top.mailboxesByReplies.map((m) => {
                        const br = m.sent ? m.bounces / m.sent : 0;
                        return (
                          <tr key={m.id} className="table-row">
                            <td className="table-cell">
                              <div className="font-medium text-slate-900 truncate">{m.fromEmail}</div>
                              <div className="text-xs text-slate-600 truncate">{m.name}</div>
                            </td>
                            <td className="table-cell text-right tabular-nums">{fmt(m.sent)}</td>
                            <td className="table-cell text-right tabular-nums">{fmt(m.replies)}</td>
                            <td className="table-cell text-right tabular-nums">{fmt(m.bounces)}</td>
                            <td className="table-cell text-right">
                              <Pill tone={br >= 0.06 ? "danger" : br >= 0.03 ? "warning" : "neutral"}>{pct(br)}</Pill>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 text-xs text-slate-600">
                  Deliverability is estimated from bounce/unsubscribe patterns. (For inbox placement you’ll need external reputation signals.)
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
                />
              </Card>
            </div>
          ) : null}

          {tab === "funnel" ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <Card title="Funnel" subtitle="Lead → enrollment → contacted → replied">
                <FunnelView data={data} />
              </Card>
              <Card title="Key ratios" subtitle="A quick health snapshot">
                <div className="space-y-3">
                  <RowStat label="Reply rate" value={pct(data.kpis.replyRate)} tone={data.kpis.replyRate >= 0.04 ? "success" : "neutral"} />
                  <RowStat label="Open rate" value={pct(data.kpis.openRate)} tone={data.kpis.openRate >= 0.25 ? "success" : "neutral"} />
                  <RowStat
                    label="Bounce rate"
                    value={pct(data.kpis.bounceRate)}
                    tone={data.kpis.bounceRate >= 0.06 ? "danger" : data.kpis.bounceRate >= 0.03 ? "warning" : "neutral"}
                  />
                  <RowStat label="Unsubscribe rate" value={pct(data.kpis.unsubRate)} tone={data.kpis.unsubRate >= 0.01 ? "warning" : "neutral"} />
                </div>
              </Card>
            </div>
          ) : null}

          {tab === "heatmap" ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <Card title="Replies heatmap" subtitle="When replies happen (weekday × hour)">
                <Heatmap
                  matrix={data.heatmap.replies}
                  rowLabels={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]}
                  colLabels={Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"))}
                />
              </Card>
              <Card title="Send volume heatmap" subtitle="When sends happen (weekday × hour)">
                <Heatmap
                  matrix={data.heatmap.sent}
                  rowLabels={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]}
                  colLabels={Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"))}
                />
              </Card>
            </div>
          ) : null}

          {tab === "events" ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <Card title="Recent important events" subtitle="Replies / bounces / unsubscribes">
                <div className="space-y-2">
                  {data.recent.length ? (
                    data.recent.map((ev) => (
                      <div key={ev.id} className="p-3 rounded-2xl border border-slate-200 bg-white/60">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-slate-900">
                            <Pill tone={ev.type === "reply" ? "success" : ev.type === "bounce" ? "danger" : ev.type === "unsubscribe" ? "warning" : "info"}>
                              {ev.type.toUpperCase()}
                            </Pill>
                          </div>
                          <div className="text-xs text-slate-600">{dayjs(ev.createdAt).format("MMM D, HH:mm")}</div>
                        </div>
                        <div className="mt-2 text-sm text-slate-900 truncate">{ev.subject || "(no subject)"}</div>
                        <div className="mt-1 text-xs text-slate-600 truncate">
                          {ev.campaignName ? `Campaign: ${ev.campaignName}` : "Campaign: —"} • {ev.leadEmail ? `Lead: ${ev.leadEmail}` : "Lead: —"}
                        </div>
                        <div className="mt-1 text-xs text-slate-600 truncate">{ev.mailboxFrom ? `Mailbox: ${ev.mailboxFrom}` : "Mailbox: —"}</div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-slate-600">No reply/bounce/unsubscribe events in this range.</div>
                  )}
                </div>
              </Card>
              <Card title="Counts" subtitle="Events captured">
                <div className="flex flex-wrap gap-2">
                  <Badge>Sent: {fmt(data.kpis.sent)}</Badge>
                  <Badge>Opens: {fmt(data.kpis.opens)}</Badge>
                  <Badge>Clicks: {fmt(data.kpis.clicks)}</Badge>
                  <Badge>Replies: {fmt(data.kpis.replies)}</Badge>
                  <Badge>Bounces: {fmt(data.kpis.bounces)}</Badge>
                  <Badge>Unsubs: {fmt(data.kpis.unsubscribes)}</Badge>
                </div>
                <div className="mt-3 text-xs text-slate-600">
                  If opens/clicks are low, ensure tracking is enabled and links are being rewritten.
                </div>
              </Card>
              <Card title="Data freshness" subtitle="Live workers">
                <div className="text-sm text-slate-700">
                  <div className="flex items-center justify-between py-2">
                    <div>Range size</div>
                    <div className="tabular-nums">{data.range.days} days</div>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <div>Leads added</div>
                    <div className="tabular-nums">{fmt(data.kpis.leadsAdded)}</div>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <div>Enrollments</div>
                    <div className="tabular-nums">{fmt(data.kpis.enrollments)}</div>
                  </div>
                  <div className="mt-3">
                    <Button variant="secondary" onClick={() => window.open("/app/logs", "_blank")}>Open Logs</Button>
                  </div>
                </div>
              </Card>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function RowStat({ label, value, tone }: { label: string; value: string; tone: "neutral" | "success" | "warning" | "danger" }) {
  return (
    <div className="flex items-center justify-between p-4 rounded-2xl border border-slate-200 bg-white/60">
      <div className="text-sm text-slate-700">{label}</div>
      <Pill tone={tone === "neutral" ? "neutral" : tone}>{value}</Pill>
    </div>
  );
}

function FunnelView({ data }: { data: AnalyticsSummary }) {
  const steps = [
    { key: "leadsAdded", label: "Leads added", v: data.funnel.leadsAdded },
    { key: "enrolled", label: "Enrolled", v: data.funnel.enrolled },
    { key: "contacted", label: "Contacted", v: data.funnel.contacted },
    { key: "replied", label: "Replied", v: data.funnel.replied },
    { key: "bounced", label: "Bounced", v: data.funnel.bounced },
    { key: "unsubscribed", label: "Unsubscribed", v: data.funnel.unsubscribed },
  ];
  const max = Math.max(1, ...steps.map((s) => s.v));
  return (
    <div className="space-y-3">
      {steps.map((s, idx) => {
        const w = (s.v / max) * 100;
        const drop = idx === 0 ? null : steps[idx - 1].v ? 1 - s.v / steps[idx - 1].v : null;
        return (
          <div key={s.key} className="p-3 rounded-2xl border border-slate-200 bg-white/60">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-slate-900">{s.label}</div>
              <div className="text-sm tabular-nums text-slate-900">{s.v.toLocaleString()}</div>
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden border border-slate-200">
              <div className="h-full bg-indigo-600/70" style={{ width: `${Math.max(2, Math.min(100, w))}%` }} />
            </div>
            {drop !== null ? <div className="mt-1 text-xs text-slate-600">Drop-off: {pct(drop)}</div> : null}
          </div>
        );
      })}
      <div className="text-xs text-slate-600">
        Notes: “Contacted” = distinct leads with at least one <code className="px-1">sent</code> event in range.
      </div>
    </div>
  );
}
