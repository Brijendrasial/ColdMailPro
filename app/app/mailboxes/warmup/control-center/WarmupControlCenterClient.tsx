"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, Card, Divider, Input, Kpi, Pill } from "@/components/ui";

type Overview = {
  worker: { lastHeartbeatAt: string | null; lastHeartbeatAgeSec: number | null; alive: boolean; meta?: any };
  activeWarmupMailboxes: number;
  placement7d: { inbox: number; spam: number; unknown: number };
  warmupJobs: { queued: number; running: number; done: number; failed: number };
  recentFailed: Array<{ id: string; type: string; attempts: number; runAt: string; createdAt: string; lastError: string | null }>;
};

type MailboxRow = {
  id: string;
  name: string;
  fromEmail: string;
  isActive: boolean;
  warmupEnabled: boolean;
  hasImap: boolean;
  profile: any | null;
  lastOutboundAt: string | null;
  lastInboundAt: string | null;
  placement7d: { inbox: number; spam: number; unknown: number };
  lastPlacementCheckAt?: string | null;
  lastPlacementCheckStatus?: string | null;
  unknownReason?: string | null;
};

type EventLine = { ts: string; jobId: string | null; jobType: string; jobStatus: string | null; line: string };

// Next.js route handlers can occasionally return empty bodies (eg. 204s, proxy errors, aborted responses).
// Calling response.json() would crash the page with: "JSON.parse: unexpected end of data".
// This helper makes all fetches resilient and surfaces a usable error object instead.
async function safeFetchJson(url: string, init?: RequestInit) {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e: any) {
    return { ok: false, error: `NETWORK_ERROR: ${String(e?.message || e)}` };
  }

  let text = "";
  try {
    text = await res.text();
  } catch {
    text = "";
  }

  if (!text || !text.trim()) {
    return { ok: false, error: `EMPTY_RESPONSE (${res.status})` };
  }

  try {
    const data = JSON.parse(text);
    // Preserve non-2xx status as an error while still returning payload.
    if (!res.ok && data && typeof data === "object" && !("ok" in data)) {
      (data as any).ok = false;
    }
    return data;
  } catch {
    // When the server returns HTML (eg. 500 page), show a short preview.
    const preview = text.slice(0, 200).replace(/\s+/g, " ");
    return { ok: false, error: `BAD_JSON (${res.status}): ${preview}` };
  }
}

function fmtTs(v: any) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

function toneForMailbox(mb: MailboxRow): "success" | "warning" | "danger" | "neutral" {
  if (!mb.isActive) return "neutral";
  if (!mb.warmupEnabled) return "neutral";
  if (!mb.hasImap) return "warning";
  const total = (mb.placement7d?.inbox || 0) + (mb.placement7d?.spam || 0) + (mb.placement7d?.unknown || 0);
  if (!total) return "warning";
  const unk = (mb.placement7d?.unknown || 0) / total;
  const spam = (mb.placement7d?.spam || 0) / total;
  if (spam > 0.25) return "danger";
  if (unk > 0.25) return "warning";
  return "success";
}

export default function WarmupControlCenterClient() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [mailboxes, setMailboxes] = useState<MailboxRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const [logMailboxId, setLogMailboxId] = useState<string>("");
  const [lines, setLines] = useState<EventLine[]>([]);
  const [logLoading, setLogLoading] = useState(false);

  async function refreshAll() {
    setLoading(true);
    try {
      const [o, m] = await Promise.all([
        safeFetchJson("/api/warmup/control-center/overview", { cache: "no-store" }),
        safeFetchJson("/api/warmup/control-center/mailboxes", { cache: "no-store" }),
      ]);
      if (o?.ok) setOverview(o);
      else {
        console.error("control-center overview error", o);
        // Keep old overview, but don't crash.
      }
      if (m?.ok) setMailboxes(m.mailboxes || []);
      else {
        console.error("control-center mailboxes error", m);
        setMailboxes([]);
      }
    } finally {
      setLoading(false);
    }
  }

  async function refreshLogs(targetMailboxId?: string) {
    setLogLoading(true);
    try {
      const qs = new URLSearchParams();
      if (targetMailboxId) qs.set("mailboxId", targetMailboxId);
      qs.set("take", "200");
      const res = await safeFetchJson(`/api/warmup/control-center/events?${qs.toString()}`, { cache: "no-store" });
      if (res?.ok) setLines(res.lines || []);
      else {
        console.error("control-center events error", res);
        setLines([]);
      }
    } finally {
      setLogLoading(false);
    }
  }

  useEffect(() => {
    refreshAll();
    refreshLogs("");
  }, []);

  async function doAction(action: string, mailboxId?: string) {
    const key = `${action}:${mailboxId || ""}`;
    setActionBusy(key);
    try {
      const res = await safeFetchJson("/api/warmup/control-center/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, mailboxId }),
      });

      if (action === "test_imap") {
        if (res?.ok) {
          alert(`IMAP OK\n\nFolders found: ${(res.folders || []).length}`);
        } else {
          alert(`IMAP failed: ${res?.error || "unknown"}`);
        }
      }

      await refreshAll();
      await refreshLogs(logMailboxId || "");
    } finally {
      setActionBusy(null);
    }
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return mailboxes;
    return mailboxes.filter((m) => (m.name || "").toLowerCase().includes(s) || (m.fromEmail || "").toLowerCase().includes(s));
  }, [mailboxes, q]);

  const workerPill = useMemo(() => {
    const alive = overview?.worker?.alive;
    if (alive) return <Pill tone="success">worker: alive</Pill>;
    if (overview?.worker?.lastHeartbeatAt) return <Pill tone="warning">worker: stale</Pill>;
    return <Pill tone="danger">worker: unknown</Pill>;
  }, [overview]);

  return (
    <div className="space-y-4">
      <Card
        title="Overview"
        subtitle="High-level warmup health for this workspace"
        right={
          <div className="flex items-center gap-2">
            {workerPill}
            <Button variant="ghost" onClick={() => refreshAll()} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
            <Button variant="secondary" onClick={() => doAction("force_mailbox_check")} disabled={!!actionBusy}>
              Run placement check
            </Button>
            <Button variant="secondary" onClick={() => doAction("force_seed_check")} disabled={!!actionBusy}>
              Run seed check
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="Active warmup mailboxes" value={overview?.activeWarmupMailboxes ?? "—"} />
          <Kpi label="Placement 7d: inbox" value={overview?.placement7d?.inbox ?? "—"} />
          <Kpi label="Placement 7d: spam" value={overview?.placement7d?.spam ?? "—"} />
          <Kpi label="Placement 7d: unknown" value={overview?.placement7d?.unknown ?? "—"} />
        </div>

        <Divider className="my-4" />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Kpi label="Jobs queued" value={overview?.warmupJobs?.queued ?? "—"} />
          <Kpi label="Jobs running" value={overview?.warmupJobs?.running ?? "—"} />
          <Kpi label="Jobs failed" value={overview?.warmupJobs?.failed ?? "—"} />
          <Kpi label="Last heartbeat" value={overview?.worker?.lastHeartbeatAt ? fmtTs(overview.worker.lastHeartbeatAt) : "—"} />
        </div>

        {overview?.recentFailed?.length ? (
          <>
            <Divider className="my-4" />
            <div className="text-sm font-medium text-slate-800 mb-2">Recent failed warmup jobs</div>
            <div className="space-y-2">
              {overview.recentFailed.slice(0, 5).map((j) => (
                <div key={j.id} className="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-slate-900">{j.type}</div>
                    <div className="text-xs text-slate-500">{fmtTs(j.createdAt)}</div>
                  </div>
                  <div className="text-xs text-slate-600 mt-1 whitespace-pre-wrap break-words">{(j.lastError || "").slice(0, 400) || "—"}</div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </Card>

      <Card
        title="Mailbox health"
        subtitle="Warmup + IMAP status per mailbox (unknown placement is usually IMAP not configured or not scanning the right folders)"
        right={
          <div className="flex items-center gap-2">
            <div className="w-72 hidden sm:block">
              <Input placeholder="Search mailbox…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Link href="/app/mailboxes/warmup" className="text-sm text-indigo-700 hover:underline">
              Back to Warmup
            </Link>
          </div>
        }
      >
        <div className="sm:hidden mb-3">
          <Input placeholder="Search mailbox…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2">Mailbox</th>
                <th className="py-2">Warmup</th>
                <th className="py-2">IMAP</th>
                <th className="py-2">Placement (7d)</th>
                <th className="py-2">Last activity</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((mb) => {
                const tone = toneForMailbox(mb);
                const key = (a: string) => `${a}:${mb.id}`;
                return (
                  <tr key={mb.id} className="border-b border-slate-100">
                    <td className="py-3">
                      <div className="font-medium text-slate-900">{mb.name}</div>
                      <div className="text-xs text-slate-500">{mb.fromEmail}</div>
                    </td>
                    <td className="py-3">
                      {mb.warmupEnabled ? <Pill tone={tone === "danger" ? "danger" : tone === "warning" ? "warning" : "success"}>enabled</Pill> : <Pill tone="neutral">paused</Pill>}
                      {!mb.isActive ? <div className="mt-1"><Pill tone="neutral">inactive</Pill></div> : null}
                    </td>
                    <td className="py-3">
                      {mb.hasImap ? <Pill tone="success">configured</Pill> : <Pill tone="warning">missing</Pill>}
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Pill tone="success">inbox {mb.placement7d?.inbox || 0}</Pill>
                        <Pill tone="danger">spam {mb.placement7d?.spam || 0}</Pill>
                        <Pill tone="neutral">unknown {mb.placement7d?.unknown || 0}</Pill>
                      </div>
                      {mb.unknownReason ? (
                        <div className="mt-2 text-xs text-slate-600 whitespace-pre-wrap break-words">
                          <span className="font-medium">Why:</span> {mb.unknownReason}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-3 text-xs text-slate-600">
                      <div>out: {fmtTs(mb.lastOutboundAt)}</div>
                      <div>in: {fmtTs(mb.lastInboundAt)}</div>
                      <div>
                        placement check: {mb.lastPlacementCheckAt ? fmtTs(mb.lastPlacementCheckAt) : "—"}{" "}
                        {mb.lastPlacementCheckStatus ? `(${mb.lastPlacementCheckStatus})` : ""}
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center justify-end gap-2 flex-wrap">
                        {mb.warmupEnabled ? (
                          <Button variant="ghost" onClick={() => doAction("pause_mailbox", mb.id)} disabled={actionBusy === key("pause_mailbox")}>
                            Pause
                          </Button>
                        ) : (
                          <Button variant="secondary" onClick={() => doAction("resume_mailbox", mb.id)} disabled={actionBusy === key("resume_mailbox")}>
                            Resume
                          </Button>
                        )}
                        <Button variant="ghost" onClick={() => doAction("force_warmup_tick", mb.id)} disabled={actionBusy === key("force_warmup_tick")}>
                          Send tick
                        </Button>
                        <Button variant="ghost" onClick={() => doAction("test_imap", mb.id)} disabled={actionBusy === key("test_imap")}>
                          Test IMAP
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setLogMailboxId(mb.id);
                            refreshLogs(mb.id);
                          }}
                        >
                          View logs
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!filtered.length ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-sm text-slate-500">
                    No mailboxes found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Logs"
        subtitle="Recent warmup worker + job logs (filter to a mailbox to see why placement/star didn’t update)"
        right={
          <div className="flex items-center gap-2">
            <select
              className="px-3 py-2 rounded-xl border border-slate-200 bg-white/70 text-sm"
              value={logMailboxId}
              onChange={(e) => {
                const id = e.target.value;
                setLogMailboxId(id);
                refreshLogs(id);
              }}
            >
              <option value="">All mailboxes</option>
              {mailboxes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <Button variant="ghost" onClick={() => refreshLogs(logMailboxId)} disabled={logLoading}>
              {logLoading ? "Loading…" : "Refresh logs"}
            </Button>
          </div>
        }
      >
        <div className="rounded-xl border border-slate-200 bg-slate-950 text-slate-100 p-3 text-xs overflow-x-auto">
          <pre className="whitespace-pre-wrap break-words">
            {(lines || []).slice(0, 200).map((l, idx) => {
              const head = `${fmtTs(l.ts)}  ${l.jobType}${l.jobStatus ? ` (${l.jobStatus})` : ""}`;
              return `${head}\n${l.line}\n`;
            }).join("\n") || "(no logs yet)"}
          </pre>
        </div>
      </Card>
    </div>
  );
}
