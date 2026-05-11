"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button, Pill, Input, Select } from "@/components/ui";

type Asset = {
  type: "ip" | "domain";
  value: string;
  label: string;
  sources: string[];
  check?: any | null;
};

type Payload = {
  assets: Asset[];
  summary: any;
  pendingJob?: { id: string; status: string } | null;
  latestJob?: { id: string; status: string } | null;
};

function statusTone(status: string): "success" | "danger" | "warning" | "neutral" | "info" {
  if (status === "clear") return "success";
  if (status === "listed") return "danger";
  if (status === "warning" || status === "blocked" || status === "error") return "warning";
  if (status === "running" || status === "queued") return "info";
  return "neutral";
}

function statusLabel(status: string) {
  if (status === "listed") return "Listed";
  if (status === "clear") return "Clear";
  if (status === "warning") return "Provider warning";
  if (status === "blocked") return "Query blocked";
  if (status === "error") return "Lookup error";
  return "Not checked";
}

function niceTime(value?: string | null) {
  if (!value) return "Never";
  try { return new Date(value).toLocaleString(); } catch { return String(value); }
}

export default function BlacklistClient({ initial }: { initial: Payload }) {
  const [data, setData] = useState<Payload>(initial);
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(initial.pendingJob?.id || null);
  const [jobStatus, setJobStatus] = useState<string | null>(initial.pendingJob?.status || null);
  const [logs, setLogs] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");

  async function refreshList() {
    const res = await fetch("/api/blacklist/list", { cache: "no-store" });
    const json = await res.json();
    if (res.ok) setData(json);
    if (json?.pendingJob?.id) {
      setJobId(json.pendingJob.id);
      setJobStatus(json.pendingJob.status);
    }
  }

  async function startCheck() {
    setLoading(true);
    setLogs([]);
    try {
      const res = await fetch("/api/blacklist/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "all" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not start blacklist check");
      setJobId(json.jobId);
      setJobStatus(json.status || "queued");
      setLogs([`Queued blacklist check for ${json.targetCount || "all"} asset(s).`]);
    } catch (e: any) {
      setLogs([`Error: ${String(e?.message || e)}`]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/blacklist/check/status?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Status failed");
        if (stop) return;
        setJobStatus(json?.job?.status || null);
        setLogs((json?.logs || []).map((l: any) => String(l.line || "")));
        if (json?.job?.status === "done" || json?.job?.status === "failed") {
          await refreshList();
          return;
        }
        setTimeout(tick, 1800);
      } catch (e: any) {
        if (!stop) setLogs((prev) => [...prev, `Status error: ${String(e?.message || e)}`]);
      }
    };
    tick();
    return () => { stop = true; };
  }, [jobId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data.assets || []).filter((a) => {
      const st = String(a.check?.status || "unknown");
      if (type !== "all" && a.type !== type) return false;
      if (status !== "all" && st !== status) return false;
      if (q && !`${a.value} ${a.sources?.join(" ") || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data.assets, query, type, status]);

  const running = jobStatus === "queued" || jobStatus === "running";
  const s = data.summary || {};

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="Assets watched" value={s.total || 0} hint={`${s.domains || 0} domains · ${s.ips || 0} IPs`} />
        <Metric label="Listed" value={s.listed || 0} hint="needs immediate review" danger={Number(s.listed || 0) > 0} />
        <Metric label="Warnings" value={s.warning || 0} hint="provider/timeouts" warn={Number(s.warning || 0) > 0} />
        <Metric label="Last checked" value={s.lastCheckedAt ? "Recent" : "Never"} hint={niceTime(s.lastCheckedAt)} />
      </section>

      <section className="rounded-[2rem] border border-white/70 bg-white/82 p-5 shadow-[0_20px_70px_rgba(15,23,42,0.07)] backdrop-blur-xl">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">Blacklist operations</div>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-slate-950">Check every domain and sending IP</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              ColdMailPro collects your configured domains, MailStack tenant domains, outbound IP pool, tenant IPs, and mailbox bound IPs, then checks them against common DNSBL/URIBL providers.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={statusTone(running ? String(jobStatus) : String(s.status || "unknown"))}>{running ? `Check ${jobStatus}` : statusLabel(String(s.status || "unknown"))}</Pill>
            <Button variant="ghost" onClick={refreshList}>Refresh</Button>
            <Button onClick={startCheck} disabled={loading || running}>{running ? "Checking..." : "Check blacklist now"}</Button>
          </div>
        </div>

        {(running || logs.length > 0) ? (
          <div className="mt-5 rounded-[1.5rem] border border-slate-800 bg-slate-950 p-4 text-xs text-slate-200 shadow-inner">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="font-semibold text-white">Live check log</div>
              <div className="text-slate-400">{jobId ? `Job ${jobId.slice(0, 8)}` : "No job"}</div>
            </div>
            <div className="max-h-56 space-y-1 overflow-auto font-mono leading-5">
              {(logs.length ? logs : ["Waiting for worker..."]).map((line, i) => <div key={i}>{line}</div>)}
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-[2rem] border border-white/70 bg-white/82 p-5 shadow-[0_20px_70px_rgba(15,23,42,0.07)] backdrop-blur-xl">
        <div className="grid gap-3 lg:grid-cols-[1fr_180px_200px]">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search domain, IP, or source..." />
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">All assets</option>
            <option value="domain">Domains only</option>
            <option value="ip">IPs only</option>
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="listed">Listed</option>
            <option value="warning">Warnings</option>
            <option value="clear">Clear</option>
            <option value="unknown">Not checked</option>
          </Select>
        </div>

        <div className="mt-5 grid gap-4">
          {filtered.length ? filtered.map((asset) => <AssetCard key={`${asset.type}:${asset.value}`} asset={asset} />) : (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center text-sm text-slate-600">
              No blacklist assets match this filter.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, hint, danger = false, warn = false }: { label: string; value: React.ReactNode; hint: string; danger?: boolean; warn?: boolean }) {
  const bar = danger ? "from-red-600 to-rose-500" : warn ? "from-amber-500 to-orange-500" : "from-indigo-600 to-cyan-500";
  return (
    <div className="relative overflow-hidden rounded-[1.6rem] border border-white/70 bg-white/82 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.07)] backdrop-blur-xl">
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${bar}`} />
      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-2 font-display text-3xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 text-xs text-slate-600">{hint}</div>
    </div>
  );
}

function AssetCard({ asset }: { asset: Asset }) {
  const check = asset.check;
  const checks = Array.isArray(check?.checks) ? check.checks : [];
  const listedChecks = checks.filter((c: any) => c.status === "listed" && c.countedAsListed !== false);
  const blockedChecks = checks.filter((c: any) => c.status === "blocked");
  const errorChecks = checks.filter((c: any) => c.status === "error");
  const status = String(check?.status || "unknown");

  return (
    <article className="group rounded-[1.7rem] border border-slate-200/80 bg-white/82 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_22px_70px_rgba(15,23,42,0.09)] sm:p-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(280px,0.8fr)_minmax(260px,0.7fr)_minmax(420px,1.3fr)] xl:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-lg text-white">{asset.type === "ip" ? "🔢" : "🌐"}</span>
            <div className="min-w-0">
              <div className="break-all font-display text-lg font-semibold text-slate-950">{asset.value}</div>
              <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{asset.type === "ip" ? "Sending IP" : "Sending domain"}</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(asset.sources || []).map((src) => <span key={src} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">{src}</span>)}
          </div>
          {blockedChecks.length ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              <span className="font-semibold">Provider warning:</span> {blockedChecks.length} lookup(s) were blocked/advisory responses from the blacklist provider and are not counted as blacklist hits. This often happens when a DNSBL blocks public/open resolver queries.
            </div>
          ) : null}
        </div>

        <div className="rounded-3xl border border-slate-200/80 bg-slate-50/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Status</div>
            <Pill tone={statusTone(status)}>{statusLabel(status)}</Pill>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-2xl bg-white p-2 shadow-sm"><div className="font-semibold text-slate-950">{check?.providerCount ?? "—"}</div><div className="text-slate-500">providers</div></div>
            <div className="rounded-2xl bg-white p-2 shadow-sm"><div className="font-semibold text-red-600">{check?.listedCount ?? "—"}</div><div className="text-slate-500">confirmed</div></div>
            <div className="rounded-2xl bg-white p-2 shadow-sm"><div className="font-semibold text-amber-600">{check?.warningCount ?? check?.errorCount ?? "—"}</div><div className="text-slate-500">warnings</div></div>
          </div>
          <div className="mt-3 text-xs text-slate-500">Checked: {niceTime(check?.checkedAt)}</div>
          {listedChecks.length ? (
            <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800">
              Listed by: {listedChecks.map((c: any) => `${c.provider} (${c.zone})`).join(", ")}
            </div>
          ) : null}
        </div>

        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Provider-level DNSBL checks</div>
            {checks.length ? <span className="text-xs text-slate-500">{listedChecks.length} confirmed listed · {blockedChecks.length + errorChecks.length} warnings</span> : null}
          </div>
          <div className="mt-2 max-h-80 space-y-2 overflow-auto pr-1">
            {checks.length ? checks.map((c: any) => (
              <div key={`${c.providerId}-${c.query}`} className="rounded-2xl border border-slate-200 bg-white/80 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900">{c.provider}</div>
                    <div className="break-all text-[11px] uppercase tracking-[0.14em] text-slate-500">{c.zone}</div>
                  </div>
                  <Pill tone={statusTone(String(c.status))}>{statusLabel(String(c.status))}</Pill>
                </div>
                <div className="mt-2 grid gap-2 text-xs lg:grid-cols-[90px_1fr]">
                  <div className="font-semibold text-slate-500">Query</div>
                  <div className="break-all rounded-xl bg-slate-50 px-2 py-1 font-mono text-slate-700">{c.query}</div>
                  <div className="font-semibold text-slate-500">Response</div>
                  <div className="break-all rounded-xl bg-slate-50 px-2 py-1 font-mono text-slate-700">{Array.isArray(c.responses) && c.responses.length ? c.responses.join(", ") : "NXDOMAIN / no listing"}</div>
                </div>
                <div className="mt-2 text-xs leading-5 text-slate-600">{c.detail}</div>
              </div>
            )) : (
              <div className="rounded-2xl border border-slate-200 bg-white/80 p-3 text-sm text-slate-600">
                {status === "clear" ? "No blacklist hits found in the last check." : "Run a blacklist check to see provider-level details."}
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
