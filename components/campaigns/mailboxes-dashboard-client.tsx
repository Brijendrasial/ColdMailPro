"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Button, Input, Pill, Badge, Select, Modal } from "@/components/ui";

type Row = {
  mailboxId: string;
  name: string;
  fromEmail: string;
  isActive: boolean;
  dailyLimit: number;
  warmupEnabled: boolean;
  excluded: boolean;
  domainBreakdown7d: { gmail: { sent: number; bounced: number }; yahoo: { sent: number; bounced: number }; outlook: { sent: number; bounced: number }; other: { sent: number; bounced: number } };
  sentTrend7d: number[];
  sent24h: number;
  sent7d: number;
  queued: number;
  failed24h: number;
  hardBounces7d: number;
  softBounces7d: number;
  replies7d: number;
  unsubs7d: number;
  lastSentAt?: string | null;
  idleMinutes?: number | null;
  throttle?: { until: string; reason?: string | null } | null;
  healthScore: number;
  healthBand: "great" | "good" | "risk" | "critical";
  notes: string[];
};

type DashboardData = {
  campaign: {
    id: string;
    name: string;
    status: string;
    mailboxStrategy: string;
    mailboxMinIdleMinutes: number;
    senderMode: "manual" | "pool" | "all";
    mailboxPoolId: string | null;
    mailboxPoolName: string | null;
  };
  totals: {
    mailboxes: number;
    throttled: number;
    sent24h: number;
    sent7d: number;
    queued: number;
    failed24h: number;
  };
  rows: Row[];
  windows: { since24h: string; since7d: string };
};

type RoutingPreview = {
  campaign: { id: string; name: string; status: string };
  strategy: string;
  mailboxMinIdleMinutes: number;
  chosenMailboxId: string | null;
  note: string;
  rows: Array<{
    mailboxId: string;
    name: string;
    fromEmail: string;
    weight: number;
    throttled: { until: string; reason?: string | null } | null;
    lastSentAt: string | null;
    idleMinutes: number | null;
    idleOk: boolean;
    routingScore: number | null;
    eligible: boolean;
    reasons: string[];
  }>;
};

function fmtWhen(iso?: string | null) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function scoreTone(band: Row["healthBand"]) {
  return band === "great" ? "success" : band === "good" ? "info" : band === "risk" ? "warning" : "danger";
}

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (s.includes('"')) return `"${s.replace(/\"/g, '""')}"`;
  if (s.includes(",") || s.includes("\n") || s.includes("\r")) return `"${s}"`;
  return s;
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  // Note: Sparkline is defined at module scope below. Keep this helper focused on download behavior.
}

function Sparkline({ values }: { values: number[] }) {
  const w = 120;
  const h = 28;
  const max = Math.max(1, ...values.map((v) => (Number.isFinite(v) ? v : 0)));
  const pts = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * (w - 2) + 1;
      const y = h - 1 - (Math.max(0, (Number.isFinite(v) ? v : 0)) / max) * (h - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const title = values.join(', ');

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block">
      <title>{title}</title>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.8" />
    </svg>
  );
}

export function MailboxesDashboardClient({ initial }: { initial: DashboardData }) {
  const [data, setData] = useState<DashboardData>(initial);
  const [q, setQ] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<string>("");
  const [filter, setFilter] = useState<"all" | "risky" | "throttled">("all");
  const [sortBy, setSortBy] = useState<"health" | "load" | "sent24" | "bounces" | "replies" | "queue">("health");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<RoutingPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState<boolean>(false);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let rows = data.rows;

    if (filter === "risky") rows = rows.filter((r) => r.healthBand === "risk" || r.healthBand === "critical");
    if (filter === "throttled") rows = rows.filter((r) => !!r.throttle);

    if (qq) rows = rows.filter((r) => (r.name + " " + r.fromEmail).toLowerCase().includes(qq));

    const sorted = [...rows].sort((a, b) => {
      if (sortBy === "load") return (b.sent24h / Math.max(1, b.dailyLimit)) - (a.sent24h / Math.max(1, a.dailyLimit));
      if (sortBy === "sent24") return b.sent24h - a.sent24h;
      if (sortBy === "queue") return b.queued - a.queued;
      if (sortBy === "replies") return b.replies7d - a.replies7d;
      if (sortBy === "bounces") return (b.hardBounces7d + b.softBounces7d) - (a.hardBounces7d + a.softBounces7d);
      return b.healthScore - a.healthScore; // health default
    });

    return sorted;
  }, [q, data.rows, filter, sortBy]);

  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);

  function toggleAll(checked: boolean) {
    if (!checked) {
      setSelected({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const r of filtered) next[r.mailboxId] = true;
    setSelected(next);
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => ({ ...prev, [id]: checked }));
  }

  async function refresh() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/campaigns/mailboxes-dashboard?campaignId=${encodeURIComponent(data.campaign.id)}`);
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "FAILED");
      setData(j.data);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function clearThrottle(mailboxId: string) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/mailboxes/throttle-clear", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mailboxId, campaignId: data.campaign.id }),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "FAILED");
      await refresh();
    } catch (e: any) {
      setErr(String(e?.message || e));
      setBusy(false);
    }
  }

  
  async function setExcluded(mailboxId: string, excluded: boolean) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/campaigns/mailbox-exclusion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId: data.campaign.id, mailboxId, excluded }),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "FAILED");
      await refresh();
    } catch (e: any) {
      setErr(String(e?.message || e));
      setBusy(false);
    }
  }

async function throttleOne(mailboxId: string, minutes: number) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/mailboxes/throttle-set", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mailboxId, campaignId: data.campaign.id, minutes, reason: `manual:${minutes}m` }),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "FAILED");
      await refresh();
    } catch (e: any) {
      setErr(String(e?.message || e));
      setBusy(false);
    }
  }

  async function throttleSelected(minutes: number) {
    if (selectedIds.length === 0) return;
    setBusy(true);
    setErr("");
    try {
      await Promise.all(
        selectedIds.map(async (mailboxId) => {
          const res = await fetch("/api/mailboxes/throttle-set", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mailboxId, campaignId: data.campaign.id, minutes, reason: `bulk:${minutes}m` }),
          });
          const j = await res.json();
          if (!res.ok || !j?.ok) throw new Error(j?.error || "FAILED");
        })
      );
      await refresh();
      setSelected({});
    } catch (e: any) {
      setErr(String(e?.message || e));
      setBusy(false);
    }
  }

  async function clearSelectedCooldowns() {
    if (selectedIds.length === 0) return;
    setBusy(true);
    setErr("");
    try {
      await Promise.all(
        selectedIds.map(async (mailboxId) => {
          const res = await fetch("/api/mailboxes/throttle-clear", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mailboxId, campaignId: data.campaign.id }),
          });
          const j = await res.json();
          if (!res.ok || !j?.ok) throw new Error(j?.error || "FAILED");
        })
      );
      await refresh();
      setSelected({});
    } catch (e: any) {
      setErr(String(e?.message || e));
      setBusy(false);
    }
  }

  async function bulkWarmup(enabled: boolean) {
    if (selectedIds.length === 0) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/mailboxes/bulk-update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, patch: { warmupEnabled: enabled } }),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "FAILED");
      await refresh();
      setSelected({});
    } catch (e: any) {
      setErr(String(e?.message || e));
      setBusy(false);
    }
  }

  function exportCsv() {
    const headers = [
      "mailboxId",
      "name",
      "fromEmail",
      "isActive",
      "dailyLimit",
      "warmupEnabled",
      "healthScore",
      "healthBand",
      "sent24h",
      "sent7d",
      "queued",
      "failed24h",
      "hardBounces7d",
      "softBounces7d",
      "replies7d",
      "unsubs7d",
      "lastSentAt",
      "idleMinutes",
      "cooldownUntil",
      "cooldownReason",
      "excluded",
      "gmailSent7d",
      "gmailBounced7d",
      "yahooSent7d",
      "yahooBounced7d",
      "outlookSent7d",
      "outlookBounced7d",
      "otherSent7d",
      "otherBounced7d",
      "sentTrend7d",
    ];
    const lines = [headers.join(",")];
    for (const r of filtered) {
      const row = [
        r.mailboxId,
        r.name,
        r.fromEmail,
        r.isActive,
        r.dailyLimit,
        r.warmupEnabled,
        r.healthScore,
        r.healthBand,
        r.sent24h,
        r.sent7d,
        r.queued,
        r.failed24h,
        r.hardBounces7d,
        r.softBounces7d,
        r.replies7d,
        r.unsubs7d,
        r.lastSentAt || "",
        typeof r.idleMinutes === "number" ? r.idleMinutes : "",
        r.throttle?.until || "",
        r.throttle?.reason || "",
        r.excluded,
        r.domainBreakdown7d?.gmail?.sent ?? 0,
        r.domainBreakdown7d?.gmail?.bounced ?? 0,
        r.domainBreakdown7d?.yahoo?.sent ?? 0,
        r.domainBreakdown7d?.yahoo?.bounced ?? 0,
        r.domainBreakdown7d?.outlook?.sent ?? 0,
        r.domainBreakdown7d?.outlook?.bounced ?? 0,
        r.domainBreakdown7d?.other?.sent ?? 0,
        r.domainBreakdown7d?.other?.bounced ?? 0,
        (r.sentTrend7d || []).join("|"),
      ].map(csvEscape);
      lines.push(row.join(","));
    }
    downloadCsv(`campaign-${data.campaign.id}-mailboxes.csv`, lines.join("\n"));
  }

  async function openRoutingPreview() {
    setPreviewBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/campaigns/mailbox-routing-preview?campaignId=${encodeURIComponent(data.campaign.id)}`);
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "FAILED");
      setPreview(j.data as RoutingPreview);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setPreviewBusy(false);
    }
  }

  const allChecked = filtered.length > 0 && filtered.every((r) => selected[r.mailboxId]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge>Mailboxes: {data.totals.mailboxes}</Badge>
          <Badge>Throttled: {data.totals.throttled}</Badge>
          <Badge>Sent 24h: {data.totals.sent24h}</Badge>
          <Badge>Queued: {data.totals.queued}</Badge>
          <Badge>Fails 24h: {data.totals.failed24h}</Badge>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select value={filter} onChange={(e) => setFilter(e.target.value as any)} className="w-[160px]">
            <option value="all">All</option>
            <option value="risky">Risky only</option>
            <option value="throttled">Throttled only</option>
          </Select>

          <Select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="w-[160px]">
            <option value="health">Sort: Health</option>
            <option value="load">Sort: Load</option>
            <option value="sent24">Sort: Sent 24h</option>
            <option value="bounces">Sort: Bounces 7d</option>
            <option value="replies">Sort: Replies 7d</option>
            <option value="queue">Sort: Queue</option>
          </Select>

          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search mailboxes…" className="w-[220px]" />

          <Button type="button" variant="ghost" onClick={refresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </Button>

          <Button type="button" variant="ghost" onClick={openRoutingPreview} disabled={previewBusy}>
            {previewBusy ? "Loading…" : "Routing preview"}
          </Button>

          <Button type="button" variant="ghost" onClick={exportCsv}>
            Export CSV
          </Button>
        </div>
      </div>

      {err ? <div className="text-sm text-red-600 mb-3">{err}</div> : null}

      {selectedIds.length ? (
        <div className="mb-3 rounded-2xl border border-slate-200 bg-white/60 p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm">
            <span className="font-medium">{selectedIds.length}</span> selected
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => bulkWarmup(true)}>Warmup on</Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => bulkWarmup(false)}>Warmup off</Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => throttleSelected(15)}>Cooldown 15m</Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => throttleSelected(60)}>Cooldown 60m</Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => throttleSelected(180)}>Cooldown 180m</Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={clearSelectedCooldowns}>Clear cooldowns</Button>
            <Button type="button" variant="ghost" onClick={() => setSelected({})}>Clear selection</Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white/60">
        <table className="min-w-[1540px] w-full text-sm">
          <thead className="bg-slate-50/80">
            <tr className="text-left">
              <th className="p-3 w-[44px]">
                <Input type="checkbox" checked={allChecked} onChange={(e) => toggleAll(e.target.checked)} />
              </th>
              <th className="p-3">Mailbox</th>
              <th className="p-3">Health</th>
              <th className="p-3">Trend (7d)</th>
              <th className="p-3">Domains (7d)</th>
              <th className="p-3">Load (24h / limit)</th>
              <th className="p-3">Sent</th>
              <th className="p-3">Bounces (7d)</th>
              <th className="p-3">Replies (7d)</th>
              <th className="p-3">Queue</th>
              <th className="p-3">Last sent</th>
              <th className="p-3">Cooldown</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const tone = scoreTone(r.healthBand) as any;
              const limit = Math.max(1, Number(r.dailyLimit || 1));
              const loadPct = Math.min(100, Math.round((r.sent24h / limit) * 100));
              const healthPct = Math.min(100, Math.max(0, Math.round(r.healthScore)));
              const isChosen = preview?.chosenMailboxId && preview.chosenMailboxId === r.mailboxId;

              return (
                <tr key={r.mailboxId} className={`border-t border-slate-200 ${isChosen ? "bg-indigo-50/40" : ""}`}>
                  <td className="p-3">
                    <Input type="checkbox" checked={!!selected[r.mailboxId]} onChange={(e) => toggleOne(r.mailboxId, e.target.checked)} />
                  </td>

                  <td className="p-3">
                    <div className="font-medium truncate max-w-[260px]">{r.name}</div>
                    <div className="text-xs opacity-70 truncate max-w-[260px]">{r.fromEmail}</div>
                    <div className="mt-1 flex gap-1 flex-wrap">
                      <Pill tone={r.isActive ? "success" : "neutral"}>{r.isActive ? "active" : "inactive"}</Pill>
                      {r.warmupEnabled ? <Pill tone="info">warmup</Pill> : null}
                      {r.throttle ? <Pill tone="warning">throttled</Pill> : null}
                      {r.excluded ? <Pill tone="neutral">excluded</Pill> : null}
                      {isChosen ? <Pill tone="info">next pick</Pill> : null}
                    </div>
                  </td>

                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <Pill tone={tone}>Score {r.healthScore}</Pill>
                    </div>
                    <div className="mt-2 h-2 w-[160px] rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-2 bg-slate-900" style={{ width: `${healthPct}%` }} />
                    </div>
                    <div className="mt-2 text-xs opacity-70 max-w-[220px]">{r.notes?.[0] || ""}</div>
                  </td>

                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <div className="text-xs opacity-70">sent</div>
                      <Sparkline values={r.sentTrend7d || []} />
                    </div>
                  </td>

                  <td className="p-3">
                    <div className="text-xs">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-1 rounded-full bg-slate-100">G {r.domainBreakdown7d?.gmail?.sent ?? 0}/{r.domainBreakdown7d?.gmail?.bounced ?? 0}</span>
                        <span className="px-2 py-1 rounded-full bg-slate-100">O {r.domainBreakdown7d?.outlook?.sent ?? 0}/{r.domainBreakdown7d?.outlook?.bounced ?? 0}</span>
                        <span className="px-2 py-1 rounded-full bg-slate-100">Y {r.domainBreakdown7d?.yahoo?.sent ?? 0}/{r.domainBreakdown7d?.yahoo?.bounced ?? 0}</span>
                        <span className="px-2 py-1 rounded-full bg-slate-100">Other {r.domainBreakdown7d?.other?.sent ?? 0}/{r.domainBreakdown7d?.other?.bounced ?? 0}</span>
                      </div>
                      <div className="mt-1 opacity-60">sent/bounced</div>
                    </div>
                  </td>

                  <td className="p-3">
                    <div className="font-medium">{r.sent24h} / {r.dailyLimit}</div>
                    <div className="mt-2 h-2 w-[160px] rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-2 bg-slate-900" style={{ width: `${loadPct}%` }} />
                    </div>
                    <div className="mt-1 text-xs opacity-70">{loadPct}% of limit</div>
                  </td>

                  <td className="p-3">
                    <div className="font-medium">24h: {r.sent24h}</div>
                    <div className="text-xs opacity-70">7d: {r.sent7d}</div>
                    <div className="text-xs opacity-70">fails24h: {r.failed24h}</div>
                  </td>

                  <td className="p-3">
                    <div className="font-medium">hard: {r.hardBounces7d}</div>
                    <div className="text-xs opacity-70">soft: {r.softBounces7d}</div>
                    <div className="text-xs opacity-70">unsub: {r.unsubs7d}</div>
                  </td>

                  <td className="p-3">
                    <div className="font-medium">{r.replies7d}</div>
                  </td>

                  <td className="p-3">
                    <div className="font-medium">{r.queued}</div>
                  </td>

                  <td className="p-3">
                    <div className="text-xs">{fmtWhen(r.lastSentAt)}</div>
                    <div className="text-xs opacity-70">idle: {typeof r.idleMinutes === "number" ? `${r.idleMinutes}m` : "-"}</div>
                  </td>

                  <td className="p-3">
                    {r.throttle ? (
                      <div className="text-xs">
                        <div className="font-medium">until {fmtWhen(r.throttle.until)}</div>
                        {r.throttle.reason ? <div className="opacity-70 max-w-[220px] truncate">{r.throttle.reason}</div> : null}
                      </div>
                    ) : (
                      <div className="text-xs opacity-70">-</div>
                    )}
                  </td>

                  <td className="p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/app/mailboxes`}>
                        <Button type="button" variant="ghost">Open</Button>
                      </Link>
                      <Button type="button" variant="ghost" disabled={busy} onClick={() => setExcluded(r.mailboxId, !r.excluded)}>{r.excluded ? "Unexclude" : "Exclude"}</Button>
                      <Button type="button" variant="ghost" disabled={busy} onClick={() => throttleOne(r.mailboxId, 15)}>15m</Button>
                      <Button type="button" variant="ghost" disabled={busy} onClick={() => throttleOne(r.mailboxId, 60)}>60m</Button>
                      {r.throttle ? (
                        <Button type="button" variant="ghost" disabled={busy} onClick={() => clearThrottle(r.mailboxId)}>
                          Clear
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}

            {filtered.length === 0 ? (
              <tr>
                <td className="p-6 text-sm opacity-70" colSpan={13}>No mailboxes match your filters.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-xs opacity-60">
        Windows: last 24h and last 7d. Health score is a simple heuristic (bounces/unsubs/failures + cooldown penalty) so routing decisions are explainable.
      </div>

      {preview ? (
        <Modal
          title={`Routing preview: ${preview.strategy}${preview.strategy === "score_idle" ? ` (idle ${preview.mailboxMinIdleMinutes}m)` : ""}`}
          onClose={() => setPreview(null)}
          wide
          footer={
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm opacity-70">
                {preview.chosenMailboxId ? (
                  <span>
                    Next pick: <span className="font-medium">{preview.rows.find((r) => r.mailboxId === preview.chosenMailboxId)?.name || preview.chosenMailboxId}</span>
                  </span>
                ) : (
                  <span>No eligible mailbox found.</span>
                )}
                {preview.note ? <span className="ml-2">• {preview.note}</span> : null}
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" onClick={() => setPreview(null)}>Close</Button>
              </div>
            </div>
          }
        >
          <div className="text-sm">
            <div className="opacity-70">
              This shows how the worker would choose a mailbox right now (with a deterministic preview for random/weighted).
            </div>

            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white/60">
              <table className="min-w-[1100px] w-full text-sm">
                <thead className="bg-slate-50/80">
                  <tr className="text-left">
                    <th className="p-3">Mailbox</th>
                    <th className="p-3">Eligible</th>
                    <th className="p-3">Routing score</th>
                    <th className="p-3">Weight</th>
                    <th className="p-3">Last sent</th>
                    <th className="p-3">Cooldown</th>
                    <th className="p-3">Why/Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows
                    .slice()
                    .sort((a, b) => {
                      const ca = a.mailboxId === preview.chosenMailboxId ? -1 : 0;
                      const cb = b.mailboxId === preview.chosenMailboxId ? -1 : 0;
                      if (ca !== cb) return ca - cb;
                      const sa = typeof a.routingScore === "number" ? a.routingScore : 0;
                      const sb = typeof b.routingScore === "number" ? b.routingScore : 0;
                      return sa - sb;
                    })
                    .map((r) => {
                      const chosen = r.mailboxId === preview.chosenMailboxId;
                      return (
                        <tr key={r.mailboxId} className={`border-t border-slate-200 ${chosen ? "bg-indigo-50/40" : ""}`}>
                          <td className="p-3">
                            <div className="font-medium">{r.name}</div>
                            <div className="text-xs opacity-70">{r.fromEmail}</div>
                          </td>
                          <td className="p-3">
                            {r.eligible ? <Pill tone="success">yes</Pill> : <Pill tone="warning">no</Pill>}
                            {chosen ? <span className="ml-2"><Pill tone="info">chosen</Pill></span> : null}
                          </td>
                          <td className="p-3">
                            <div className="font-medium">{typeof r.routingScore === "number" ? r.routingScore : "-"}</div>
                            {preview.strategy === "score_idle" && !r.idleOk ? <div className="text-xs opacity-70">idle gate</div> : null}
                          </td>
                          <td className="p-3">{r.weight}</td>
                          <td className="p-3">
                            <div className="text-xs">{fmtWhen(r.lastSentAt)}</div>
                            <div className="text-xs opacity-70">idle: {typeof r.idleMinutes === "number" ? `${r.idleMinutes}m` : "-"}</div>
                          </td>
                          <td className="p-3">
                            {r.throttled ? (
                              <div className="text-xs">
                                <div className="font-medium">until {fmtWhen(r.throttled.until)}</div>
                                {r.throttled.reason ? <div className="opacity-70 max-w-[260px] truncate">{r.throttled.reason}</div> : null}
                              </div>
                            ) : (
                              <div className="text-xs opacity-70">-</div>
                            )}
                          </td>
                          <td className="p-3">
                            <div className="text-xs opacity-80 max-w-[380px]">
                              {r.reasons?.length ? r.reasons.join(" • ") : "-"}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
