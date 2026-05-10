"use client";

import React, { useMemo, useState, useContext } from "react";
import { Badge, Button, Card, Input, Textarea, Pill } from "@/components/ui";

type DnsRow = { type: string; name: string; value: string; ttl?: number; priority?: number };

const DnsTabCtx = React.createContext<{ tab: "cloudflare" | "manual" }>({ tab: "cloudflare" });
export function useDnsTab() {
  return useContext(DnsTabCtx);
}

function safeTrim(s: any) {
  return String(s || "").trim();
}

function isIPv4(v: string) {
  return /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(v);
}

function parseIps(text: string) {
  const ips = String(text || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const uniq = Array.from(new Set(ips.filter(isIPv4)));
  const invalid = ips.filter((x) => x && !isIPv4(x));
  return { uniq, invalid };
}

function renderZoneLines(rows: DnsRow[]) {
  const lines: string[] = [];
  for (const r of rows) {
    const ttl = typeof r.ttl === "number" ? String(r.ttl) : "120";
    if (r.type === "MX") {
      const prio = typeof r.priority === "number" ? String(r.priority) : "10";
      lines.push(`${r.name}\t${ttl}\tIN\tMX\t${prio}\t${r.value}`);
      continue;
    }
    if (r.type === "TXT") {
      const v = String(r.value || "").replace(/\r?\n/g, " ").trim();
      lines.push(`${r.name}\t${ttl}\tIN\tTXT\t"${v.replace(/"/g, "\\\"")}"`);
      continue;
    }
    lines.push(`${r.name}\t${ttl}\tIN\t${r.type}\t${r.value}`);
  }
  return lines.join("\n");
}

function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 900);
        } catch {
          // ignore clipboard failures
        }
      }}
    >
      {ok ? "Copied" : label}
    </Button>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${
        active
          ? "bg-slate-950 text-white shadow-lg shadow-slate-950/15"
          : "border border-slate-200 bg-white/85 text-slate-700 shadow-sm hover:bg-white"
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</span>
      {children}
      {hint ? <span className="text-xs leading-5 text-slate-500">{hint}</span> : null}
    </label>
  );
}

function DnsRecordCard({ row }: { row: DnsRow }) {
  return (
    <div className="rounded-[1.35rem] border border-slate-200/80 bg-white/90 p-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-2">
        <Badge>{row.type}</Badge>
        <div className="min-w-0 flex-1">
          <div className="break-all text-sm font-semibold text-slate-950">{row.name}</div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
            {typeof row.ttl === "number" ? <span>TTL {row.ttl}</span> : null}
            {typeof row.priority === "number" ? <span>Priority {row.priority}</span> : null}
          </div>
        </div>
        <Copy text={row.value} label="Copy value" />
      </div>
      <pre className="mt-3 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-800">
        {row.value}
      </pre>
    </div>
  );
}

export default function DomainDnsTabs({
  domainId,
  domainName,
  hasCloudflareToken,
  defaultServerIp,
  outboundIpsText,
  redirectTo,
  tenantId,
  tenantName,
  dnsRows,
  children,
}: {
  domainId: string;
  domainName: string;
  hasCloudflareToken: boolean;
  defaultServerIp: string;
  outboundIpsText: string;
  redirectTo: string;
  tenantId?: string | null;
  tenantName?: string | null;
  dnsRows: DnsRow[];
  children: React.ReactNode;
}) {
  const [tab, setTab] = useState<"cloudflare" | "manual">("cloudflare");
  const [busySync, setBusySync] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [replaceCloudflareToken, setReplaceCloudflareToken] = useState(false);
  const [outIps, setOutIps] = useState(safeTrim(outboundIpsText));
  const [detectMsg, setDetectMsg] = useState<string>("");
  const [detectBusy, setDetectBusy] = useState(false);

  const parsed = useMemo(() => parseIps(outIps), [outIps]);
  const zoneText = useMemo(() => renderZoneLines(dnsRows), [dnsRows]);

  const redirectPath = useMemo(() => {
    const p = safeTrim(redirectTo);
    return p.startsWith("/") ? p : "/";
  }, [redirectTo]);

  async function syncNow() {
    if (!tenantId) return;
    setMsg(null);
    setBusySync(true);
    try {
      const res = await fetch("/api/mailstack/tenant/sync", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(j?.error || j?.message || "DNS_SYNC_FAILED"));
      setMsg(`DNS sync queued (job: ${j?.jobId || "?"}). Refresh in around 10-30 seconds.`);
    } catch (e: any) {
      setMsg(String(e?.message || e || "DNS_SYNC_FAILED"));
    } finally {
      setBusySync(false);
    }
  }

  async function detectOutboundIps() {
    setDetectMsg("");
    setDetectBusy(true);
    try {
      const r = await fetch("/api/system/ips", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(j?.error || "FAILED"));
      const pub = Array.isArray(j?.publicIps) ? (j.publicIps as string[]) : [];
      const priv = Array.isArray(j?.privateIps) ? (j.privateIps as string[]) : [];
      const picked = pub.length ? pub : priv;
      setOutIps(picked.join("\n"));
      setDetectMsg(`Detected ${picked.length} IP${picked.length === 1 ? "" : "s"} from this server.`);
    } catch (e: any) {
      setDetectMsg(String(e?.message || e || "FAILED"));
    } finally {
      setDetectBusy(false);
    }
  }

  const statusPills = (
    <div className="flex flex-wrap items-center gap-2">
      {tenantName ? <Badge>tenant: {tenantName}</Badge> : <Badge>no tenant linked</Badge>}
      {tab === "cloudflare" ? (
        hasCloudflareToken ? <Pill tone="success">Cloudflare connected</Pill> : <Pill tone="warning">Cloudflare not connected</Pill>
      ) : (
        <Pill tone="info">manual copy mode</Pill>
      )}
      <Badge>{parsed.uniq.length} outbound IP{parsed.uniq.length === 1 ? "" : "s"}</Badge>
    </div>
  );

  return (
    <DnsTabCtx.Provider value={{ tab }}>
      <div className="grid gap-6">
        <section className="rounded-[1.8rem] border border-white/70 bg-white/86 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.07)] backdrop-blur-xl">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <TabButton active={tab === "cloudflare"} onClick={() => setTab("cloudflare")}>Cloudflare cockpit</TabButton>
              <TabButton active={tab === "manual"} onClick={() => setTab("manual")}>Manual DNS records</TabButton>
            </div>
            {statusPills}
          </div>
        </section>

        {tab === "cloudflare" ? (
          <div className="grid gap-6">
            <Card title="Cloudflare DNS cockpit" subtitle="Connect Cloudflare, save defaults, preview records, and push the required DNS bundle from one clean workspace.">
              <div className="grid gap-5 2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <form className="grid gap-5 rounded-[1.6rem] border border-slate-200/80 bg-white/90 p-5" action="/api/domains/cloudflare/save" method="post">
                  <input type="hidden" name="domainId" value={domainId} />
                  <input type="hidden" name="redirectTo" value={redirectPath} />

                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label={`Server IP for mail.${domainName}`} hint="Used for A/MX defaults and mailbox provisioning.">
                      <Input name="serverIp" defaultValue={safeTrim(defaultServerIp)} placeholder="51.38.38.222" />
                    </Field>
                    <Field label="Cloudflare API token" hint="Needs Zone:Read and DNS:Edit permissions.">
                      {hasCloudflareToken && !replaceCloudflareToken ? (
                        <div className="flex items-center gap-2">
                          <Input value="Saved token" disabled aria-label="Cloudflare token saved" />
                          <Button type="button" variant="ghost" onClick={() => setReplaceCloudflareToken(true)}>Replace</Button>
                        </div>
                      ) : (
                        <Input name="cloudflareToken" placeholder={hasCloudflareToken ? "Paste new token to replace" : "CF API token"} autoComplete="off" />
                      )}
                    </Field>
                  </div>

                  <Field label="Outbound IP pool" hint="These IPs are used for SPF and Mailstack sending rotation.">
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-500">One IP per line</span>
                        <Button type="button" variant="ghost" onClick={detectOutboundIps} disabled={detectBusy}>
                          {detectBusy ? "Detecting…" : "Detect from server"}
                        </Button>
                      </div>
                      <Textarea name="outboundIps" value={outIps} onChange={(e) => setOutIps(e.target.value)} rows={6} placeholder={`51.38.38.222\n51.38.38.223`} className="font-mono text-sm" />
                    </div>
                    {detectMsg ? <span className="text-xs text-slate-500">{detectMsg}</span> : null}
                    {parsed.invalid.length ? (
                      <span className="text-xs text-red-700">Invalid IP lines ignored: {parsed.invalid.slice(0, 6).join(", ")}{parsed.invalid.length > 6 ? "…" : ""}</span>
                    ) : null}
                  </Field>

                  <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                    <Button type="submit">Save DNS defaults</Button>
                    <Copy text={safeTrim(defaultServerIp)} label="Copy server IP" />
                    <Copy text={zoneText} label="Copy all records" />
                  </div>
                </form>

                <div className="grid gap-4 content-start">
                  <div className="rounded-[1.6rem] border border-slate-900/10 bg-slate-950 p-5 text-white shadow-[0_20px_70px_rgba(15,23,42,0.16)]">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="text-base font-semibold">One-click DNS sync</div>
                        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-300">
                          After defaults are saved, push SPF, DKIM, DMARC, MX, and A records through Cloudflare.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                        <form action="/api/domains/cloudflare/init" method="post">
                          <input type="hidden" name="domainId" value={domainId} />
                          <input type="hidden" name="redirectTo" value={redirectPath} />
                          <Button type="submit" variant="ghost" className="bg-white/10 text-white border-white/15 hover:bg-white/15">Initialize SSL</Button>
                        </form>
                        {tenantId ? (
                          <Button type="button" onClick={syncNow} disabled={busySync || !hasCloudflareToken}>
                            {busySync ? "Syncing…" : "Sync DNS now"}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {msg ? <div className="mt-4 rounded-2xl border border-white/10 bg-white/10 p-3 text-xs leading-5 text-slate-100">{msg}</div> : null}
                  </div>

                  <div className="rounded-[1.6rem] border border-slate-200/80 bg-white/90 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-950">DNS bundle preview</div>
                        <div className="mt-1 text-xs text-slate-500">Long values are scroll-safe and will not break the layout.</div>
                      </div>
                      <Copy text={zoneText} label="Copy bundle" />
                    </div>
                    <pre className="mt-3 max-h-80 overflow-auto rounded-2xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100 whitespace-pre">
                      {zoneText}
                    </pre>
                  </div>
                </div>
              </div>
            </Card>

            {children}
          </div>
        ) : (
          <div className="grid gap-6">
            <Card title="Manual DNS workspace" subtitle="Copy exact records to any DNS provider, then run a health check above.">
              <div className="grid gap-5 2xl:grid-cols-[minmax(320px,0.55fr)_minmax(0,1.45fr)]">
                <form className="grid gap-4 rounded-[1.6rem] border border-slate-200/80 bg-white/90 p-5 content-start" action="/api/domains/dns-defaults/save" method="post">
                  <input type="hidden" name="domainId" value={domainId} />
                  <input type="hidden" name="redirectTo" value={redirectPath} />
                  <Field label="Server IP">
                    <Input name="serverIp" defaultValue={safeTrim(defaultServerIp)} placeholder="51.38.38.222" />
                  </Field>
                  <Field label="Outbound IPs" hint="One IP per line; used for SPF suggestions.">
                    <div className="grid gap-2">
                      <div className="flex justify-end">
                        <Button type="button" variant="ghost" onClick={detectOutboundIps} disabled={detectBusy}>{detectBusy ? "Detecting…" : "Detect"}</Button>
                      </div>
                      <Textarea name="outboundIps" value={outIps} onChange={(e) => setOutIps(e.target.value)} rows={6} placeholder={`51.38.38.222\n51.38.38.223`} className="font-mono text-sm" />
                    </div>
                    {detectMsg ? <span className="text-xs text-slate-500">{detectMsg}</span> : null}
                  </Field>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="submit">Save defaults</Button>
                    <Copy text={zoneText} label="Copy all records" />
                  </div>
                </form>

                <div className="grid gap-3">
                  {dnsRows.map((r, idx) => <DnsRecordCard key={idx} row={r} />)}
                </div>
              </div>
            </Card>

            {children}
          </div>
        )}
      </div>
    </DnsTabCtx.Provider>
  );
}
