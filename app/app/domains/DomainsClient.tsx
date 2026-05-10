"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, Input, Pill, Kpi, Divider } from "@/components/ui";

type DomainHealth = {
  pending: boolean;
  checkedAt: string | null;
  status: "unknown" | "healthy" | "warning" | "fail";
  score: number;
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

function statusText(h: DomainHealth) {
  if (h.pending) return "Checking";
  if (h.status === "healthy") return "Healthy";
  if (h.status === "warning") return "Needs work";
  if (h.status === "fail") return "Misconfigured";
  return "Not checked";
}

function statusPill(h: DomainHealth) {
  if (h.pending) return <Pill tone="info">checking…</Pill>;
  if (h.status === "healthy") return <Pill tone="success">healthy</Pill>;
  if (h.status === "warning") return <Pill tone="warning">needs work</Pill>;
  if (h.status === "fail") return <Pill tone="danger">misconfigured</Pill>;
  return <Pill tone="neutral">not checked</Pill>;
}

function scoreClass(status: DomainHealth["status"], pending: boolean) {
  if (pending) return "from-indigo-500 to-sky-400";
  if (status === "healthy") return "from-emerald-500 to-teal-400";
  if (status === "warning") return "from-amber-500 to-orange-400";
  if (status === "fail") return "from-red-500 to-rose-500";
  return "from-slate-400 to-slate-300";
}

function scoreBar(h: DomainHealth) {
  const s = Math.max(0, Math.min(100, Math.round(h.score || 0)));
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>DNS score</span>
        <span className="font-semibold text-slate-700">{s}/100</span>
      </div>
      <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-200/80">
        <div className={`h-full rounded-full bg-gradient-to-r ${scoreClass(h.status, h.pending)}`} style={{ width: `${s}%` }} />
      </div>
    </div>
  );
}

function recPill(label: string, ok: boolean | null | undefined, detail?: string) {
  const tone = ok === true ? "success" : ok === false ? "danger" : "neutral";
  const text = ok === true ? `${label} ok` : ok === false ? `${label} fail` : `${label} —`;
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
    out.sort((a, b) => {
      const rank: Record<string, number> = { fail: 0, warning: 1, unknown: 2, healthy: 3 };
      return (rank[a.health?.status || "unknown"] ?? 2) - (rank[b.health?.status || "unknown"] ?? 2) || a.name.localeCompare(b.name);
    });
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
      setNotice("DNS check enqueued. This page auto-refreshes while checks complete.");
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
      setNotice("Rotate-now queued. Worker will apply the new outbound IP.");
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
        <div className="grid gap-3 sm:grid-cols-4 animate-pulse">
          <div className="glass h-[112px]" />
          <div className="glass h-[112px]" />
          <div className="glass h-[112px]" />
          <div className="glass h-[112px]" />
        </div>
        <div className="glass h-[260px] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <button type="button" onClick={() => setFilter("all")} className="text-left">
          <Kpi label="Domains" value={counts.all} hint="Total domain fleet" tone={filter === "all" ? "info" : "neutral"} />
        </button>
        <button type="button" onClick={() => setFilter("healthy")} className="text-left">
          <Kpi label="Healthy" value={counts.healthy} hint="Ready to send" tone={filter === "healthy" ? "success" : "neutral"} />
        </button>
        <button type="button" onClick={() => setFilter("warning")} className="text-left">
          <Kpi label="Needs work" value={counts.warning} hint="Fix DNS warnings" tone={filter === "warning" ? "warning" : "neutral"} />
        </button>
        <button type="button" onClick={() => setFilter("fail")} className="text-left">
          <Kpi label="Misconfigured" value={counts.fail} hint="Blocking issues" tone={filter === "fail" ? "danger" : "neutral"} />
        </button>
      </div>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50/80 p-3 text-sm text-red-800">{clip(error, 300)}</div> : null}
      {notice ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-3 text-sm text-emerald-800">{notice}</div> : null}

      <div className="rounded-[1.5rem] border border-slate-200/80 bg-white/78 p-3 shadow-sm backdrop-blur-xl">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search domains, tracking subdomains…" className="xl:max-w-md" />
          <div className="flex items-center gap-2 overflow-x-auto pb-1 xl:pb-0">
            {[
              ["all", `All ${counts.all}`, "info"],
              ["pending", `Checking ${counts.pending}`, "info"],
              ["healthy", "Healthy", "success"],
              ["warning", "Needs work", "warning"],
              ["fail", "Misconfigured", "danger"],
            ].map(([key, label, tone]) => (
              <button key={key} type="button" onClick={() => setFilter(key as any)} className="shrink-0">
                <Pill tone={filter === key ? (tone as any) : "neutral"}>{label}</Pill>
              </button>
            ))}
          </div>
          <div className="xl:ml-auto">
            <Button variant="ghost" onClick={() => refresh()}>Refresh</Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4">
        {view.map((r) => (
          <article key={r.id} className="group relative overflow-hidden rounded-[1.8rem] border border-white/70 bg-white/82 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.06)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:shadow-[0_24px_90px_rgba(15,23,42,0.1)]">
            <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${scoreClass(r.health.status, r.health.pending)}`} />
            <div className="grid gap-5 xl:grid-cols-[1fr_1.25fr_0.95fr] xl:items-start">
              <div>
                <div className="flex items-start gap-3">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-slate-950 text-lg font-semibold text-white shadow-lg">
                    {r.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/app/domains/${r.id}`} className="font-display text-lg font-semibold text-slate-950 hover:text-indigo-700">
                        {r.name}
                      </Link>
                      {statusPill(r.health)}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">
                      selector <span className="font-mono text-slate-700">{r.dkimSelector}</span>
                      {r.trackingSubdomain ? <span> · tracking <span className="font-mono text-slate-700">{r.trackingSubdomain}</span></span> : null}
                    </div>
                    {scoreBar(r.health)}
                  </div>
                </div>
              </div>

              <div className="grid gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {recPill("SPF", r.health.spf?.ok ?? null, r.health.spf?.detail)}
                  {recPill("DKIM", r.health.dkim?.ok ?? null, r.health.dkim?.detail)}
                  {recPill("DMARC", r.health.dmarc?.ok ?? null, r.health.dmarc?.detail)}
                  {recPill("MX", r.health.mx?.ok ?? null, r.health.mx?.detail)}
                </div>
                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 text-sm leading-6 text-slate-700">
                  {r.health.issues?.length ? clip(r.health.issues.join(" • "), 220) : `No DNS issues found for ${r.name}.`}
                </div>
              </div>

              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Mailstack</div>
                    {r.mailstack ? (
                      <div className="mt-1 font-semibold text-slate-900">{r.mailstack.tenantName || "Tenant"}</div>
                    ) : (
                      <div className="mt-1 text-slate-500">Not linked</div>
                    )}
                  </div>
                  <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Last check</div>
                    <div className="mt-1 font-semibold text-slate-900">{fmtWhen(r.health.checkedAt)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap xl:justify-end">
                  <Button variant="ghost" onClick={() => runCheck(r.id)} disabled={!!busy[r.id] || r.health.pending}>
                    {busy[r.id] || r.health.pending ? "Checking…" : "Check DNS"}
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
                    <Button>Open</Button>
                  </Link>
                  <Button variant="ghost" onClick={() => del(r.id, r.name)} disabled={!!busy[r.id]} className="text-red-700">
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>

      {view.length === 0 ? (
        <div className="rounded-[1.7rem] border border-dashed border-slate-200 bg-white/70 p-10 text-center">
          <div className="text-lg font-semibold text-slate-950">No matching domains</div>
          <p className="mt-1 text-sm text-slate-500">Try a different filter or add a new domain batch above.</p>
        </div>
      ) : null}
    </div>
  );
}
