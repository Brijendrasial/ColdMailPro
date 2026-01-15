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

      // default selection: prefer existing config, else select all public IPs.
      const existing = parseIps(initialOutboundIps || "").uniq;
      const next: Record<string, boolean> = {};
      const seed = existing.length ? existing : pub;
      for (const ip of seed) next[ip] = true;
      setSelectedIps(next);

      // If server IP is empty, set it to first public IP.
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

  // initial detect
  useEffect(() => {
    fetchIps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep textarea in sync with selected checkboxes unless user opts into manual override
  useEffect(() => {
    if (manualIps) return;
    const all = Object.keys(selectedIps).filter((k) => !!selectedIps[k]);
    setOutboundIps(all.join("\n"));
  }, [selectedIps, manualIps]);

  return (
    <Card
      title="Add domain (generates DKIM keys)"
      right={
        <div className="flex items-center gap-2">
          <Pill tone={parsedDomains.ok.length ? "info" : "neutral"}>
            {parsedDomains.ok.length} domain{parsedDomains.ok.length === 1 ? "" : "s"}
          </Pill>
          <Pill tone={parsed.uniq.length ? "info" : "neutral"}>
            {parsed.uniq.length} outbound IP{parsed.uniq.length === 1 ? "" : "s"}
          </Pill>
        </div>
      }
    >
      <div className="text-sm text-slate-600 -mt-2 mb-4">
        Create a tenant, paste one (or many) domains, and we’ll generate DKIM keys + a clean SPF suggestion based on your outbound IP pool.
      </div>

      <form action="/api/domains/create" method="post" className="grid gap-4">
        <input type="hidden" name="dkimSelector" value="default" />

        <div className="grid lg:grid-cols-3 gap-4">
          {/* Left: main inputs */}
          <div className="lg:col-span-2 grid gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-sm font-semibold">Step 1</div>
                <div className="text-sm text-slate-700">Tenant + domains</div>
                <div className="ml-auto flex items-center gap-2">
                  {parsedDomains.invalid.length ? (
                    <Pill tone="warning">{parsedDomains.invalid.length} invalid</Pill>
                  ) : parsedDomains.ok.length ? (
                    <Pill tone="success">ready</Pill>
                  ) : (
                    <Pill tone="neutral">paste domains</Pill>
                  )}
                </div>
              </div>
              <Divider className="my-3" />

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-600 mb-1">Tenant name (required)</div>
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
                  <div className="text-xs text-slate-600 mt-1">All domains pasted below will be grouped under this tenant.</div>
                </div>

                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-600 mb-1">Tracking subdomain (optional)</div>
                  <Input name="trackingSubdomain" placeholder="t.%d" />
                  <div className="text-xs text-slate-600 mt-1">
                    Use <b>%d</b> as the domain placeholder for bulk add (example: <b>t.%d</b>).
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <div className="text-xs uppercase tracking-wider text-slate-600 mb-1">Domains (one per line)</div>
                <Textarea
                  name="names"
                  required
                  value={domainsRaw}
                  onChange={(e) => setDomainsRaw(e.target.value)}
                  rows={4}
                  placeholder={`example.com\nexample2.com\n...`}
                />
                <div className="mt-1 flex items-center gap-2 flex-wrap text-xs">
                  <span className="text-slate-600">Duplicates are skipped automatically.</span>
                  {parsedDomains.invalid.length ? (
                    <span className="text-red-700">
                      Invalid lines ignored: {parsedDomains.invalid.slice(0, 6).join(", ")}
                      {parsedDomains.invalid.length > 6 ? "…" : ""}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-sm font-semibold">Step 2</div>
                <div className="text-sm text-slate-700">Outbound IP pool (SPF)</div>
                <div className="ml-auto flex items-center gap-2">
                  {parsed.invalid.length ? <Pill tone="danger">{parsed.invalid.length} invalid</Pill> : <Pill tone="success">valid</Pill>}
                  <Button type="button" variant="ghost" onClick={fetchIps}>Detect from server</Button>
                </div>
              </div>
              <Divider className="my-3" />

              {ipsErr ? <div className="text-xs text-red-700 mb-2">{ipsErr}</div> : null}

              {detectedPublicIps.length || detectedPrivateIps.length ? (
                <div className="grid gap-3">
                  {detectedPublicIps.length ? (
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-xs text-slate-600">Detected public IPv4</div>
                        <div className="ml-auto flex items-center gap-2">
                          <Button type="button" variant="ghost" onClick={() => setAll(detectedPublicIps, true)}>Select all</Button>
                          <Button type="button" variant="ghost" onClick={() => setAll(detectedPublicIps, false)}>Clear</Button>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {detectedPublicIps.map((ip) => (
                          <label key={ip} className="flex items-center gap-2 text-xs rounded-full border border-slate-200 px-3 py-1 bg-white/70 hover:bg-white transition">
                            <Input
                              type="checkbox"
                              checked={!!selectedIps[ip]}
                              onChange={(e) => setSelectedIps((m) => ({ ...m, [ip]: e.target.checked }))}
                            />
                            <span className="font-mono">{ip}</span>
                          </label>
                        ))}
                      </div>
                      <div className="mt-2 text-xs text-slate-600">
                        Tip: keep <b>2+</b> outbound IPs if you want zero‑downtime rotation.
                      </div>
                    </div>
                  ) : null}

                  {detectedPrivateIps.length ? (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-slate-600">Show private IPv4 (usually not for SPF)</summary>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {detectedPrivateIps.map((ip) => (
                          <label key={ip} className="flex items-center gap-2 text-xs rounded-full border border-slate-200 px-3 py-1 bg-white/70 hover:bg-white transition">
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

                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <Input type="checkbox" checked={manualIps} onChange={(e) => setManualIps(e.target.checked)} />
                    Manual override (edit text)
                  </label>
                </div>
              ) : (
                <div className="text-xs text-slate-600">No IPs detected yet.</div>
              )}

              <Textarea
                name="outboundIps"
                value={outboundIps}
                onChange={(e) => setOutboundIps(e.target.value)}
                readOnly={!manualIps}
                rows={4}
                placeholder={`51.38.38.222\n46.105.154.97\n...`}
                className="mt-3"
              />
              <div className="mt-2 text-xs text-slate-600">
                Saved as workspace defaults and automatically included in SPF suggestions for newly added domains.
              </div>
            </div>
          </div>

          {/* Right: preview + advanced + create */}
          <div className="lg:col-span-1 grid gap-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold">Preview</div>
                <div className="ml-auto flex items-center gap-2">
                  {copyMsg ? <span className="text-xs text-slate-600">{copyMsg}</span> : null}
                  <Button type="button" variant="ghost" onClick={() => copy(spfPreview)}>Copy SPF</Button>
                </div>
              </div>
              <div className="mt-3 rounded-2xl border border-slate-200 bg-white/70 p-3">
                <div className="text-xs text-slate-600 mb-1">SPF (TXT at root)</div>
                <div className="font-mono text-xs break-words">{spfPreview}</div>
              </div>

              <div className="mt-3 grid gap-2 text-xs text-slate-700">
                <div className="flex items-center justify-between">
                  <span>Domains ready</span>
                  <span className="font-medium">{parsedDomains.ok.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Selected outbound IPs</span>
                  <span className="font-medium">{selectedIpList.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>DKIM selector</span>
                  <span className="font-medium font-mono">default</span>
                </div>
              </div>

              {parsed.invalid.length ? (
                <div className="mt-3 text-xs text-red-700">Invalid IP lines ignored: {parsed.invalid.slice(0, 6).join(", ")}{parsed.invalid.length > 6 ? "…" : ""}</div>
              ) : null}
            </div>

            <details className="rounded-2xl border border-slate-200 bg-white/70 p-4" open={showAdvanced} onToggle={(e) => setShowAdvanced((e.target as any)?.open)}>
              <summary className="cursor-pointer list-none">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">Advanced</div>
                    <div className="text-xs text-slate-600 mt-0.5">Cloudflare + server defaults</div>
                  </div>
                  {hasCloudflareToken ? <Pill tone="success">Cloudflare connected</Pill> : <Pill tone="neutral">Cloudflare optional</Pill>}
                </div>
              </summary>
              <Divider className="my-3" />

              <div className="grid gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-600 mb-1">Server IP (mail.&lt;domain&gt; A record)</div>
                  <Input name="serverIp" value={serverIp} onChange={(e) => setServerIp(e.target.value)} placeholder="51.38.38.222" />
                  <div className="text-xs text-slate-600 mt-1">Used for A record suggestions and Mailstack provisioning defaults.</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-600 mb-1">Cloudflare API token</div>
                  <Input
                    name="cloudflareToken"
                    placeholder={hasCloudflareToken ? "(already connected — paste to replace)" : "CF API token"}
                    autoComplete="off"
                  />
                  <div className="text-xs text-slate-600 mt-1">Permissions: <b>Zone:Read</b> + <b>DNS:Edit</b>.</div>
                </div>
              </div>
            </details>

            <Button type="submit" disabled={!tenantName.trim() || !parsedDomains.ok.length}>
              Create & generate DKIM
            </Button>

            <div className="text-xs text-slate-600">
              After creating, the server generates DKIM keys for the tenant and syncs the <b>real</b> DKIM TXT value into the app.
              If you open a domain immediately, you may briefly see “DKIM pending” until the prepare job finishes.
            </div>
          </div>
        </div>
      </form>

      {/* footer note moved into right column */}
    </Card>
  );
}
