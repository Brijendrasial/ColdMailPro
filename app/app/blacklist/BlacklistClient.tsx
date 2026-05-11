"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button, Pill, Input, Select, Textarea } from "@/components/ui";

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

function severityTone(severity?: string): "success" | "danger" | "warning" | "neutral" | "info" {
  if (severity === "critical" || severity === "high") return "danger";
  if (severity === "medium" || severity === "advisory") return "warning";
  if (severity === "clear") return "success";
  return "neutral";
}

function downloadText(filename: string, content: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: any) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function exportAssetsCsv(assets: Asset[]) {
  const rows = [
    ["type", "value", "status", "score", "severity", "confirmed_hits", "warnings", "sources", "last_checked", "diagnosis"],
    ...assets.map((a) => [
      a.type,
      a.value,
      a.check?.status || "unknown",
      a.check?.reputationScore ?? "",
      a.check?.severity || "",
      a.check?.listedCount ?? "",
      a.check?.warningCount ?? "",
      (a.sources || []).join("; "),
      a.check?.checkedAt || "",
      a.check?.aiDiagnosis || "",
    ]),
  ];
  downloadText(`coldmailpro-blacklist-report-${new Date().toISOString().slice(0,10)}.csv`, rows.map((r) => r.map(csvCell).join(",")).join("\n"), "text/csv;charset=utf-8");
}

function exportAssetsJson(assets: Asset[], summary: any) {
  downloadText(`coldmailpro-blacklist-report-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), summary, assets }, null, 2), "application/json;charset=utf-8");
}

export default function BlacklistClient({ initial }: { initial: Payload }) {
  const [data, setData] = useState<Payload>(initial);
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(initial.pendingJob?.id || null);
  const [jobStatus, setJobStatus] = useState<string | null>(initial.pendingJob?.status || null);
  const [logs, setLogs] = useState<string[]>([]);
  const [manualInput, setManualInput] = useState("");
  const [manualType, setManualType] = useState("auto");
  const [manualJobId, setManualJobId] = useState<string | null>(null);
  const [manualJobStatus, setManualJobStatus] = useState<string | null>(null);
  const [manualLogs, setManualLogs] = useState<string[]>([]);
  const [manualResults, setManualResults] = useState<any[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
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

  function parseManualTargets() {
    return manualInput
      .split(/[\n,;\s]+/g)
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 25)
      .map((value) => ({ type: manualType, value }));
  }

  async function startManualCheck() {
    const customTargets = parseManualTargets();
    if (!customTargets.length) {
      setManualLogs(["Enter at least one domain or IPv4 address to test."]);
      return;
    }
    setManualLoading(true);
    setManualLogs([]);
    setManualResults([]);
    try {
      const res = await fetch("/api/blacklist/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customTargets }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not start manual blacklist lookup");
      setManualJobId(json.jobId);
      setManualJobStatus(json.status || "queued");
      setManualLogs([`Queued manual lookup for ${json.targetCount || customTargets.length} custom asset(s).`]);
    } catch (e: any) {
      setManualLogs([`Error: ${String(e?.message || e)}`]);
    } finally {
      setManualLoading(false);
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

  useEffect(() => {
    if (!manualJobId) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/blacklist/check/status?jobId=${encodeURIComponent(manualJobId)}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Manual lookup status failed");
        if (stop) return;
        setManualJobStatus(json?.job?.status || null);
        setManualLogs((json?.logs || []).map((l: any) => String(l.line || "")));
        if (Array.isArray(json?.result?.results)) setManualResults(json.result.results);
        if (json?.job?.status === "done" || json?.job?.status === "failed") return;
        setTimeout(tick, 1800);
      } catch (e: any) {
        if (!stop) setManualLogs((prev) => [...prev, `Manual status error: ${String(e?.message || e)}`]);
      }
    };
    tick();
    return () => { stop = true; };
  }, [manualJobId]);

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
        <Metric label="Reputation score" value={s.fleetScore ?? "—"} hint="fleet average /100" warn={Number(s.fleetScore || 100) < 90} danger={Number(s.fleetScore || 100) < 70} />
        <Metric label="Confirmed hits" value={s.listed || 0} hint="high-confidence listings" danger={Number(s.listed || 0) > 0} />
        <Metric label="Warnings" value={s.warning || 0} hint="resolver/provider/config" warn={Number(s.warning || 0) > 0} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[2rem] border border-white/70 bg-white/82 p-5 shadow-[0_20px_70px_rgba(15,23,42,0.07)] backdrop-blur-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">Reputation intelligence</div>
              <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-slate-950">Risk, impact, and exportable reports</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">ColdMailPro now combines DNSBL hits, resolver warnings, PTR/rDNS, SMTP banner checks, SPF/DMARC signals, and asset impact into one reputation score.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => exportAssetsCsv(filtered)}>Export CSV</Button>
              <Button variant="ghost" onClick={() => exportAssetsJson(filtered, s)}>Export JSON</Button>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <MiniInsight label="Critical assets" value={s.criticalAssets || 0} tone={Number(s.criticalAssets || 0) ? "danger" : "success"} />
            <MiniInsight label="High-risk assets" value={s.highRiskAssets || 0} tone={Number(s.highRiskAssets || 0) ? "warning" : "success"} />
            <MiniInsight label="Last checked" value={s.lastCheckedAt ? "Recent" : "Never"} hint={niceTime(s.lastCheckedAt)} tone="info" />
          </div>
        </div>

        <ResolverHealthCard diagnostics={s.resolverDiagnostics} />
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


      <ManualLookupPanel
        manualInput={manualInput}
        setManualInput={setManualInput}
        manualType={manualType}
        setManualType={setManualType}
        startManualCheck={startManualCheck}
        manualLoading={manualLoading}
        manualJobStatus={manualJobStatus}
        manualJobId={manualJobId}
        manualLogs={manualLogs}
        manualResults={manualResults}
      />

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



function MiniInsight({ label, value, hint, tone = "info" }: { label: string; value: React.ReactNode; hint?: string; tone?: "success" | "warning" | "danger" | "info" }) {
  const cls = tone === "danger" ? "text-red-700 bg-red-50 border-red-100" : tone === "warning" ? "text-amber-700 bg-amber-50 border-amber-100" : tone === "success" ? "text-emerald-700 bg-emerald-50 border-emerald-100" : "text-sky-700 bg-sky-50 border-sky-100";
  return (
    <div className={`rounded-2xl border p-3 ${cls}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-75">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint ? <div className="mt-1 text-xs opacity-80">{hint}</div> : null}
    </div>
  );
}

function ResolverHealthCard({ diagnostics }: { diagnostics?: any }) {
  const tests = Array.isArray(diagnostics?.tests) ? diagnostics.tests : [];
  const status = String(diagnostics?.status || "unknown");
  return (
    <div className="rounded-[2rem] border border-white/70 bg-white/82 p-5 shadow-[0_20px_70px_rgba(15,23,42,0.07)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">Resolver diagnostics</div>
          <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-slate-950">Provider test mode</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Confirms whether your DNS resolver can perform blacklist lookups without provider policy blocks.</p>
        </div>
        <Pill tone={statusTone(status === "pass" ? "clear" : status === "unknown" ? "unknown" : "warning")}>{status === "pass" ? "Healthy" : status === "unknown" ? "Not tested" : "Review"}</Pill>
      </div>
      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 text-xs text-slate-600">
        Resolver: <span className="font-mono font-semibold text-slate-900">{diagnostics?.resolver || "not checked"}</span>
      </div>
      <div className="mt-3 space-y-2">
        {tests.length ? tests.map((t: any) => (
          <div key={t.id || t.query} className="rounded-2xl border border-slate-200 bg-white/80 p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-slate-900">{t.label}</div>
              <Pill tone={t.status === "pass" ? "success" : t.status === "error" ? "danger" : "warning"}>{t.status}</Pill>
            </div>
            <div className="mt-2 break-all font-mono text-slate-600">{t.query}</div>
            <div className="mt-1 break-all text-slate-600">Output: {t.rawOutput}</div>
            <div className="mt-1 text-slate-500">{t.detail}</div>
          </div>
        )) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">Run a blacklist check to test the resolver.</div>
        )}
      </div>
    </div>
  );
}

function ManualLookupPanel({
  manualInput,
  setManualInput,
  manualType,
  setManualType,
  startManualCheck,
  manualLoading,
  manualJobStatus,
  manualJobId,
  manualLogs,
  manualResults,
}: {
  manualInput: string;
  setManualInput: (value: string) => void;
  manualType: string;
  setManualType: (value: string) => void;
  startManualCheck: () => void;
  manualLoading: boolean;
  manualJobStatus: string | null;
  manualJobId: string | null;
  manualLogs: string[];
  manualResults: any[];
}) {
  const running = manualJobStatus === "queued" || manualJobStatus === "running";
  const status = running ? manualJobStatus : manualResults.length ? summarizeManualStatus(manualResults) : "unknown";

  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/82 p-5 shadow-[0_20px_70px_rgba(15,23,42,0.07)] backdrop-blur-xl">
      <div className="grid gap-5 xl:grid-cols-[minmax(360px,0.95fr)_minmax(420px,1.05fr)] xl:items-start">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">Manual blacklist lookup</div>
          <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-slate-950">Test any custom domain or IP</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Paste domains or IPv4 addresses that are not saved in ColdMailPro. The lookup uses the same providers, resolver, raw DNS output, and interpretation rules as the fleet monitor.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-[180px_1fr]">
            <Select value={manualType} onChange={(e) => setManualType(e.target.value)}>
              <option value="auto">Auto-detect</option>
              <option value="domain">Domain only</option>
              <option value="ip">IP only</option>
            </Select>
            <Textarea
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder={"example.com\n46.105.154.97\n51.38.27.217"}
              className="min-h-[120px] font-mono text-sm"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={startManualCheck} disabled={manualLoading || running}>{running ? "Testing..." : "Test custom assets"}</Button>
            <Pill tone={statusTone(String(status))}>{running ? `Manual ${manualJobStatus}` : statusLabel(String(status))}</Pill>
            {manualJobId ? <span className="text-xs text-slate-500">Job {manualJobId.slice(0, 8)}</span> : null}
          </div>

          <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3 text-xs leading-5 text-indigo-900">
            Manual tests are not added to your Domains, Mailboxes, or MailStack assets. They are saved only in this lookup job audit log.
          </div>
        </div>

        <div className="space-y-4">
          {(running || manualLogs.length > 0) ? (
            <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950 p-4 text-xs text-slate-200 shadow-inner">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="font-semibold text-white">Manual lookup log</div>
                <div className="text-slate-400">{manualJobId ? `Job ${manualJobId.slice(0, 8)}` : "No job"}</div>
              </div>
              <div className="max-h-64 space-y-1 overflow-auto font-mono leading-5">
                {(manualLogs.length ? manualLogs : ["Waiting for worker..."]).map((line, i) => <div key={i}>{line}</div>)}
              </div>
            </div>
          ) : (
            <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50/80 p-6 text-sm leading-6 text-slate-600">
              Run a manual lookup to see the full provider-by-provider audit trail here.
            </div>
          )}

          {manualResults.length ? (
            <div className="grid gap-3">
              {manualResults.map((result: any) => (
                <AssetCard
                  key={`manual:${result.type}:${result.value}`}
                  asset={{ type: result.type, value: result.value, label: result.label || result.value, sources: result.sources || ["Manual lookup"], check: result }}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function summarizeManualStatus(results: any[]) {
  if (results.some((r) => r?.status === "listed")) return "listed";
  if (results.some((r) => r?.status === "warning")) return "warning";
  if (results.length && results.every((r) => r?.status === "clear")) return "clear";
  return "unknown";
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
  const diagnostics = Array.isArray(check?.diagnostics?.checks) ? check.diagnostics.checks : [];
  const recommendations = Array.isArray(check?.recommendations) ? check.recommendations : [];
  const delistingLinks = Array.isArray(check?.delistingLinks) ? check.delistingLinks : [];

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
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 text-xs leading-5 text-slate-600">
            <div className="font-semibold text-slate-900">Impact view</div>
            <div className="mt-1">Related sources: {(asset.sources || []).join(", ") || "Manual/custom lookup"}</div>
            <div className="mt-1">Blast-radius hint: {check?.impact?.relatedCount || (asset.sources || []).length || 1} mapped source(s). Use this to decide which domains, mailboxes, campaigns, or MailStack tenant paths to pause first.</div>
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
          <div className="mt-3 rounded-2xl bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Reputation score</div>
                <div className="mt-1 text-3xl font-semibold text-slate-950">{check?.reputationScore ?? "—"}<span className="text-sm text-slate-400">/100</span></div>
              </div>
              <Pill tone={severityTone(String(check?.severity || "unknown"))}>{check?.severity || "not scored"}</Pill>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-gradient-to-r from-red-500 via-amber-400 to-emerald-500" style={{ width: `${Math.max(0, Math.min(100, Number(check?.reputationScore || 0)))}%` }} />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-2xl bg-white p-2 shadow-sm"><div className="font-semibold text-slate-950">{check?.providerCount ?? "—"}</div><div className="text-slate-500">providers</div></div>
            <div className="rounded-2xl bg-white p-2 shadow-sm"><div className="font-semibold text-red-600">{check?.listedCount ?? "—"}</div><div className="text-slate-500">confirmed</div></div>
            <div className="rounded-2xl bg-white p-2 shadow-sm"><div className="font-semibold text-amber-600">{check?.warningCount ?? check?.errorCount ?? "—"}</div><div className="text-slate-500">warnings</div></div>
          </div>
          <div className="mt-3 text-xs text-slate-500">Checked: {niceTime(check?.checkedAt)}</div>
          {check?.aiDiagnosis ? <div className="mt-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-3 text-xs leading-5 text-indigo-900"><span className="font-semibold">AI diagnosis:</span> {check.aiDiagnosis}</div> : null}
          {listedChecks.length ? (
            <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800">
              Listed by: {listedChecks.map((c: any) => `${c.provider} (${c.zone})`).join(", ")}
            </div>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4">
          {recommendations.length ? (
            <div className="rounded-3xl border border-emerald-100 bg-emerald-50/70 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Auto remediation checklist</div>
              <ul className="mt-2 space-y-1 text-xs leading-5 text-emerald-900">
                {recommendations.map((r: string, i: number) => <li key={i}>✓ {r}</li>)}
              </ul>
            </div>
          ) : null}
          {delistingLinks.length ? (
            <div className="rounded-3xl border border-red-100 bg-red-50/80 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-red-700">Provider delisting links</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {delistingLinks.map((d: any) => <a key={`${d.provider}-${d.url}`} className="rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100" href={d.url} target="_blank" rel="noreferrer">{d.provider}</a>)}
              </div>
            </div>
          ) : null}
          {diagnostics.length ? (
            <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">rDNS / SMTP / domain health checks</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {diagnostics.map((d: any) => <div key={d.id} className="rounded-2xl border border-white bg-white/80 p-3 text-xs shadow-sm"><div className="flex items-center justify-between gap-2"><span className="font-semibold text-slate-900">{d.label}</span><Pill tone={d.status === "pass" ? "success" : d.status === "error" ? "danger" : "warning"}>{d.status}</Pill></div><div className="mt-2 break-all font-mono text-slate-600">{d.output}</div></div>)}
              </div>
            </div>
          ) : null}
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
                <div className="mt-2 grid gap-2 text-xs lg:grid-cols-[110px_1fr]">
                  <div className="font-semibold text-slate-500">Query</div>
                  <div className="break-all rounded-xl bg-slate-50 px-2 py-1 font-mono text-slate-700">{c.query}</div>
                  <div className="font-semibold text-slate-500">Resolver</div>
                  <div className="break-all rounded-xl bg-slate-50 px-2 py-1 font-mono text-slate-700">{c.resolver || "system"} · timeout {c.timeoutMs || "—"}ms · duration {c.durationMs ?? "—"}ms</div>
                  <div className="font-semibold text-slate-500">Raw output</div>
                  <div className="break-all rounded-xl bg-slate-50 px-2 py-1 font-mono text-slate-700">{Array.isArray(c.responses) && c.responses.length ? c.responses.join(", ") : (c.rawOutput || "NXDOMAIN / no listing")}</div>
                  <div className="font-semibold text-slate-500">Interpretation</div>
                  <div className="break-all rounded-xl bg-slate-50 px-2 py-1 text-slate-700">{c.interpretation || c.status} · counted as blacklist hit: {(c.status === "listed" && c.countedAsListed !== false) ? "yes" : "no"}</div>
                </div>
                <div className="mt-2 text-xs leading-5 text-slate-600">{c.detail}</div>
                {c.guidance ? <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs leading-5 text-slate-600"><span className="font-semibold text-slate-900">Why it matters:</span> {c.guidance.meaning} <span className="font-semibold">Impact:</span> {c.guidance.impact}</div> : null}
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
