"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button, Input, Pill } from "@/components/ui";

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

  if (loading) return <div className="text-sm opacity-70">Loading…</div>;
  if (error) return <div className="text-sm text-red-700">{clip(error, 300)}</div>;

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search domains…" className="max-w-sm" />
        <select
          className="h-10 px-3 rounded-xl border border-slate-200 bg-white text-sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value as any)}
        >
          <option value="all">All</option>
          <option value="healthy">Healthy</option>
          <option value="warning">Needs work</option>
          <option value="fail">Misconfigured</option>
          <option value="pending">Checking…</option>
        </select>
        <Button variant="ghost" onClick={() => refresh()}>Refresh</Button>
        {notice ? <span className="text-sm text-emerald-700">{notice}</span> : null}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-slate-200">
              <th className="py-2 pr-3">Domain</th>
              <th className="py-2 pr-3">Health</th>
              <th className="py-2 pr-3">Mailstack</th>
              <th className="py-2 pr-3">Records</th>
              <th className="py-2 pr-3">Issues</th>
              <th className="py-2 pr-3">Last check</th>
              <th className="py-2 pr-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {view.map((r) => (
              <tr key={r.id} className="border-b border-slate-100">
                <td className="py-2 pr-3">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs opacity-70">selector: {r.dkimSelector}{r.trackingSubdomain ? ` • tracking: ${r.trackingSubdomain}` : ""}</div>
                </td>
                <td className="py-2 pr-3">
                  {statusPill(r.health)}
                  <div className="text-xs opacity-60 mt-1">score: {Math.round(r.health.score || 0)}/100</div>
                </td>
                <td className="py-2 pr-3">
                  {r.mailstack ? (
                    <div className="text-xs">
                      <div className="font-medium">{r.mailstack.tenantName || "(tenant)"}</div>
                      <div className="opacity-70">IPs: {r.mailstack.ipCount}</div>
                    </div>
                  ) : (
                    <div className="text-xs opacity-60">—</div>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-1 flex-wrap">
                    {recPill("SPF", r.health.spf?.ok ?? null, r.health.spf?.detail)}
                    {recPill("DKIM", r.health.dkim?.ok ?? null, r.health.dkim?.detail)}
                    {recPill("DMARC", r.health.dmarc?.ok ?? null, r.health.dmarc?.detail)}
                    {recPill("MX", r.health.mx?.ok ?? null, r.health.mx?.detail)}
                  </div>
                </td>
                <td className="py-2 pr-3">
                  <div className="text-xs opacity-80">
                    {r.health.issues?.length ? clip(r.health.issues.join(" • "), 140) : "—"}
                  </div>
                </td>
                <td className="py-2 pr-3">
                  <div>{fmtWhen(r.health.checkedAt)}</div>
                </td>
                <td className="py-2 pr-3">
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
                    <a className="text-indigo-700 underline" href={`/app/domains/${r.id}`}>Open</a>
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

      {view.length === 0 ? <div className="text-sm opacity-70">No domains match your filters.</div> : null}
    </div>
  );
}
