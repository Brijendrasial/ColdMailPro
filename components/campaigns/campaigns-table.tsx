"use client";

import React, { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input, Pill, Badge, Select, Modal, Kpi, Segmented, EmptyState } from "@/components/ui";
import { formatDateUTC } from "@/lib/date";
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


export default function CampaignsTable({ initial }: { initial: CampaignRow[] }) {
  const router = useRouter();
  const sp = useSearchParams();

  // URL-driven filters (so it feels like a pro app and can be shared/bookmarked)
  const urlStatus = (sp.get("status") || "all").toLowerCase();
  const urlSort = (sp.get("sort") || "updated").toLowerCase();
  const urlQ = sp.get("q") || "";

  const [q, setQ] = useState(urlQ);
  const [status, setStatus] = useState(urlStatus);
  const [sort, setSort] = useState(urlSort);

  // Bulk selection
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  // Pre-send QA modal
  const [qaOpen, setQaOpen] = useState(false);
  const [qaCampaignId, setQaCampaignId] = useState<string | null>(null);
  const [qaReport, setQaReport] = useState<any>(null);

  useEffect(() => setQ(urlQ), [urlQ]);
  useEffect(() => setStatus(urlStatus), [urlStatus]);
  useEffect(() => setSort(urlSort), [urlSort]);

  const rows = useMemo(() => {
    let r = [...initial];

    const needle = q.trim().toLowerCase();
    if (needle) r = r.filter((x) => x.name.toLowerCase().includes(needle));

    if (status !== "all") r = r.filter((x) => x.status === status);

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
  }, [initial, q, status, sort]);

  const stats = useMemo(() => {
    const total = initial.length;
    const running = initial.filter((x) => x.status === "running").length;
    const paused = initial.filter((x) => x.status === "paused").length;
    const draft = initial.filter((x) => x.status === "draft").length;
    const sent = initial.reduce((a, x) => a + (Number(x.sent) || 0), 0);
    const replies = initial.reduce((a, x) => a + (Number(x.replies) || 0), 0);
    return { total, running, paused, draft, sent, replies };
  }, [initial]);

  const allChecked = rows.length > 0 && rows.every((r) => selected[r.id]);
  const someChecked = rows.some((r) => selected[r.id]) && !allChecked;

  function updateUrl(next: { q?: string; status?: string; sort?: string }) {
    const params = new URLSearchParams(sp.toString());
    if (typeof next.q === "string") (next.q ? params.set("q", next.q) : params.delete("q"));
    if (typeof next.status === "string") (next.status && next.status !== "all" ? params.set("status", next.status) : params.delete("status"));
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

  async function bulk(action: "read" | "unread" | "pause" | "run" | "stop") {
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
    toast.success("Bulk action complete");
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
                        {c.nextRunAt ? <div className="text-xs opacity-70">Next: {formatDateUTC(c.nextRunAt)}</div> : <div className="text-xs opacity-50">Next: —</div>}
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
                      <div className="flex items-center gap-2 justify-end">
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
        Pro tip: Bookmark filtered views (e.g. <span className="font-mono">?status=running</span>). This is how Instantly/Smartlead feels fast.
      </div>
    </div>
  );
}
