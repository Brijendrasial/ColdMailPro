"use client";

import React, { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input, Pill, Badge, Select, Modal, Kpi, Segmented, EmptyState } from "@/components/ui";
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

type OpsExplain =
  | { kind: "bounce"; item: OpsSpikeItem }
  | { kind: "unsub"; item: OpsSpikeItem }
  | { kind: "dns"; item: OpsDnsItem }
  | { kind: "capacity"; item: OpsSatItem }
  | { kind: "paused"; item: OpsPausedItem };


function toneForStatus(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "running") return "success";
  if (status === "paused") return "warning";
  if (status === "completed") return "info";
  if (status === "archived") return "danger";
  if (status === "stopped") return "danger";
  if (status === "draft") return "neutral";
  return "info";
}

function pct(n: number, d: number) {
  if (!d) return "0%";
  const v = Math.round((n / d) * 1000) / 10;
  return `${v}%`;
}

function fmt(n: number) {
  return new Intl.NumberFormat().format(n);
}

function fmtPct(r: number) {
  const v = Math.round((r || 0) * 1000) / 10;
  return `${v}%`;
}

function healthForCampaign(c: CampaignRow): { label: "Good" | "Watch" | "Risk" | "Draft"; tone: "success" | "warning" | "danger" | "neutral" } {
  // For drafts and archived campaigns, avoid noisy risk flags
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

  // Heuristics (tune later):
  // - Risk: bounce ≥ 8%, unsub ≥ 0.8%, failed ≥ 5%
  // - Watch: bounce ≥ 4%, unsub ≥ 0.4%, reply < 0.2% after 200 sends
  const lowReplyAfterEnough = sent >= 200 && replyRate < 0.002;

  if (bounceRate >= 0.08 || unsubRate >= 0.008 || failRate >= 0.05) return { label: "Risk", tone: "danger" };
  if (bounceRate >= 0.04 || unsubRate >= 0.004 || lowReplyAfterEnough) return { label: "Watch", tone: "warning" };
  return { label: "Good", tone: "success" };
}


export default function CampaignsTable({ initial, opsSummary }: { initial: CampaignRow[]; opsSummary?: OpsSummary }) {
  const router = useRouter();
  const sp = useSearchParams();

  // URL-driven filters (so it feels like a pro app and can be shared/bookmarked)
  const urlStatus = (sp.get("status") || "all").toLowerCase();
  const urlHealth = (sp.get("health") || "all").toLowerCase();
  const urlSort = (sp.get("sort") || "updated").toLowerCase();
  const urlQ = sp.get("q") || "";

  const [q, setQ] = useState(urlQ);
  const [status, setStatus] = useState(urlStatus);
  const [health, setHealth] = useState(urlHealth);
  const [sort, setSort] = useState(urlSort);

  // Bulk selection
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  // Pre-send QA modal
  const [qaOpen, setQaOpen] = useState(false);
  const [qaCampaignId, setQaCampaignId] = useState<string | null>(null);
  const [qaReport, setQaReport] = useState<any>(null);

  const [opsTab, setOpsTab] = useState<"paused" | "bounce" | "unsub" | "dns" | "capacity">("bounce");
  const [opsExplain, setOpsExplain] = useState<OpsExplain | null>(null);
  const [dnsCheckBusy, setDnsCheckBusy] = useState<Record<string, boolean>>({});

  async function runDnsCheck(domainIds: string[], key: string) {
    const ids = Array.from(new Set((domainIds || []).map((x) => String(x)).filter(Boolean)));
    if (!ids.length) {
      toast.info("No domains to check for this campaign.");
      return;
    }

    setDnsCheckBusy((m) => ({ ...m, [key]: true }));
    try {
      const res = await fetch("/api/domains/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domainIds: ids }),
      });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        toast.error(j?.error || "DNS check enqueue failed");
        return;
      }
      const n = Number(j?.enqueued || 0);
      toast.success(n ? `Queued DNS checks for ${n} domain(s)` : "DNS checks already running");
      // The job runs async; refresh keeps the UI consistent.
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
  useEffect(() => setQ(urlQ), [urlQ]);
  useEffect(() => setStatus(urlStatus), [urlStatus]);
  useEffect(() => setHealth(urlHealth), [urlHealth]);
  useEffect(() => setSort(urlSort), [urlSort]);

  const rows = useMemo(() => {
    let r = [...initial];

    const needle = q.trim().toLowerCase();
    if (needle) r = r.filter((x) => x.name.toLowerCase().includes(needle));

    if (status !== "all") r = r.filter((x) => x.status === status);

    if (health !== "all") {
      r = r.filter((x) => {
        const h = healthForCampaign(x);
        return h.label.toLowerCase() === health;
      });
    }

    const score = (x: CampaignRow) => {
      // "Priority" sorting: running first, then paused, then draft/stopped
      const statusWeight = x.status === "running" ? 0 : x.status === "paused" ? 1 : x.status === "draft" ? 2 : 3;
      const perf = x.replies * 1000000 + x.opens * 1000 + x.sent;
      return statusWeight * 10_000_000_000 - perf;
    };

    if (sort === "name") r.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "created") r.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    else if (sort === "performance") r.sort((a, b) => score(a) - score(b));
    else r.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)); // updated

    return r;
  }, [initial, q, status, health, sort]);

  const stats = useMemo(() => {
    const total = initial.length;
    const running = initial.filter((x) => x.status === "running").length;
    const paused = initial.filter((x) => x.status === "paused").length;
    const draft = initial.filter((x) => x.status === "draft").length;
    const sent = initial.reduce((a, x) => a + (Number(x.sent) || 0), 0);
    const replies = initial.reduce((a, x) => a + (Number(x.replies) || 0), 0);
    const good = initial.filter((x) => healthForCampaign(x).label === "Good").length;
    const watch = initial.filter((x) => healthForCampaign(x).label === "Watch").length;
    const risk = initial.filter((x) => healthForCampaign(x).label === "Risk").length;
    return { total, running, paused, draft, sent, replies, good, watch, risk };
  }, [initial]);

  const rowById = useMemo(() => {
    const m: Record<string, CampaignRow> = {};
    for (const r of initial) m[r.id] = r;
    return m;
  }, [initial]);

  const allChecked = rows.length > 0 && rows.every((r) => selected[r.id]);
  const someChecked = rows.some((r) => selected[r.id]) && !allChecked;

  function updateUrl(next: { q?: string; status?: string; health?: string; sort?: string }) {
    const params = new URLSearchParams(sp.toString());
    if (typeof next.q === "string") (next.q ? params.set("q", next.q) : params.delete("q"));
    if (typeof next.status === "string") (next.status && next.status !== "all" ? params.set("status", next.status) : params.delete("status"));
    if (typeof next.health === "string") (next.health && next.health !== "all" ? params.set("health", next.health) : params.delete("health"));
    if (typeof next.sort === "string") (next.sort && next.sort !== "updated" ? params.set("sort", next.sort) : params.delete("sort"));
    const qs = params.toString();
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
      if (j?.error === "VALIDATION_FAILED") {
        setQaCampaignId(id);
        setQaReport(j.report || null);
        setQaOpen(true);
        toast.info("Fix the pre-send checks, then start again.");
        return;
      }
      toast.error(j?.error || "Failed to toggle campaign.");
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
    if (!res.ok) {
      toast.error("Duplicate failed.");
      return;
    }
    const j = await res.json().catch(() => ({} as any));
    const to = Array.isArray(j?.copies) && j.copies[0]?.to ? String(j.copies[0].to) : null;
    toast.success("Campaign duplicated");
    if (to) {
      router.push(`/app/campaigns/${to}/settings`);
      return;
    }
    router.refresh();
  }


  async function bulk(action: "read" | "unread" | "pause" | "run" | "stop" | "archive" | "unarchive" | "duplicate") {
    const ids = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
    if (ids.length === 0) return;

    const res = await fetch("/api/campaigns/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids, action }),
    });
    if (!res.ok) {
      toast.error("Bulk action failed.");
      return;
    }
    setSelected({});

    if (action === "duplicate") {
      const j = await res.json().catch(() => ({} as any));
      const n = Array.isArray(j?.copies) ? j.copies.length : ids.length;
      toast.success(`Duplicated ${n} campaign(s)`);
      if (Array.isArray(j?.copies) && j.copies.length === 1 && j.copies[0]?.to) {
        router.push(`/app/campaigns/${j.copies[0].to}/settings`);
        return;
      }
    } else {
      toast.success("Bulk action complete");
    }

    router.refresh();
  }

  return (
    <div className="grid gap-4">
      {qaOpen ? (
        <Modal
          title="Campaign can’t start (pre-send checks)"
          onClose={() => setQaOpen(false)}
          wide
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setQaOpen(false)}>Close</Button>
              <Link href={qaCampaignId ? `/app/campaigns/${qaCampaignId}/settings` : "/app/campaigns"}>
                <Button onClick={() => setQaOpen(false)}>Open campaign settings</Button>
              </Link>
            </div>
          }
        >
          <div className="text-sm text-slate-600">
            Fix the errors below, then start again. Warnings are optional but recommended.
          </div>

          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <Badge>Spam risk score: {Number(qaReport?.spamScore ?? 0)}</Badge>
            <Badge>Errors: {Array.isArray(qaReport?.errors) ? qaReport.errors.length : 0}</Badge>
            <Badge>Warnings: {Array.isArray(qaReport?.warnings) ? qaReport.warnings.length : 0}</Badge>
          </div>

          <div className="mt-4 grid gap-3">
            <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
              <div className="font-semibold">Errors</div>
              {Array.isArray(qaReport?.errors) && qaReport.errors.length ? (
                <ul className="mt-2 text-sm grid gap-2">
                  {qaReport.errors.map((e: any, idx: number) => (
                    <li key={idx} className="flex gap-2">
                      <span className="mt-0.5">•</span>
                      <div className="min-w-0">
                        <div className="font-medium">{e.message}</div>
                        <div className="text-xs opacity-70">
                          Step {e.stepNumber ?? "-"}{e.variantName ? ` · Variant ${e.variantName}` : ""}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-2 text-sm opacity-70">No blocking errors.</div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
              <div className="font-semibold">Warnings</div>
              {Array.isArray(qaReport?.warnings) && qaReport.warnings.length ? (
                <ul className="mt-2 text-sm grid gap-2">
                  {qaReport.warnings.slice(0, 8).map((w: any, idx: number) => (
                    <li key={idx} className="flex gap-2">
                      <span className="mt-0.5">•</span>
                      <div className="min-w-0">
                        <div className="font-medium">{w.message}</div>
                        <div className="text-xs opacity-70">
                          Step {w.stepNumber ?? "-"}{w.variantName ? ` · Variant ${w.variantName}` : ""}
                        </div>
                      </div>
                    </li>
                  ))}
                  {qaReport.warnings.length > 8 ? <li className="text-xs opacity-70">…and {qaReport.warnings.length - 8} more</li> : null}
                </ul>
              ) : (
                <div className="mt-2 text-sm opacity-70">No warnings.</div>
              )}
            </div>
          </div>
        </Modal>
      ) : null}

      {opsExplain ? (
        <Modal
          title={`Alert details · ${opsExplain.item.name}`}
          onClose={() => setOpsExplain(null)}
          wide
          footer={(() => {
            const id = (opsExplain as any).item?.id as string | undefined;
            const c = id ? rowById[id] : undefined;
            const deliverabilityLink = id
              ? `/app/campaigns/${id}/deliverability?rule=${
                  opsExplain.kind === "bounce"
                    ? "bounce_spike"
                    : opsExplain.kind === "unsub"
                      ? "unsub_spike"
                      : opsExplain.kind === "paused"
                        ? "paused"
                        : opsExplain.kind === "dns"
                          ? "dns"
                          : "capacity"
                }`
              : "/app/campaigns";

            return (
              <div className="flex items-center justify-end gap-2 flex-wrap">
                <Button variant="ghost" onClick={() => setOpsExplain(null)}>Close</Button>
                {id ? (
                  <Link href={deliverabilityLink}><Button variant="ghost">Open drill-down</Button></Link>
                ) : null}
                {id && c ? (
                  c.status === "running" ? (
                    <Button variant="danger" onClick={() => toggle(id, "paused")}>Pause now</Button>
                  ) : c.status === "paused" ? (
                    <Button onClick={() => toggle(id, "running")}>Resume</Button>
                  ) : null
                ) : null}
              </div>
            );
          })()}
        >
          {(() => {
            const kind = opsExplain.kind;
            const item: any = opsExplain.item as any;
            if (kind === "bounce") {
              const delta = (item.rate24h || 0) - (item.rate7d || 0);
              return (
                <div className="grid gap-3 text-sm">
                  <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
                    <div className="font-semibold">Bounce spike</div>
                    <div className="mt-2 grid gap-1">
                      <div className="flex items-center justify-between"><span>24h bounce rate</span><span className="font-medium">{fmtPct(item.rate24h)}</span></div>
                      <div className="flex items-center justify-between"><span>7d baseline</span><span className="font-medium">{fmtPct(item.rate7d)}</span></div>
                      <div className="flex items-center justify-between"><span>Delta</span><span className="font-medium">{fmtPct(delta)}</span></div>
                      <div className="flex items-center justify-between"><span>Sent (24h)</span><span className="font-medium">{fmt(item.sent24h)}</span></div>
                    </div>
                    <div className="text-xs opacity-70 mt-2">
                      Tip: if this persists, check list quality (invalids), sender DNS/health, and mailbox throttles.
                    </div>
                  </div>
                </div>
              );
            }
            if (kind === "unsub") {
              const delta = (item.rate24h || 0) - (item.rate7d || 0);
              return (
                <div className="grid gap-3 text-sm">
                  <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
                    <div className="font-semibold">Unsubscribe spike</div>
                    <div className="mt-2 grid gap-1">
                      <div className="flex items-center justify-between"><span>24h unsub rate</span><span className="font-medium">{fmtPct(item.rate24h)}</span></div>
                      <div className="flex items-center justify-between"><span>7d baseline</span><span className="font-medium">{fmtPct(item.rate7d)}</span></div>
                      <div className="flex items-center justify-between"><span>Delta</span><span className="font-medium">{fmtPct(delta)}</span></div>
                      <div className="flex items-center justify-between"><span>Sent (24h)</span><span className="font-medium">{fmt(item.sent24h)}</span></div>
                    </div>
                    <div className="text-xs opacity-70 mt-2">
                      Tip: tighten targeting, reduce frequency, and make the offer clearer in the first line.
                    </div>
                  </div>
                </div>
              );
            }
            if (kind === "dns") {
              return (
                <div className="grid gap-3 text-sm">
                  <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
                    <div className="font-semibold">DNS health risk</div>
                    <div className="mt-2 text-sm opacity-80">Affected sender domains:</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(item.domains || []).map((d: string) => (
                        <Pill key={d} tone="warning">{d}</Pill>
                      ))}
                    </div>
                    <div className="text-xs opacity-70 mt-2">
                      Tip: confirm SPF/DKIM/DMARC + MX, and re-run DNS checks. DNS issues can tank inboxing fast.
                    </div>
                  </div>
                </div>
              );
            }
            if (kind === "capacity") {
              const util = item.capacity ? item.limit / item.capacity : 0;
              return (
                <div className="grid gap-3 text-sm">
                  <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
                    <div className="font-semibold">Sender capacity</div>
                    <div className="mt-2 grid gap-1">
                      <div className="flex items-center justify-between"><span>Campaign daily limit</span><span className="font-medium">{fmt(item.limit)}</span></div>
                      <div className="flex items-center justify-between"><span>Estimated sender capacity</span><span className="font-medium">{fmt(item.capacity)}</span></div>
                      <div className="flex items-center justify-between"><span>Utilization</span><span className="font-medium">{fmtPct(util)}</span></div>
                    </div>
                    <div className="text-xs opacity-70 mt-2">
                      Tip: reduce daily limit or add more mailboxes (or a pool) to avoid uneven warm sender pressure.
                    </div>
                  </div>
                </div>
              );
            }

            // paused
            return (
              <div className="grid gap-3 text-sm">
                <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
                  <div className="font-semibold">Paused reason</div>
                  <div className="mt-2 whitespace-pre-wrap opacity-80">{String(item.reason || "—")}</div>
                  <div className="text-xs opacity-70 mt-2">
                    Tip: open drill-down to see which guardrail likely triggered and what to fix before resuming.
                  </div>
                </div>
              </div>
            );
          })()}
        </Modal>
      ) : null}
      {/* header controls */}
      <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-xl font-semibold tracking-tight">Campaigns</div>
          <div className="text-sm opacity-70">Instantly-style view with filters, quick actions, and performance snapshots.</div>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/app/campaigns/new">
            <Button>+ New Campaign</Button>
          </Link>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Campaigns" value={stats.total} />
        <Kpi label="Running" value={stats.running} tone="success" />
        <Kpi label="Paused" value={stats.paused} tone="warning" />
        <Kpi label="Drafts" value={stats.draft} tone="info" />
        <Kpi label="Sent" value={fmt(stats.sent)} />
        <Kpi label="Replies" value={fmt(stats.replies)} tone="success" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Healthy" value={stats.good} tone="success" />
        <Kpi label="Watch" value={stats.watch} tone="warning" />
        <Kpi label="Risk" value={stats.risk} tone="danger" />
      </div>

      {opsSummary ? (
        <div className="glass p-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
            <div className="font-semibold">Ops Alerts</div>
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <Pill tone={opsSummary.dnsFailCount ? "danger" : opsSummary.dnsWarnCount ? "warning" : "success"}>
                DNS {opsSummary.dnsFailCount} fail / {opsSummary.dnsWarnCount} warn
              </Pill>
              <Pill tone={opsSummary.bounceSpikes?.length ? "danger" : "success"}>
                Bounce spikes {opsSummary.bounceSpikes?.length || 0}
              </Pill>
              <Pill tone={opsSummary.unsubSpikes?.length ? "warning" : "success"}>
                Unsub spikes {opsSummary.unsubSpikes?.length || 0}
              </Pill>
              <Pill tone={opsSummary.dnsIssues?.length ? "warning" : "success"}>
                Affected campaigns {opsSummary.dnsIssues?.length || 0}
              </Pill>
              <Pill tone={opsSummary.saturation?.length ? "warning" : "success"}>
                Capacity risk {opsSummary.saturation?.length || 0}
              </Pill>
              <Pill tone={opsSummary.pausedWithReason?.length ? "neutral" : "success"}>
                Paused w/ reason {opsSummary.pausedWithReason?.length || 0}
              </Pill>
            </div>
          </div>

          <div className="mt-3">
            <Segmented
              value={opsTab}
              onChange={(v) => setOpsTab(v as any)}
              options={[
                { value: "bounce", label: "Bounce spikes" },
                { value: "unsub", label: "Unsub spikes" },
                { value: "dns", label: "DNS issues" },
                { value: "capacity", label: "Capacity" },
                { value: "paused", label: "Paused" },
              ]}
            />
          </div>

          <div className="mt-3 grid gap-2">
            {opsTab === "bounce" ? (
              (opsSummary.bounceSpikes?.length ? (
                opsSummary.bounceSpikes.slice(0, 6).map((x) => (
                  <div key={x.id} className="flex items-start justify-between gap-3 rounded-xl border border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] px-3 py-2">
                    <div className="min-w-0">
                      <Link className="font-medium hover:underline truncate block" href={`/app/campaigns/${x.id}`}>{x.name}</Link>
                      <div className="text-xs opacity-70 mt-0.5">Sent 24h: {fmt(x.sent24h)} · 7d baseline: {fmtPct(x.rate7d)}</div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        onClick={() => setOpsExplain({ kind: "bounce", item: x })}
                      >
                        Why
                      </Button>
                      <Pill tone="danger">{fmtPct(x.rate24h)}</Pill>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState title="No bounce spikes detected" />
              ))
            ) : null}

            {opsTab === "unsub" ? (
              (opsSummary.unsubSpikes?.length ? (
                opsSummary.unsubSpikes.slice(0, 6).map((x) => (
                  <div key={x.id} className="flex items-start justify-between gap-3 rounded-xl border border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] px-3 py-2">
                    <div className="min-w-0">
                      <Link className="font-medium hover:underline truncate block" href={`/app/campaigns/${x.id}`}>{x.name}</Link>
                      <div className="text-xs opacity-70 mt-0.5">Sent 24h: {fmt(x.sent24h)} · 7d baseline: {fmtPct(x.rate7d)}</div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        onClick={() => setOpsExplain({ kind: "unsub", item: x })}
                      >
                        Why
                      </Button>
                      <Pill tone="warning">{fmtPct(x.rate24h)}</Pill>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState title="No unsubscribe spikes detected" />
              ))
            ) : null}

            {opsTab === "dns" ? (
              (opsSummary.dnsIssues?.length ? (
                opsSummary.dnsIssues.slice(0, 6).map((x) => (
                  <div key={x.id} className="flex items-start justify-between gap-3 rounded-xl border border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] px-3 py-2">
                    <div className="min-w-0">
                      <Link className="font-medium hover:underline truncate block" href={`/app/campaigns/${x.id}`}>{x.name}</Link>
                      <div className="text-xs opacity-70 mt-0.5">Domains: {x.domains.join(", ")}</div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        onClick={() => setOpsExplain({ kind: "dns", item: x })}
                      >
                        Why
                      </Button>
                      <Button
                        variant="ghost"
                        className="px-3 py-1 text-xs border-amber-200 text-amber-700 hover:bg-amber-50"
                        disabled={!!dnsCheckBusy[x.id]}
                        onClick={() => runDnsCheck((x as any).domainIds || [], x.id)}
                      >
                        {dnsCheckBusy[x.id] ? "Checking…" : "Check"}
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState title="No DNS-related campaign risks" />
              ))
            ) : null}

            {opsTab === "capacity" ? (
              (opsSummary.saturation?.length ? (
                opsSummary.saturation.slice(0, 6).map((x) => {
                  const util = x.capacity ? x.limit / x.capacity : 0;
                  return (
                    <div key={x.id} className="flex items-start justify-between gap-3 rounded-xl border border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] px-3 py-2">
                      <div className="min-w-0">
                        <Link className="font-medium hover:underline truncate block" href={`/app/campaigns/${x.id}`}>{x.name}</Link>
                        <div className="text-xs opacity-70 mt-0.5">Daily limit: {fmt(x.limit)} · Capacity: {fmt(x.capacity)}</div>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs"
                          onClick={() => setOpsExplain({ kind: "capacity", item: x })}
                        >
                          Why
                        </Button>
                        <Pill tone="warning">{fmtPct(util)}</Pill>
                      </div>
                    </div>
                  );
                })
              ) : (
                <EmptyState title="No campaigns near sender capacity" />
              ))
            ) : null}

            {opsTab === "paused" ? (
              (opsSummary.pausedWithReason?.length ? (
                opsSummary.pausedWithReason.slice(0, 6).map((x) => (
                  <div key={x.id} className="flex items-start justify-between gap-3 rounded-xl border border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] px-3 py-2">
                    <div className="min-w-0">
                      <Link className="font-medium hover:underline truncate block" href={`/app/campaigns/${x.id}`}>{x.name}</Link>
                      <div className="text-xs opacity-70 mt-0.5 line-clamp-2">{x.reason}</div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        onClick={() => setOpsExplain({ kind: "paused", item: x })}
                      >
                        Why
                      </Button>
                      <Pill tone="neutral">Paused</Pill>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState title="No paused campaigns with reasons" />
              ))
            ) : null}
          </div>
        </div>
      ) : null}




      {/* filter bar */}
      <div className="glass p-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search campaigns..."
              onKeyDown={(e) => {
                if (e.key === "Enter") updateUrl({ q });
              }}
            />
            <Button
              variant="ghost" className="bg-black/5 dark:bg-white/10"
              onClick={() => updateUrl({ q })}
              title="Apply search"
            >
              Search
            </Button>
            {urlQ ? (
              <Button variant="ghost" onClick={() => { setQ(""); updateUrl({ q: "" }); }}>
                Clear
              </Button>
            ) : null}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Segmented
              value={status}
              onChange={(v) => { setStatus(v); updateUrl({ status: v }); }}
              options={[
                { value: "all", label: "All" },
                { value: "running", label: "Running" },
                { value: "paused", label: "Paused" },
                { value: "completed", label: "Completed" },
                { value: "draft", label: "Draft" },
                { value: "stopped", label: "Stopped" },
                { value: "archived", label: "Archived" },
              ]}
            />

            <div className="flex items-center gap-2">
              <div className="text-xs opacity-70">Health</div>
              <Select
                className="w-[180px]"
                value={health}
                onChange={(e) => { setHealth(e.target.value); updateUrl({ health: e.target.value }); }}
              >
                <option value="all">All</option>
                <option value="good">Good</option>
                <option value="watch">Watch</option>
                <option value="risk">Risk</option>
                <option value="draft">Draft</option>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <div className="text-xs opacity-70">Sort</div>
              <Select
                className="w-[220px]"
                value={sort}
                onChange={(e) => { setSort(e.target.value); updateUrl({ sort: e.target.value }); }}
              >
                <option value="updated">Recently updated</option>
                <option value="created">Recently created</option>
                <option value="name">Name</option>
                <option value="performance">Performance</option>
              </Select>
            </div>
          </div>
        </div>

        {/* bulk bar */}
        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm opacity-70">
            {rows.length === 0 ? "No campaigns match your filters." : `${rows.length} campaign(s)`}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" className="bg-black/5 dark:bg-white/10" disabled={!Object.values(selected).some(Boolean)} onClick={() => bulk("pause")}>Pause</Button>
            <Button variant="ghost" className="bg-black/5 dark:bg-white/10" disabled={!Object.values(selected).some(Boolean)} onClick={() => bulk("run")}>Run</Button>
            <Button variant="ghost" className="bg-black/5 dark:bg-white/10" disabled={!Object.values(selected).some(Boolean)} onClick={() => bulk("stop")}>Stop</Button>
            <Button variant="ghost" className="bg-black/5 dark:bg-white/10" disabled={!Object.values(selected).some(Boolean)} onClick={() => bulk("archive")}>Archive</Button>
            <Button variant="ghost" className="bg-black/5 dark:bg-white/10" disabled={!Object.values(selected).some(Boolean)} onClick={() => bulk("unarchive")}>Unarchive</Button>
            <Button variant="ghost" className="bg-black/5 dark:bg-white/10" disabled={!Object.values(selected).some(Boolean)} onClick={() => bulk("duplicate")}>Duplicate</Button>
            <Button variant="ghost" disabled={!Object.values(selected).some(Boolean)} onClick={() => setSelected({})}>Clear selection</Button>
          </div>
        </div>
      </div>

      {/* table */}
      <div className="table-wrap">
        <div className="overflow-x-auto">
          <table className="min-w-[1050px] w-full text-sm">
            <thead className="table-head">
              <tr>
                <th className="table-cell text-left w-[44px]">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={(el) => { if (el) el.indeterminate = someChecked; }}
                    onChange={(e) => {
                      const on = e.target.checked;
                      const next: Record<string, boolean> = {};
                      rows.forEach((r) => (next[r.id] = on));
                      setSelected(next);
                    }}
                  />
                </th>
                <th className="table-cell text-left">Campaign</th>
                <th className="table-cell text-left">Schedule</th>
                <th className="table-cell text-left">Senders</th>
                <th className="table-cell text-left">Leads</th>
                <th className="table-cell text-left">Performance</th>
                <th className="table-cell text-left">Status</th>
                <th className="table-cell text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const openRate = pct(c.opens, c.sent);
                const replyRate = pct(c.replies, c.sent);

                return (
                  <tr key={c.id} className="table-row">
                    <td className="table-cell align-top">
                      <input
                        type="checkbox"
                        checked={!!selected[c.id]}
                        onChange={(e) => setSelected((prev) => ({ ...prev, [c.id]: e.target.checked }))}
                      />
                    </td>

                    <td className="table-cell align-top">
                      <div className="flex items-start gap-3">
                        <div className="h-10 w-10 rounded-2xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-black/30 flex items-center justify-center">
                          📣
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold truncate">
                            <Link className="hover:underline" href={`/app/campaigns/${c.id}`}>{c.name}</Link>
                          </div>
                          <div className="text-xs opacity-70 mt-0.5">
                            Steps: {c.stepsCount} · Strategy: {c.mailboxStrategy.replace("_", " ")} · Stops: {c.stopOnReply ? "reply" : ""}{c.stopOnBounce ? `${c.stopOnReply ? ", " : ""}bounce` : ""}
                          </div>
                          <div className="text-xs opacity-60 mt-0.5">
                            Updated {formatDateUTC(c.updatedAt)}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="table-cell align-top">
                      <div className="grid gap-1">
                        <div className="text-sm font-medium">{c.sendingWindow}</div>
                        <div className="text-xs opacity-70">{c.timezone}</div>
                        <div className="text-xs opacity-70">Limit: {fmt(c.dailySendLimit)}/day{c.rampEnabled ? ` (ramp ${c.rampStartLimit}→${c.rampMaxLimit})` : ""}</div>
                        {c.nextRunAt ? (
                          <div className="text-xs opacity-70">Next: {formatDateInTimeZone(c.nextRunAt, c.timezone)}</div>
                        ) : (
                          <div className="text-xs opacity-50">Next: —</div>
                        )}
                      </div>
                    </td>

                    <td className="table-cell align-top">
                      <div className="grid gap-1">
                        <div className="text-sm font-medium">{c.activeMailboxes}</div>
                        <div className="text-xs opacity-70">{c.senderPoolCount ? "selected" : "active"} mailbox(es)</div>
                      </div>
                    </td>

                    <td className="table-cell align-top">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Pill>{fmt(c.leadsTotal)} total</Pill>
                        <Pill tone="info">{fmt(c.leadsActive)} active</Pill>
                        <Pill tone="neutral">{fmt(c.leadsCompleted)} done</Pill>
                      </div>
                      <div className="mt-2 text-xs opacity-70">
                        Sent: {fmt(c.sent)} · Bounced: {fmt(c.bounces)} · Failed: {fmt(c.failed)}
                      </div>
                    </td>

                    <td className="table-cell align-top">
                      <div className="grid gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge>Opens {fmt(c.opens)} ({openRate})</Badge>
                          <Badge>Replies {fmt(c.replies)} ({replyRate})</Badge>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap opacity-80">
                          <span className="text-xs">Clicks {fmt(c.clicks)}</span>
                          <span className="text-xs">Unsubs {fmt(c.unsubscribes)}</span>
                        </div>
                      </div>
                    </td>

                    <td className="table-cell align-top">
                      <div className="flex items-center gap-2 justify-end flex-wrap">
                        {(() => {
                          const h = healthForCampaign(c);
                          return <Pill tone={h.tone}>{h.label}</Pill>;
                        })()}
                        <Pill tone={toneForStatus(c.status)}>{c.status}</Pill>
                        {c.archivedAt ? <Pill tone="danger">archived</Pill> : null}
                      </div>
                    </td>

                    <td className="table-cell align-top text-right">
                      <div className="flex items-center justify-end gap-2 flex-wrap">
                        {c.status === "draft" ? (
                          <Link href={`/app/campaigns/new?resume=${encodeURIComponent(c.id)}`}>
                            <Button variant="primary" title="Continue setup">Continue setup</Button>
                          </Link>
                        ) : (
                          <Button
                            variant={c.status === "running" ? "ghost" : "primary"}
                            className={c.status === "running" ? "bg-black/5 dark:bg-white/10" : ""}
                            onClick={() => {
                              if (c.status === "running") return toggle(c.id, "paused");
                              // "completed" uses a derived UI status, so explicitly request a (re)start.
                              return toggle(c.id, "running");
                            }}
                            title={c.status === "running" ? "Pause campaign" : c.status === "completed" ? "Restart campaign" : "Run campaign"}
                          >
                            {c.status === "running" ? "Pause" : c.status === "completed" ? "Restart" : "Run"}
                          </Button>
                        )}
                        <Link href={`/app/campaigns/${c.id}/settings`}>
                          <Button variant="ghost">Settings</Button>
                        </Link>
                        <Button variant="ghost" onClick={() => duplicateOne(c.id)}>Duplicate</Button>
                        <Link href={`/app/campaigns/${c.id}/analytics`}>
                          <Button variant="ghost">Analytics</Button>
                        </Link>
                        <Link href={`/app/campaigns/${c.id}`}>
                          <Button variant="ghost">Open</Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-sm opacity-70">
                    No campaigns found. Create your first one.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* pro tip */}
      <div className="text-xs opacity-70">
        Pro tip: Bookmark filtered views (e.g. <span className="font-mono">?status=running&health=risk</span>) for 1-click ops.
      </div>
    </div>
  );
}
