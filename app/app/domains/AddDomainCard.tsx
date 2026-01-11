"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Card, Input, Button, Textarea, Badge } from "@/components/ui";

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

  const parsed = useMemo(() => parseIps(outboundIps), [outboundIps]);
  const spfPreview = useMemo(() => buildSpf(parsed.uniq), [parsed.uniq]);

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
          <Badge>{parsedDomains.ok.length} domain{parsedDomains.ok.length === 1 ? "" : "s"}</Badge>
          <Badge>{parsed.uniq.length} outbound IP{parsed.uniq.length === 1 ? "" : "s"}</Badge>
        </div>
      }
    >
      <form action="/api/domains/create" method="post" className="grid gap-3">
        <div>
          <div className="text-sm mb-1 opacity-80">Tenant name (required)</div>
          <Input
            name="tenantName"
            required
            value={tenantName}
            onChange={(e) => setTenantName(e.target.value)}
            placeholder="e.g. tenant-1"
            list="tenantNames"
          />
          <datalist id="tenantNames">
            {tenants.map((t) => (
              <option key={t.id} value={t.name} />
            ))}
          </datalist>
          <div className="text-xs opacity-60 mt-1">All domains you paste below will be grouped under this tenant.</div>
        </div>
        <div>
          <div className="text-sm mb-1 opacity-80">Domains (one per line)</div>
          <Textarea
            name="names"
            required
            value={domainsRaw}
            onChange={(e) => setDomainsRaw(e.target.value)}
            rows={3}
            placeholder={`example.com\nexample2.com\n...`}
          />
          {parsedDomains.invalid.length ? (
            <div className="text-xs text-red-700 mt-1">
              Invalid lines ignored: {parsedDomains.invalid.slice(0, 6).join(", ")}{parsedDomains.invalid.length > 6 ? "…" : ""}
            </div>
          ) : (
            <div className="text-xs opacity-60 mt-1">
              Tip: paste a whole list. We will skip duplicates automatically.
            </div>
          )}
        </div>

        <input type="hidden" name="dkimSelector" value="default" />

        <div>
          <div className="text-sm mb-1 opacity-80">Tracking subdomain (optional)</div>
          <Input name="trackingSubdomain" placeholder="t.%d" />
          <div className="text-xs opacity-60 mt-1">For bulk add, use <b>%d</b> as the domain placeholder (e.g. <b>t.%d</b>).</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-medium">Outbound IPs (used for SPF)</div>
            <div className="text-xs opacity-70">one per line</div>
            <div className="ml-auto flex items-center gap-2">
              {parsed.invalid.length ? <Badge tone="danger">{parsed.invalid.length} invalid</Badge> : <Badge tone="success">valid</Badge>}
              <Button type="button" variant="ghost" onClick={fetchIps}>Detect from server</Button>
            </div>
          </div>

          {ipsErr ? <div className="text-xs text-red-700 mt-2">{ipsErr}</div> : null}

          {detectedPublicIps.length || detectedPrivateIps.length ? (
            <div className="mt-2 grid gap-2">
              {detectedPublicIps.length ? (
                <div>
                  <div className="text-xs opacity-70 mb-1">Detected public IPv4</div>
                  <div className="flex flex-wrap gap-2">
                    {detectedPublicIps.map((ip) => (
                      <label key={ip} className="flex items-center gap-2 text-xs rounded-full border border-slate-200 px-3 py-1 bg-white">
                        <input
                          type="checkbox"
                          checked={!!selectedIps[ip]}
                          onChange={(e) => setSelectedIps((m) => ({ ...m, [ip]: e.target.checked }))}
                        />
                        <span className="font-mono">{ip}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
              {detectedPrivateIps.length ? (
                <details className="text-xs">
                  <summary className="cursor-pointer opacity-70">Show private IPv4 (usually NOT for SPF)</summary>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {detectedPrivateIps.map((ip) => (
                      <label key={ip} className="flex items-center gap-2 text-xs rounded-full border border-slate-200 px-3 py-1 bg-white">
                        <input
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

              <label className="flex items-center gap-2 text-xs opacity-80">
                <input type="checkbox" checked={manualIps} onChange={(e) => setManualIps(e.target.checked)} />
                Manual override (edit text)
              </label>
            </div>
          ) : (
            <div className="mt-2 text-xs opacity-70">No IPs detected yet.</div>
          )}

          <Textarea
            name="outboundIps"
            value={outboundIps}
            onChange={(e) => setOutboundIps(e.target.value)}
            readOnly={!manualIps}
            rows={4}
            placeholder={`51.38.38.222\n51.38.38.223\n...`}
            className="mt-2"
          />

          <div className="mt-2 text-xs opacity-70">
            These IPs are saved as workspace defaults and automatically included in the <b>SPF suggestion</b> for new domains.
          </div>

          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs opacity-70 mb-1">SPF preview (TXT at root)</div>
            <div className="font-mono text-xs break-words">{spfPreview}</div>
          </div>

          {parsed.invalid.length ? (
            <div className="mt-2 text-xs text-red-700">
              Invalid lines ignored: {parsed.invalid.slice(0, 6).join(", ")}
              {parsed.invalid.length > 6 ? "…" : ""}
            </div>
          ) : null}
        </div>

        <div>
          <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="text-sm underline opacity-80">
            {showAdvanced ? "Hide" : "Show"} Cloudflare / server settings
          </button>
        </div>

        {showAdvanced ? (
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <div className="text-sm mb-1 opacity-80">Server IP (for mail.&lt;domain&gt; A record)</div>
              <Input name="serverIp" value={serverIp} onChange={(e) => setServerIp(e.target.value)} placeholder="51.38.38.222" />
              <div className="text-xs opacity-60 mt-1">Used for A record suggestions and Mailstack provisioning defaults.</div>
            </div>
            <div>
              <div className="text-sm mb-1 opacity-80">Cloudflare API token (optional)</div>
              <Input name="cloudflareToken" placeholder={hasCloudflareToken ? "(already connected — paste to replace)" : "CF API token"} />
              <div className="text-xs opacity-60 mt-1">Permissions: <b>Zone:Read</b> + <b>DNS:Edit</b>.</div>
            </div>
          </div>
        ) : null}

        <Button type="submit" disabled={!tenantName.trim() || !parsedDomains.ok.length}>Create</Button>
      </form>

      <div className="text-xs opacity-70 mt-3">
        After creating, the server will generate DKIM keys for the tenant and sync the <b>real</b> DKIM TXT value into the app.
        If you open a domain immediately, you may briefly see “DKIM pending” until the prepare job finishes.
      </div>
    </Card>
  );
}
