"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, Input, Pill, Kpi, Divider } from "@/components/ui";

type DomainHealth = {
  pending: boolean;
  checkedAt: string | null;
  status: "unknown" | "healthy" | "warning" | "fail";
  score: number; // 0..100
  issues: string[];
  spf: { ok: boolean; detail?: string } | null;
  dkim: { ok: boolean; selector?: string; detail?: string } | null;
  dmarc: { ok: boolean; policy?: string; detail?: string } | null;
  mx: { ok: boolean; detail?: string } | null;
};

type DomainRow = {
  id: string;
  name: string;
  dkimSelector: string;
  trackingSubdomain: string | null;
  createdAt: string;
  health: DomainHealth;
  mailstack?: { tenantId: string; tenantName: string; ipCount: number } | null;
};

function fmtWhen(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function clip(s: string, n: number) {
  if (!s) return s;
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function statusPill(h: DomainHealth) {
  if (h.pending) return <Pill tone="info">checking…</Pill>;
  if (h.status === "healthy") return <Pill tone="success">healthy</Pill>;
  if (h.status === "warning") return <Pill tone="warning">needs work</Pill>;
  if (h.status === "fail") return <Pill tone="danger">misconfigured</Pill>;
  return <Pill tone="neutral">not checked</Pill>;
}

function scoreBar(score: number, status: DomainHealth["status"], pending: boolean) {
  const s = Math.max(0, Math.min(100, Math.round(score || 0)));
  const tone = pending
    ? "bg-indigo-500"
    : status === "healthy"
      ? "bg-emerald-500"
      : status === "warning"
        ? "bg-amber-500"
        : status === "fail"
          ? "bg-red-500"
          : "bg-slate-400";

  return (
    <div className="mt-2">
      <div className="h-2 w-28 rounded-full bg-slate-200/80 overflow-hidden">
        <div className={`${tone} h-full`} style={{ width: `${s}%` }} />
      </div>
      <div className="text-[11px] text-slate-600 mt-1">score {s}/100</div>
    </div>
  );
}

function recPill(label: string, ok: boolean | null | undefined, detail?: string) {
  const tone = ok === true ? "success" : ok === false ? "danger" : "neutral";
  const text = ok === true ? `${label}: ok` : ok === false ? `${label}: fail` : `${label}: —`;
  return (
    <span title={detail || ""}>
      <Pill tone={tone as any}>{text}</Pill>
    </span>
  );
}

export default function DomainsClient() {
  const [rows, setRows] = useState<DomainRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "healthy" | "warning" | "fail" | "pending">("all");
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/domains/list", { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { domains: DomainRow[] };
      setRows(data.domains || []);
    } catch (e: any) {
      setError(String(e?.message || e || "FAILED"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // auto-refresh so pending checks update
  useEffect(() => {
    const t = setInterval(() => refresh(), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.slice();
    if (filter !== "all") {
      out = out.filter((r) => {
        if (filter === "pending") return !!r.health?.pending;
        return r.health?.status === filter;
      });
    }
    if (needle) {
      out = out.filter((r) => r.name.toLowerCase().includes(needle) || (r.trackingSubdomain || "").toLowerCase().includes(needle));
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [rows, q, filter]);

  const counts = useMemo(() => {
    const c = { all: rows.length, healthy: 0, warning: 0, fail: 0, pending: 0 };
    for (const r of rows) {
      if (r.health?.pending) c.pending += 1;
      if (r.health?.status === "healthy") c.healthy += 1;
      if (r.health?.status === "warning") c.warning += 1;
      if (r.health?.status === "fail") c.fail += 1;
    }
    return c;
  }, [rows]);

  async function runCheck(domainId: string) {
    setNotice(null);
    setBusy((m) => ({ ...m, [domainId]: true }));
    try {
      const res = await fetch("/api/domains/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domainId }),
      });
      if (!res.ok) throw new Error(await res.text());
      setNotice("DNS check enqueued.");
      await refresh();
    } catch (e: any) {
      setError(String(e?.message || e || "FAILED"));
    } finally {
      setBusy((m) => ({ ...m, [domainId]: false }));
    }
  }

  async function rotateNow(tenantId: string, domainId: string) {
    setNotice(null);
    setBusy((m) => ({ ...m, [domainId]: true }));
    try {
      const res = await fetch("/api/mailstack/tenant/rotate", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(j?.error || j?.message || (await res.text())));
      setNotice("Rotate-now queued.");
      await refresh();
    } catch (e: any) {
      setError(String(e?.message || e || "FAILED"));
    } finally {
      setBusy((m) => ({ ...m, [domainId]: false }));
    }
  }

  async function del(domainId: string, domainName: string) {
    if (!confirm(`Delete ${domainName}? This will also remove any mailboxes using @${domainName} from the app.`)) return;
    setNotice(null);
    setBusy((m) => ({ ...m, [domainId]: true }));
    try {
      const res = await fetch("/api/domains/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domainId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(j?.error || (await res.text())));
      setNotice(`Deleted ${domainName}.`);
      await refresh();
    } catch (e: any) {
      setError(String(e?.message || e || "FAILED"));
    } finally {
      setBusy((m) => ({ ...m, [domainId]: false }));
    }
  }

  if (loading) {
    return (
      <div className="grid gap-4">
        <div className="grid sm:grid-cols-4 gap-3 animate-pulse">
          <div className="glass p-5 h-[90px]" />
          <div className="glass p-5 h-[90px]" />
          <div className="glass p-5 h-[90px]" />
          <div className="glass p-5 h-[90px]" />
        </div>
        <div className="glass p-5 h-[220px] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid sm:grid-cols-4 gap-3">
        <button type="button" onClick={() => setFilter("all")} className="text-left">
          <Kpi label="Domains" value={counts.all} hint="All domains" tone={filter === "all" ? "info" : "neutral"} />
        </button>
        <button type="button" onClick={() => setFilter("healthy")} className="text-left">
          <Kpi label="Healthy" value={counts.healthy} hint="Ready to send" tone={filter === "healthy" ? "success" : "neutral"} />
        </button>
        <button type="button" onClick={() => setFilter("warning")} className="text-left">
          <Kpi label="Needs work" value={counts.warning} hint="Fix DNS" tone={filter === "warning" ? "warning" : "neutral"} />
        </button>
        <button type="button" onClick={() => setFilter("fail")} className="text-left">
          <Kpi label="Misconfigured" value={counts.fail} hint="Blocking issues" tone={filter === "fail" ? "danger" : "neutral"} />
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50/60 p-3 text-sm text-red-800">{clip(error, 300)}</div>
      ) : null}
      {notice ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-emerald-800">{notice}</div>
      ) : null}

      <div className="flex items-center gap-2 flex-wrap">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search domains…" className="max-w-sm" />
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => setFilter("all")}>
            <Pill tone={filter === "all" ? "info" : "neutral"}>All</Pill>
          </button>
          <button type="button" onClick={() => setFilter("pending")}>
            <Pill tone={filter === "pending" ? "info" : "neutral"}>Checking ({counts.pending})</Pill>
          </button>
          <button type="button" onClick={() => setFilter("healthy")}>
            <Pill tone={filter === "healthy" ? "success" : "neutral"}>Healthy</Pill>
          </button>
          <button type="button" onClick={() => setFilter("warning")}>
            <Pill tone={filter === "warning" ? "warning" : "neutral"}>Needs work</Pill>
          </button>
          <button type="button" onClick={() => setFilter("fail")}>
            <Pill tone={filter === "fail" ? "danger" : "neutral"}>Misconfigured</Pill>
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" onClick={() => refresh()}>Refresh</Button>
        </div>
      </div>

      <Divider />

      <div className="table-wrap overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="table-head">
            <tr className="text-left">
              <th className="table-cell">Domain</th>
              <th className="table-cell">Health</th>
              <th className="table-cell">Mailstack</th>
              <th className="table-cell">Records</th>
              <th className="table-cell">Issues</th>
              <th className="table-cell">Last check</th>
              <th className="table-cell">Actions</th>
            </tr>
          </thead>
          <tbody>
            {view.map((r) => (
              <tr key={r.id} className="table-row">
                <td className="table-cell">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-slate-600 mt-0.5">
                    selector: <span className="font-mono">{r.dkimSelector}</span>
                    {r.trackingSubdomain ? (
                      <>
                        <span className="mx-1">•</span>
                        tracking: <span className="font-mono">{r.trackingSubdomain}</span>
                      </>
                    ) : null}
                  </div>
                </td>
                <td className="table-cell">
                  {statusPill(r.health)}
                  {scoreBar(r.health.score, r.health.status, r.health.pending)}
                </td>
                <td className="table-cell">
                  {r.mailstack ? (
                    <div className="text-xs">
                      <div className="font-medium">{r.mailstack.tenantName || "(tenant)"}</div>
                      <div className="text-slate-600 mt-0.5">IPs: {r.mailstack.ipCount}</div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">—</div>
                  )}
                </td>
                <td className="table-cell">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {recPill("SPF", r.health.spf?.ok ?? null, r.health.spf?.detail)}
                    {recPill("DKIM", r.health.dkim?.ok ?? null, r.health.dkim?.detail)}
                    {recPill("DMARC", r.health.dmarc?.ok ?? null, r.health.dmarc?.detail)}
                    {recPill("MX", r.health.mx?.ok ?? null, r.health.mx?.detail)}
                  </div>
                </td>
                <td className="table-cell">
                  <div className="text-xs text-slate-700">
                    {r.health.issues?.length ? clip(r.health.issues.join(" • "), 140) : "—"}
                  </div>
                </td>
                <td className="table-cell">
                  <div>{fmtWhen(r.health.checkedAt)}</div>
                </td>
                <td className="table-cell">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button variant="ghost" onClick={() => runCheck(r.id)} disabled={!!busy[r.id] || r.health.pending}>
                      {busy[r.id] || r.health.pending ? "Checking…" : "Check"}
                    </Button>
                    {r.mailstack?.tenantId ? (
                      <Button
                        variant="ghost"
                        onClick={() => rotateNow(r.mailstack!.tenantId, r.id)}
                        disabled={!!busy[r.id] || (r.mailstack?.ipCount || 0) < 2}
                        title={(r.mailstack?.ipCount || 0) < 2 ? "Add 2+ outbound IPs to enable rotation" : "Rotate outbound IP now"}
                      >
                        Rotate IP
                      </Button>
                    ) : null}
                    <Link href={`/app/domains/${r.id}`}>
                      <Button variant="ghost">Open</Button>
                    </Link>
                    <Button
                      variant="ghost"
                      onClick={() => del(r.id, r.name)}
                      disabled={!!busy[r.id]}
                      className="text-red-700"
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {view.length === 0 ? <div className="text-sm text-slate-600">No domains match your filters.</div> : null}
    </div>
  );
}
