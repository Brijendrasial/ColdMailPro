"use client";

import React, { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input, Pill, Badge, Select, Modal, EmptyState } from "@/components/ui";
import { formatDateInTimeZone, formatDateUTC } from "@/lib/date";
import { toast } from "react-toastify";

type CampaignRow = {
  archivedAt?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  daysOfWeek?: any;
  rampEnabled?: boolean;
  rampStartLimit?: number;
  rampDailyIncrease?: number;
  rampMaxLimit?: number;
  nextRunAt?: string | null;
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
  createdAt: string;
  updatedAt: string;
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

type OpsPausedItem = { id: string; name: string; reason: string };
type OpsSpikeItem = { id: string; name: string; rate24h: number; rate7d: number; sent24h: number };
type OpsDnsItem = { id: string; name: string; domains: string[]; domainIds: string[] };
type OpsSatItem = { id: string; name: string; limit: number; capacity: number };

type OpsSummary = {
  pausedWithReason: OpsPausedItem[];
  bounceSpikes: OpsSpikeItem[];
  unsubSpikes: OpsSpikeItem[];
  dnsIssues: OpsDnsItem[];
  saturation: OpsSatItem[];
  dnsWarnCount: number;
  dnsFailCount: number;
};

function toneForStatus(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "running") return "success";
  if (status === "paused") return "warning";
  if (status === "completed") return "info";
  if (status === "archived" || status === "stopped") return "danger";
  if (status === "draft") return "neutral";
  return "info";
}

function pct(n: number, d: number) {
  if (!d) return "0%";
  const v = Math.round((n / d) * 1000) / 10;
  return `${v}%`;
}

function fmt(n: number) {
  return new Intl.NumberFormat().format(Number(n) || 0);
}

function fmtPct(r: number) {
  const v = Math.round((r || 0) * 1000) / 10;
  return `${v}%`;
}

function healthForCampaign(c: CampaignRow): { label: "Good" | "Watch" | "Risk" | "Draft"; tone: "success" | "warning" | "danger" | "neutral" } {
  if (c.status === "draft" || c.status === "archived") return { label: "Draft", tone: "neutral" };
  const sent = Math.max(0, Number(c.sent) || 0);
  const bounces = Math.max(0, Number(c.bounces) || 0);
  const unsubs = Math.max(0, Number(c.unsubscribes) || 0);
  const failed = Math.max(0, Number(c.failed) || 0);
  const replies = Math.max(0, Number(c.replies) || 0);
  const bounceRate = sent ? bounces / sent : 0;
  const unsubRate = sent ? unsubs / sent : 0;
  const failRate = sent ? failed / sent : 0;
  const replyRate = sent ? replies / sent : 0;
  const lowReplyAfterEnough = sent >= 200 && replyRate < 0.002;
  if (bounceRate >= 0.08 || unsubRate >= 0.008 || failRate >= 0.05) return { label: "Risk", tone: "danger" };
  if (bounceRate >= 0.04 || unsubRate >= 0.004 || lowReplyAfterEnough) return { label: "Watch", tone: "warning" };
  return { label: "Good", tone: "success" };
}

function SparkLine({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-10 items-end gap-1">
      {values.map((v, i) => (
        <span key={i} className="w-1.5 rounded-full bg-gradient-to-t from-indigo-600 to-cyan-400" style={{ height: `${Math.max(16, (v / max) * 40)}px` }} />
      ))}
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <div className="relative h-28 w-28 rounded-full bg-[conic-gradient(from_180deg,#4f46e5_var(--score),#e2e8f0_0)] p-2" style={{ ["--score" as any]: `${clamped}%` }}>
      <div className="grid h-full w-full place-items-center rounded-full bg-white shadow-inner">
        <div className="text-center">
          <div className="font-display text-3xl font-semibold text-slate-950">{clamped}</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">score</div>
        </div>
      </div>
    </div>
  );
}

function MetricTile({ label, value, tone = "slate", hint }: { label: string; value: React.ReactNode; tone?: "slate" | "indigo" | "emerald" | "amber" | "rose" | "cyan"; hint?: React.ReactNode }) {
  const tones: Record<string, string> = {
    slate: "from-slate-900 to-slate-500",
    indigo: "from-indigo-600 to-violet-500",
    emerald: "from-emerald-600 to-teal-500",
    amber: "from-amber-500 to-orange-500",
    rose: "from-rose-600 to-orange-500",
    cyan: "from-cyan-600 to-sky-500",
  };
  return (
    <div className="group relative overflow-hidden rounded-[1.7rem] border border-white/70 bg-white/82 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/60 backdrop-blur-xl">
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${tones[tone] || tones.slate}`} />
      <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-3 font-display text-3xl font-semibold tracking-tight text-slate-950">{value}</div>
      {hint ? <div className="mt-2 text-xs leading-5 text-slate-500">{hint}</div> : null}
    </div>
  );
}

export default function CampaignsTable({ initial, opsSummary }: { initial: CampaignRow[]; opsSummary?: OpsSummary }) {
  const router = useRouter();
  const sp = useSearchParams();
  const params = sp ?? new URLSearchParams();

  const urlStatus = (params.get("status") || "all").toLowerCase();
  const urlHealth = (params.get("health") || "all").toLowerCase();
  const urlSort = (params.get("sort") || "updated").toLowerCase();
  const urlQ = params.get("q") || "";

  const [q, setQ] = useState(urlQ);
  const [status, setStatus] = useState(urlStatus);
  const [health, setHealth] = useState(urlHealth);
  const [sort, setSort] = useState(urlSort);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [qaOpen, setQaOpen] = useState(false);
  const [qaCampaignId, setQaCampaignId] = useState<string | null>(null);
  const [qaReport, setQaReport] = useState<any>(null);
  const [opsTab, setOpsTab] = useState<"bounce" | "unsub" | "dns" | "capacity" | "paused">("bounce");
  const [dnsCheckBusy, setDnsCheckBusy] = useState<Record<string, boolean>>({});

  useEffect(() => setQ(urlQ), [urlQ]);
  useEffect(() => setStatus(urlStatus), [urlStatus]);
  useEffect(() => setHealth(urlHealth), [urlHealth]);
  useEffect(() => setSort(urlSort), [urlSort]);

  const rows = useMemo(() => {
    let r = [...initial];
    const needle = q.trim().toLowerCase();
    if (needle) r = r.filter((x) => x.name.toLowerCase().includes(needle));
    if (status !== "all") r = r.filter((x) => x.status === status);
    if (health !== "all") r = r.filter((x) => healthForCampaign(x).label.toLowerCase() === health);

    const score = (x: CampaignRow) => {
      const statusWeight = x.status === "running" ? 0 : x.status === "paused" ? 1 : x.status === "draft" ? 2 : 3;
      const perf = x.replies * 1000000 + x.opens * 1000 + x.sent;
      return statusWeight * 10_000_000_000 - perf;
    };

    if (sort === "name") r.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "created") r.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    else if (sort === "performance") r.sort((a, b) => score(a) - score(b));
    else r.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return r;
  }, [initial, q, status, health, sort]);

  const stats = useMemo(() => {
    const total = initial.length;
    const running = initial.filter((x) => x.status === "running").length;
    const paused = initial.filter((x) => x.status === "paused").length;
    const draft = initial.filter((x) => x.status === "draft").length;
    const sent = initial.reduce((a, x) => a + (Number(x.sent) || 0), 0);
    const replies = initial.reduce((a, x) => a + (Number(x.replies) || 0), 0);
    const opens = initial.reduce((a, x) => a + (Number(x.opens) || 0), 0);
    const bounces = initial.reduce((a, x) => a + (Number(x.bounces) || 0), 0);
    const leads = initial.reduce((a, x) => a + (Number(x.leadsActive) || 0), 0);
    const good = initial.filter((x) => healthForCampaign(x).label === "Good").length;
    const watch = initial.filter((x) => healthForCampaign(x).label === "Watch").length;
    const risk = initial.filter((x) => healthForCampaign(x).label === "Risk").length;
    const replyRate = sent ? Math.round((replies / sent) * 1000) / 10 : 0;
    const bounceRate = sent ? Math.round((bounces / sent) * 1000) / 10 : 0;
    const healthScore = Math.max(0, Math.min(100, Math.round(100 - bounceRate * 8 - risk * 14 - watch * 6 + replyRate * 3)));
    return { total, running, paused, draft, sent, replies, opens, bounces, leads, good, watch, risk, replyRate, bounceRate, healthScore };
  }, [initial]);

  const selectedIds = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
  const allChecked = rows.length > 0 && rows.every((r) => selected[r.id]);
  const someChecked = rows.some((r) => selected[r.id]) && !allChecked;

  function updateUrl(next: { q?: string; status?: string; health?: string; sort?: string }) {
    const nextParams = new URLSearchParams(params.toString());
    if (typeof next.q === "string") (next.q ? nextParams.set("q", next.q) : nextParams.delete("q"));
    if (typeof next.status === "string") (next.status && next.status !== "all" ? nextParams.set("status", next.status) : nextParams.delete("status"));
    if (typeof next.health === "string") (next.health && next.health !== "all" ? nextParams.set("health", next.health) : nextParams.delete("health"));
    if (typeof next.sort === "string") (next.sort && next.sort !== "updated" ? nextParams.set("sort", next.sort) : nextParams.delete("sort"));
    const qs = nextParams.toString();
    router.replace(qs ? `/app/campaigns?${qs}` : "/app/campaigns");
  }

  async function toggle(id: string, to?: "running" | "paused" | "stopped") {
    const res = await fetch("/api/campaigns/toggleState", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, to }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      if ((j as any)?.error === "VALIDATION_FAILED") {
        setQaCampaignId(id);
        setQaReport((j as any).report || null);
        setQaOpen(true);
        toast.info("Fix the pre-send checks, then start again.");
        return;
      }
      toast.error((j as any)?.error || "Failed to toggle campaign.");
      return;
    }
    toast.success(to ? `Campaign ${to}` : "Campaign updated");
    router.refresh();
  }

  async function duplicateOne(id: string) {
    const res = await fetch("/api/campaigns/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [id], action: "duplicate" }),
    });
    if (!res.ok) return toast.error("Duplicate failed.");
    const j = await res.json().catch(() => ({} as any));
    toast.success("Campaign duplicated");
    const to = Array.isArray(j?.copies) && j.copies[0]?.to ? String(j.copies[0].to) : null;
    if (to) router.push(`/app/campaigns/${to}/settings`);
    else router.refresh();
  }

  async function bulk(action: "pause" | "run" | "stop" | "archive" | "unarchive" | "duplicate") {
    const ids = selectedIds;
    if (!ids.length) return;
    const res = await fetch("/api/campaigns/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids, action }),
    });
    if (!res.ok) return toast.error("Bulk action failed.");
    setSelected({});
    if (action === "duplicate") {
      const j = await res.json().catch(() => ({} as any));
      const n = Array.isArray(j?.copies) ? j.copies.length : ids.length;
      toast.success(`Duplicated ${n} campaign(s)`);
      if (Array.isArray(j?.copies) && j.copies.length === 1 && j.copies[0]?.to) {
        router.push(`/app/campaigns/${j.copies[0].to}/settings`);
        return;
      }
    } else toast.success("Bulk action complete");
    router.refresh();
  }

  async function runDnsCheck(domainIds: string[], key: string) {
    const ids = Array.from(new Set((domainIds || []).map((x) => String(x)).filter(Boolean)));
    if (!ids.length) return toast.info("No domains to check for this campaign.");
    setDnsCheckBusy((m) => ({ ...m, [key]: true }));
    try {
      const res = await fetch("/api/domains/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domainIds: ids }),
      });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok) return toast.error(j?.error || "DNS check enqueue failed");
      toast.success(Number(j?.enqueued || 0) ? `Queued DNS checks for ${j.enqueued} domain(s)` : "DNS checks already running");
      router.refresh();
    } catch (e: any) {
      toast.error(`DNS check failed: ${String(e?.message || e)}`);
    } finally {
      setDnsCheckBusy((m) => {
        const { [key]: _, ...rest } = m;
        return rest;
      });
    }
  }

  const currentOps = useMemo(() => {
    if (!opsSummary) return [] as Array<any>;
    if (opsTab === "bounce") return opsSummary.bounceSpikes || [];
    if (opsTab === "unsub") return opsSummary.unsubSpikes || [];
    if (opsTab === "dns") return opsSummary.dnsIssues || [];
    if (opsTab === "capacity") return opsSummary.saturation || [];
    return opsSummary.pausedWithReason || [];
  }, [opsSummary, opsTab]);

  return (
    <div className="space-y-6">
      {qaOpen ? (
        <Modal
          title="Campaign can’t start"
          onClose={() => setQaOpen(false)}
          wide
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setQaOpen(false)}>Close</Button>
              <Link href={qaCampaignId ? `/app/campaigns/${qaCampaignId}/settings` : "/app/campaigns"}>
                <Button onClick={() => setQaOpen(false)}>Open settings</Button>
              </Link>
            </div>
          }
        >
          <p className="text-sm text-slate-600">Fix the blocking checks below, then start the campaign again.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-3xl border border-rose-100 bg-rose-50/70 p-4">
              <div className="font-semibold text-rose-800">Errors</div>
              {Array.isArray(qaReport?.errors) && qaReport.errors.length ? (
                <ul className="mt-3 grid gap-2 text-sm text-rose-900">
                  {qaReport.errors.map((e: any, idx: number) => <li key={idx}>• {e.message}</li>)}
                </ul>
              ) : <div className="mt-3 text-sm text-rose-700">No blocking errors.</div>}
            </div>
            <div className="rounded-3xl border border-amber-100 bg-amber-50/70 p-4">
              <div className="font-semibold text-amber-800">Warnings</div>
              {Array.isArray(qaReport?.warnings) && qaReport.warnings.length ? (
                <ul className="mt-3 grid gap-2 text-sm text-amber-900">
                  {qaReport.warnings.slice(0, 10).map((w: any, idx: number) => <li key={idx}>• {w.message}</li>)}
                </ul>
              ) : <div className="mt-3 text-sm text-amber-700">No warnings.</div>}
            </div>
          </div>
        </Modal>
      ) : null}

      <section className="relative overflow-hidden rounded-[2.4rem] border border-white/70 bg-slate-950 p-6 text-white shadow-[0_30px_90px_rgba(15,23,42,0.18)] sm:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(900px_circle_at_0%_0%,rgba(99,102,241,0.55),transparent_42%),radial-gradient(800px_circle_at_100%_0%,rgba(20,184,166,0.36),transparent_40%),linear-gradient(135deg,rgba(15,23,42,0.95),rgba(30,41,59,0.9))]" />
        <div className="absolute -right-20 -top-28 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="relative grid gap-6 lg:grid-cols-[1.35fr_0.65fr] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.26em] text-cyan-100">
              <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.9)]" /> Campaign command center
            </div>
            <h1 className="mt-4 max-w-4xl font-display text-4xl font-semibold tracking-tight sm:text-5xl">Launch, monitor, and protect every outbound campaign.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-base">One clean cockpit for drafts, active sends, deliverability alerts, sender capacity, replies, and next-step actions.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/app/campaigns/new"><Button className="border-white/20 bg-white text-slate-950 hover:bg-slate-100">+ New Campaign</Button></Link>
              <Link href="/app/leads"><Button variant="ghost" className="border-white/20 bg-white/10 text-white hover:bg-white/15">Import leads</Button></Link>
              <Link href="/app/replies"><Button variant="ghost" className="border-white/20 bg-white/10 text-white hover:bg-white/15">Open replies</Button></Link>
            </div>
          </div>
          <div className="rounded-[2rem] border border-white/15 bg-white/10 p-5 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-4">
              <ScoreRing score={stats.healthScore} />
              <div className="min-w-0 text-right">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-300">Deliverability posture</div>
                <div className="mt-2 text-2xl font-semibold">{stats.risk ? "Needs attention" : stats.watch ? "Watch closely" : "Healthy"}</div>
                <div className="mt-2 text-sm text-slate-300">{stats.good} healthy · {stats.watch} watch · {stats.risk} risk</div>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-2xl bg-white/10 p-3"><div className="text-2xl font-semibold">{stats.running}</div><div className="text-xs text-slate-300">running</div></div>
              <div className="rounded-2xl bg-white/10 p-3"><div className="text-2xl font-semibold">{stats.draft}</div><div className="text-xs text-slate-300">drafts</div></div>
              <div className="rounded-2xl bg-white/10 p-3"><div className="text-2xl font-semibold">{stats.replyRate}%</div><div className="text-xs text-slate-300">reply rate</div></div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricTile label="Campaigns" value={stats.total} tone="slate" hint={`${stats.running} running, ${stats.paused} paused`} />
        <MetricTile label="Active leads" value={fmt(stats.leads)} tone="indigo" hint="Currently enrolled" />
        <MetricTile label="Sent" value={fmt(stats.sent)} tone="cyan" hint={`${fmt(stats.opens)} opens`} />
        <MetricTile label="Replies" value={fmt(stats.replies)} tone="emerald" hint={`${stats.replyRate}% reply rate`} />
        <MetricTile label="Bounce risk" value={`${stats.bounceRate}%`} tone={stats.bounceRate >= 4 ? "rose" : "emerald"} hint={`${fmt(stats.bounces)} bounces`} />
        <MetricTile label="Drafts" value={stats.draft} tone="amber" hint="Need setup" />
      </section>

      {opsSummary ? (
        <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-white/82 p-5 shadow-[0_22px_70px_rgba(15,23,42,0.07)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold text-slate-950">Ops radar</div>
                <p className="mt-1 text-sm text-slate-500">Fast alerts for bounces, unsubs, DNS, capacity, and paused campaigns.</p>
              </div>
              <div className="hidden sm:block"><SparkLine values={[stats.good + 1, stats.watch + 2, stats.risk + 1, stats.running + 2, stats.replies + 1, stats.sent + 1]} /></div>
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {[
                ["DNS", `${opsSummary.dnsFailCount} fail / ${opsSummary.dnsWarnCount} warn`, opsSummary.dnsFailCount ? "danger" : opsSummary.dnsWarnCount ? "warning" : "success"],
                ["Bounce spikes", opsSummary.bounceSpikes?.length || 0, opsSummary.bounceSpikes?.length ? "danger" : "success"],
                ["Unsub spikes", opsSummary.unsubSpikes?.length || 0, opsSummary.unsubSpikes?.length ? "warning" : "success"],
                ["Capacity risk", opsSummary.saturation?.length || 0, opsSummary.saturation?.length ? "warning" : "success"],
              ].map(([label, value, tone]) => (
                <button key={String(label)} type="button" className="rounded-3xl border border-slate-200/80 bg-white/80 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" onClick={() => setOpsTab(label === "DNS" ? "dns" : label === "Bounce spikes" ? "bounce" : label === "Unsub spikes" ? "unsub" : "capacity")}>
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{label}</div>
                  <div className="mt-2 flex items-center justify-between"><span className="text-2xl font-semibold text-slate-950">{value}</span><Pill tone={tone as any}>{Number(value) || String(value).includes("fail") ? "review" : "clear"}</Pill></div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/70 bg-white/82 p-5 shadow-[0_22px_70px_rgba(15,23,42,0.07)] backdrop-blur-xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div><div className="text-lg font-semibold text-slate-950">Alert queue</div><p className="mt-1 text-sm text-slate-500">Click a tab, then jump straight into the campaign fix.</p></div>
              <div className="flex flex-wrap gap-2">
                {(["bounce", "unsub", "dns", "capacity", "paused"] as const).map((t) => <button key={t} onClick={() => setOpsTab(t)} className={`rounded-2xl px-3 py-2 text-xs font-semibold transition ${opsTab === t ? "bg-slate-950 text-white shadow-md" : "border border-slate-200 bg-white/80 text-slate-600 hover:bg-white"}`}>{t}</button>)}
              </div>
            </div>
            <div className="mt-4 grid max-h-[260px] gap-2 overflow-auto pr-1">
              {currentOps.length ? currentOps.slice(0, 7).map((item: any) => (
                <div key={`${opsTab}-${item.id}-${item.name}`} className="flex items-center justify-between gap-3 rounded-3xl border border-slate-200/80 bg-white/80 p-3 shadow-sm">
                  <div className="min-w-0">
                    <Link href={`/app/campaigns/${item.id}/${opsTab === "dns" ? "deliverability" : ""}`} className="block truncate font-semibold text-slate-900 hover:underline">{item.name}</Link>
                    <div className="mt-1 truncate text-xs text-slate-500">
                      {opsTab === "dns" ? `Domains: ${item.domains?.join(", ")}` : opsTab === "capacity" ? `Limit ${fmt(item.limit)} / capacity ${fmt(item.capacity)}` : opsTab === "paused" ? item.reason : `24h ${fmtPct(item.rate24h)} · baseline ${fmtPct(item.rate7d)}`}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {opsTab === "dns" ? <Button variant="ghost" className="px-3 py-2 text-xs" disabled={!!dnsCheckBusy[item.id]} onClick={() => runDnsCheck(item.domainIds || [], item.id)}>{dnsCheckBusy[item.id] ? "Checking…" : "Check"}</Button> : null}
                    <Link href={`/app/campaigns/${item.id}/${opsTab === "dns" ? "deliverability" : "analytics"}`}><Button variant="ghost" className="px-3 py-2 text-xs">Open</Button></Link>
                  </div>
                </div>
              )) : <EmptyState title="All clear" subtitle="No alerts in this category right now." />}
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-[2rem] border border-white/70 bg-white/82 p-4 shadow-[0_22px_70px_rgba(15,23,42,0.07)] backdrop-blur-xl">
        <div className="grid gap-3 xl:grid-cols-[minmax(280px,1fr)_auto] xl:items-center">
          <div className="flex min-w-0 gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by campaign name…" onKeyDown={(e) => { if (e.key === "Enter") updateUrl({ q }); }} />
            <Button variant="ghost" className="shrink-0" onClick={() => updateUrl({ q })}>Search</Button>
            {urlQ ? <Button variant="ghost" className="shrink-0" onClick={() => { setQ(""); updateUrl({ q: "" }); }}>Clear</Button> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              ["all", "All"], ["running", "Running"], ["paused", "Paused"], ["draft", "Draft"], ["completed", "Completed"], ["stopped", "Stopped"], ["archived", "Archived"],
            ].map(([value, label]) => <button key={value} onClick={() => { setStatus(value); updateUrl({ status: value }); }} className={`rounded-2xl px-3 py-2 text-sm font-semibold transition ${status === value ? "bg-slate-950 text-white shadow-md" : "border border-slate-200 bg-white/80 text-slate-600 hover:bg-white"}`}>{label}</button>)}
            <Select className="w-[150px]" value={health} onChange={(e) => { setHealth(e.target.value); updateUrl({ health: e.target.value }); }}>
              <option value="all">All health</option><option value="good">Good</option><option value="watch">Watch</option><option value="risk">Risk</option><option value="draft">Draft</option>
            </Select>
            <Select className="w-[190px]" value={sort} onChange={(e) => { setSort(e.target.value); updateUrl({ sort: e.target.value }); }}>
              <option value="updated">Recently updated</option><option value="created">Recently created</option><option value="name">Name</option><option value="performance">Performance</option>
            </Select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 pt-4">
          <div className="text-sm text-slate-500"><span className="font-semibold text-slate-900">{rows.length}</span> visible · <span className="font-semibold text-slate-900">{selectedIds.length}</span> selected</div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" disabled={!selectedIds.length} onClick={() => bulk("pause")}>Pause</Button>
            <Button variant="ghost" disabled={!selectedIds.length} onClick={() => bulk("run")}>Run</Button>
            <Button variant="ghost" disabled={!selectedIds.length} onClick={() => bulk("stop")}>Stop</Button>
            <Button variant="ghost" disabled={!selectedIds.length} onClick={() => bulk("archive")}>Archive</Button>
            <Button variant="ghost" disabled={!selectedIds.length} onClick={() => bulk("duplicate")}>Duplicate</Button>
            <Button variant="ghost" disabled={!selectedIds.length} onClick={() => setSelected({})}>Clear</Button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/86 shadow-[0_26px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl">
        <div className="flex flex-col gap-3 border-b border-slate-200/80 bg-gradient-to-r from-white/90 to-slate-50/80 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="text-lg font-semibold text-slate-950">Campaign fleet</div><p className="mt-1 text-sm text-slate-500">Every sequence with its sender load, lead movement, and live controls.</p></div>
          <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm">
            <input type="checkbox" checked={allChecked} ref={(el) => { if (el) el.indeterminate = someChecked; }} onChange={(e) => { const on = e.target.checked; const next: Record<string, boolean> = {}; rows.forEach((r) => (next[r.id] = on)); setSelected(next); }} /> Select visible
          </label>
        </div>
        <div className="divide-y divide-slate-200/80">
          {rows.map((c) => {
            const openRate = pct(c.opens, c.sent);
            const replyRate = pct(c.replies, c.sent);
            const h = healthForCampaign(c);
            const progress = c.leadsTotal ? Math.round((c.leadsCompleted / c.leadsTotal) * 100) : 0;
            return (
              <article key={c.id} className="group grid gap-5 p-5 transition hover:bg-indigo-50/30 xl:grid-cols-[minmax(280px,1.35fr)_minmax(220px,0.9fr)_minmax(260px,1fr)_auto] xl:items-center">
                <div className="flex min-w-0 items-start gap-4">
                  <input className="mt-4" type="checkbox" checked={!!selected[c.id]} onChange={(e) => setSelected((prev) => ({ ...prev, [c.id]: e.target.checked }))} />
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-3xl bg-gradient-to-br from-indigo-600 to-cyan-500 text-xl text-white shadow-lg shadow-indigo-500/20">📣</div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/app/campaigns/${c.id}`} className="truncate text-lg font-semibold text-slate-950 hover:underline">{c.name}</Link>
                      <Pill tone={toneForStatus(c.status)}>{c.status}</Pill>
                      <Pill tone={h.tone}>{h.label}</Pill>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{c.stepsCount} steps · {c.mailboxStrategy.replaceAll("_", " ")} · stop on {c.stopOnReply ? "reply" : "—"}{c.stopOnBounce ? ", bounce" : ""}</p>
                    <p className="mt-1 text-xs text-slate-400">Updated {formatDateUTC(c.updatedAt)}</p>
                  </div>
                </div>

                <div className="grid gap-2 text-sm text-slate-600">
                  <div className="flex items-center justify-between gap-4"><span>Window</span><span className="font-semibold text-slate-900">{c.sendingWindow}</span></div>
                  <div className="flex items-center justify-between gap-4"><span>Timezone</span><span className="font-semibold text-slate-900">{c.timezone}</span></div>
                  <div className="flex items-center justify-between gap-4"><span>Daily cap</span><span className="font-semibold text-slate-900">{fmt(c.dailySendLimit)}/day</span></div>
                  <div className="flex items-center justify-between gap-4"><span>Next run</span><span className="font-semibold text-slate-900">{c.nextRunAt ? formatDateInTimeZone(c.nextRunAt, c.timezone) : "—"}</span></div>
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2"><Badge>{fmt(c.activeMailboxes)} senders</Badge><Badge>{fmt(c.leadsTotal)} leads</Badge><Badge>{fmt(c.sent)} sent</Badge></div>
                  <div>
                    <div className="mb-1 flex justify-between text-xs text-slate-500"><span>Lead completion</span><span>{progress}%</span></div>
                    <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-gradient-to-r from-indigo-600 to-cyan-500" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} /></div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <div className="rounded-2xl bg-slate-50 p-2"><div className="font-semibold text-slate-950">{openRate}</div><div className="text-slate-500">open</div></div>
                    <div className="rounded-2xl bg-emerald-50 p-2"><div className="font-semibold text-emerald-700">{replyRate}</div><div className="text-emerald-700/70">reply</div></div>
                    <div className="rounded-2xl bg-amber-50 p-2"><div className="font-semibold text-amber-700">{fmt(c.clicks)}</div><div className="text-amber-700/70">clicks</div></div>
                    <div className="rounded-2xl bg-rose-50 p-2"><div className="font-semibold text-rose-700">{fmt(c.bounces)}</div><div className="text-rose-700/70">bounce</div></div>
                  </div>
                </div>

                <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
                  {c.status === "draft" ? <Link href={`/app/campaigns/new?resume=${encodeURIComponent(c.id)}`}><Button>Continue setup</Button></Link> : <Button variant={c.status === "running" ? "ghost" : "primary"} onClick={() => toggle(c.id, c.status === "running" ? "paused" : "running")}>{c.status === "running" ? "Pause" : c.status === "completed" ? "Restart" : "Run"}</Button>}
                  <Link href={`/app/campaigns/${c.id}/settings`}><Button variant="ghost">Settings</Button></Link>
                  <Link href={`/app/campaigns/${c.id}/analytics`}><Button variant="ghost">Analytics</Button></Link>
                  <Button variant="ghost" onClick={() => duplicateOne(c.id)}>Duplicate</Button>
                  <Link href={`/app/campaigns/${c.id}`}><Button variant="ghost">Open</Button></Link>
                </div>
              </article>
            );
          })}
          {rows.length === 0 ? <div className="p-10"><EmptyState title="No campaigns found" subtitle="Adjust filters or create your first campaign." action={<Link href="/app/campaigns/new"><Button>New Campaign</Button></Link>} /></div> : null}
        </div>
      </section>
    </div>
  );
}
