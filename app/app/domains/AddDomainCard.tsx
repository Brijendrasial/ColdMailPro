"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Card, Input, Button, Textarea, Pill, Divider } from "@/components/ui";

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

function buildSpf(ips: string[]) {
  const uniq = Array.from(new Set(ips.filter(isIPv4)));
  if (uniq.length === 0) return "v=spf1 a mx ~all";
  return `v=spf1 a mx ${uniq.map((ip) => `ip4:${ip}`).join(" ")} -all`;
}

function StepBadge({ n, title, state }: { n: string; title: string; state?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-950 text-sm font-semibold text-white shadow-lg">{n}</div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-950">{title}</div>
        <div className="text-xs text-slate-500">Designed to keep DNS and Mailstack defaults aligned.</div>
      </div>
      {state ? <div className="ml-auto shrink-0">{state}</div> : null}
    </div>
  );
}

export default function AddDomainCard({
  initialServerIp,
  initialOutboundIps,
  hasCloudflareToken,
  tenants,
}: {
  initialServerIp: string;
  initialOutboundIps: string;
  hasCloudflareToken: boolean;
  tenants: { id: string; name: string }[];
}) {
  const [domainsRaw, setDomainsRaw] = useState("");
  const [tenantName, setTenantName] = useState(tenants?.[0]?.name || "");

  const [outboundIps, setOutboundIps] = useState(initialOutboundIps || "");
  const [serverIp, setServerIp] = useState(initialServerIp || "");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [detectedPublicIps, setDetectedPublicIps] = useState<string[]>([]);
  const [detectedPrivateIps, setDetectedPrivateIps] = useState<string[]>([]);
  const [selectedIps, setSelectedIps] = useState<Record<string, boolean>>({});
  const [ipsErr, setIpsErr] = useState<string>("");
  const [manualIps, setManualIps] = useState(false);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  const parsed = useMemo(() => parseIps(outboundIps), [outboundIps]);
  const spfPreview = useMemo(() => buildSpf(parsed.uniq), [parsed.uniq]);
  const selectedIpList = useMemo(() => Object.keys(selectedIps).filter((k) => !!selectedIps[k]), [selectedIps]);

  const parsedDomains = useMemo(() => {
    const lines = String(domainsRaw || "")
      .split(/\r?\n/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const uniq = Array.from(new Set(lines));
    const invalid = uniq.filter((d) => !d.includes("."));
    const ok = uniq.filter((d) => d.includes("."));
    return { uniq, ok, invalid };
  }, [domainsRaw]);

  async function fetchIps() {
    setIpsErr("");
    try {
      const r = await fetch("/api/system/ips", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(j?.error || "FAILED"));
      const pub = Array.isArray(j?.publicIps) ? (j.publicIps as string[]) : [];
      const priv = Array.isArray(j?.privateIps) ? (j.privateIps as string[]) : [];
      setDetectedPublicIps(pub);
      setDetectedPrivateIps(priv);

      const existing = parseIps(initialOutboundIps || "").uniq;
      const next: Record<string, boolean> = {};
      const seed = existing.length ? existing : pub;
      for (const ip of seed) next[ip] = true;
      setSelectedIps(next);

      if (!serverIp && pub.length) setServerIp(pub[0]);
    } catch (e: any) {
      setIpsErr(String(e?.message || e || "FAILED"));
    }
  }

  function setAll(ips: string[], checked: boolean) {
    setSelectedIps((m) => {
      const next = { ...m };
      for (const ip of ips) next[ip] = checked;
      return next;
    });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg("Copied");
      setTimeout(() => setCopyMsg(null), 1200);
    } catch {
      setCopyMsg("Copy failed");
      setTimeout(() => setCopyMsg(null), 1500);
    }
  }

  useEffect(() => {
    fetchIps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (manualIps) return;
    const all = Object.keys(selectedIps).filter((k) => !!selectedIps[k]);
    setOutboundIps(all.join("\n"));
  }, [selectedIps, manualIps]);

  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-white/82 shadow-[0_28px_90px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="absolute inset-0 bg-[radial-gradient(800px_circle_at_0%_0%,rgba(99,102,241,0.12),transparent_40%),radial-gradient(700px_circle_at_100%_0%,rgba(20,184,166,0.12),transparent_40%)]" />
      <div className="relative p-5 sm:p-6 lg:p-7">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50/80 px-3 py-1 text-xs font-semibold text-indigo-700">
              <span className="h-2 w-2 rounded-full bg-indigo-500" /> DNS Launchpad
            </div>
            <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight text-slate-950">Create domains + DKIM</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              Add domains, select your outbound IP pool, preview SPF, and generate DKIM with fewer moving parts.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Pill tone={parsedDomains.ok.length ? "info" : "neutral"}>{parsedDomains.ok.length} ready domain{parsedDomains.ok.length === 1 ? "" : "s"}</Pill>
            <Pill tone={parsed.uniq.length ? "success" : "warning"}>{parsed.uniq.length} valid IP{parsed.uniq.length === 1 ? "" : "s"}</Pill>
            {hasCloudflareToken ? <Pill tone="success">Cloudflare connected</Pill> : <Pill tone="neutral">Cloudflare optional</Pill>}
          </div>
        </div>

        <form action="/api/domains/create" method="post" className="grid gap-5">
          <input type="hidden" name="dkimSelector" value="default" />

          <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
            <div className="grid gap-5">
              <div className="rounded-[1.7rem] border border-slate-200/80 bg-white/80 p-5 shadow-[0_16px_50px_rgba(15,23,42,0.05)]">
                <StepBadge
                  n="1"
                  title="Tenant and domain batch"
                  state={parsedDomains.invalid.length ? <Pill tone="warning">{parsedDomains.invalid.length} invalid</Pill> : parsedDomains.ok.length ? <Pill tone="success">Ready</Pill> : <Pill tone="neutral">Paste domains</Pill>}
                />

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Tenant name</span>
                    <Input
                      name="tenantName"
                      required
                      value={tenantName}
                      onChange={(e) => setTenantName(e.target.value)}
                      placeholder="e.g. sial"
                      list="tenantNames"
                    />
                    <datalist id="tenantNames">
                      {tenants.map((t) => (
                        <option key={t.id} value={t.name} />
                      ))}
                    </datalist>
                    <span className="text-xs text-slate-500">All pasted domains are grouped under this Mailstack tenant.</span>
                  </label>

                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Tracking subdomain</span>
                    <Input name="trackingSubdomain" placeholder="t.%d" />
                    <span className="text-xs text-slate-500">Use <b>%d</b> for bulk add, for example <b>t.%d</b>.</span>
                  </label>
                </div>

                <label className="mt-4 grid gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Domains, one per line</span>
                  <Textarea
                    name="names"
                    required
                    value={domainsRaw}
                    onChange={(e) => setDomainsRaw(e.target.value)}
                    rows={6}
                    placeholder={`example.com\nexample2.com\nclient-domain.com`}
                    className="font-mono text-sm"
                  />
                </label>
                <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
                  <span className="text-slate-500">Duplicates are skipped automatically.</span>
                  {parsedDomains.invalid.length ? (
                    <span className="font-medium text-red-700">
                      Invalid lines ignored: {parsedDomains.invalid.slice(0, 6).join(", ")}{parsedDomains.invalid.length > 6 ? "…" : ""}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="rounded-[1.7rem] border border-slate-200/80 bg-white/80 p-5 shadow-[0_16px_50px_rgba(15,23,42,0.05)]">
                <StepBadge
                  n="2"
                  title="Outbound IP pool for SPF"
                  state={parsed.invalid.length ? <Pill tone="danger">{parsed.invalid.length} invalid</Pill> : <Pill tone="success">Valid pool</Pill>}
                />

                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Server detected IPs</div>
                    <p className="text-xs leading-5 text-slate-500">Select the IPs used for outbound sending. Keep 2+ IPs for safer rotation.</p>
                  </div>
                  <Button type="button" variant="ghost" onClick={fetchIps}>Detect from server</Button>
                </div>

                {ipsErr ? <div className="mt-3 rounded-2xl border border-red-200 bg-red-50/80 p-3 text-xs text-red-700">{ipsErr}</div> : null}

                <div className="mt-4 grid gap-4">
                  {detectedPublicIps.length ? (
                    <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Public IPv4</div>
                        <div className="ml-auto flex items-center gap-2">
                          <Button type="button" variant="ghost" onClick={() => setAll(detectedPublicIps, true)}>Select all</Button>
                          <Button type="button" variant="ghost" onClick={() => setAll(detectedPublicIps, false)}>Clear</Button>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {detectedPublicIps.map((ip) => (
                          <label key={ip} className="flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-3 py-2 text-xs font-medium shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                            <Input
                              type="checkbox"
                              checked={!!selectedIps[ip]}
                              onChange={(e) => setSelectedIps((m) => ({ ...m, [ip]: e.target.checked }))}
                            />
                            <span className="font-mono">{ip}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 p-4 text-sm text-slate-500">No server IPs detected yet. Click detect to scan this machine.</div>
                  )}

                  {detectedPrivateIps.length ? (
                    <details className="rounded-2xl border border-slate-200/70 bg-white/70 p-4 text-xs">
                      <summary className="cursor-pointer font-semibold text-slate-700">Show private IPv4 addresses</summary>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {detectedPrivateIps.map((ip) => (
                          <label key={ip} className="flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-3 py-2 text-xs">
                            <Input
                              type="checkbox"
                              checked={!!selectedIps[ip]}
                              onChange={(e) => setSelectedIps((m) => ({ ...m, [ip]: e.target.checked }))}
                            />
                            <span className="font-mono">{ip}</span>
                          </label>
                        ))}
                      </div>
                    </details>
                  ) : null}

                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <Input type="checkbox" checked={manualIps} onChange={(e) => setManualIps(e.target.checked)} />
                    Manual override IP list
                  </label>

                  <Textarea
                    name="outboundIps"
                    value={outboundIps}
                    onChange={(e) => setOutboundIps(e.target.value)}
                    readOnly={!manualIps}
                    rows={5}
                    placeholder={`51.38.38.222\n46.105.154.97`}
                    className="font-mono text-sm"
                  />
                </div>
              </div>
            </div>

            <aside className="grid gap-5 content-start xl:sticky xl:top-24">
              <div className="rounded-[1.7rem] border border-slate-200/80 bg-slate-950 p-5 text-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
                <div className="flex items-center gap-2">
                  <div>
                    <div className="text-sm font-semibold">SPF preview</div>
                    <div className="text-xs text-slate-400">TXT record at root domain</div>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {copyMsg ? <span className="text-xs text-slate-300">{copyMsg}</span> : null}
                    <Button type="button" variant="ghost" className="bg-white/10 text-white border-white/15 hover:bg-white/15" onClick={() => copy(spfPreview)}>Copy</Button>
                  </div>
                </div>
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/10 p-4 font-mono text-xs leading-5 text-slate-100 break-words">
                  {spfPreview}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-2xl bg-white/10 p-3">
                    <div className="text-2xl font-semibold">{parsedDomains.ok.length}</div>
                    <div className="text-[11px] text-slate-300">domains</div>
                  </div>
                  <div className="rounded-2xl bg-white/10 p-3">
                    <div className="text-2xl font-semibold">{selectedIpList.length}</div>
                    <div className="text-[11px] text-slate-300">selected IPs</div>
                  </div>
                  <div className="rounded-2xl bg-white/10 p-3">
                    <div className="text-2xl font-semibold">1</div>
                    <div className="text-[11px] text-slate-300">selector</div>
                  </div>
                </div>
                {parsed.invalid.length ? (
                  <div className="mt-3 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-100">
                    Invalid IP lines ignored: {parsed.invalid.slice(0, 6).join(", ")}{parsed.invalid.length > 6 ? "…" : ""}
                  </div>
                ) : null}
              </div>

              <details className="rounded-[1.7rem] border border-slate-200/80 bg-white/82 p-5 shadow-[0_16px_50px_rgba(15,23,42,0.05)]" open={showAdvanced} onToggle={(e) => setShowAdvanced((e.target as any)?.open)}>
                <summary className="cursor-pointer list-none">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">Advanced routing</div>
                      <div className="mt-0.5 text-xs text-slate-500">Cloudflare token + mail A record defaults</div>
                    </div>
                    {hasCloudflareToken ? <Pill tone="success">Connected</Pill> : <Pill tone="neutral">Optional</Pill>}
                  </div>
                </summary>
                <Divider className="my-4" />
                <div className="grid gap-4">
                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Server IP</span>
                    <Input name="serverIp" value={serverIp} onChange={(e) => setServerIp(e.target.value)} placeholder="51.38.38.222" />
                    <span className="text-xs text-slate-500">Used for mail.&lt;domain&gt; A record suggestions.</span>
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Cloudflare API token</span>
                    <Input name="cloudflareToken" placeholder={hasCloudflareToken ? "Saved — paste to replace" : "CF API token"} autoComplete="off" />
                    <span className="text-xs text-slate-500">Needs Zone:Read and DNS:Edit.</span>
                  </label>
                </div>
              </details>

              <Button type="submit" disabled={!tenantName.trim() || !parsedDomains.ok.length} className="h-14 rounded-[1.35rem] text-base">
                Create domains + generate DKIM
              </Button>
              <p className="text-xs leading-5 text-slate-500">
                DKIM keys are generated server-side. If you open a new domain immediately, it may briefly show DKIM pending until the prepare job finishes.
              </p>
            </aside>
          </div>
        </form>
      </div>
    </section>
  );
}
