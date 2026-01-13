"use client";

import React, { useMemo, useState, useContext } from "react";
import { Badge, Button, Card, Input, Textarea } from "@/components/ui";

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
          // ignore
        }
      }}
    >
      {ok ? "Copied" : label}
    </Button>
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

  // Security UX: never prefill the real Cloudflare token into the DOM.
  // If a token exists (saved from Mailstack tab), show a masked indicator and allow replacement.
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
      setMsg(`✅ DNS sync queued (job: ${j?.jobId || "?"}). Refresh in ~10–30s.`);
    } catch (e: any) {
      setMsg(`❌ ${String(e?.message || e || "DNS_SYNC_FAILED")}`);
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
      setDetectMsg(`❌ ${String(e?.message || e || "FAILED")}`);
    } finally {
      setDetectBusy(false);
    }
  }

  return (
    <DnsTabCtx.Provider value={{ tab }}>
    <div className="grid gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setTab("cloudflare")}
          className={`px-3 py-1.5 rounded-xl text-sm border ${
            tab === "cloudflare" ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200"
          }`}
        >
          Cloudflare DNS
        </button>
        <button
          type="button"
          onClick={() => setTab("manual")}
          className={`px-3 py-1.5 rounded-xl text-sm border ${
            tab === "manual" ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200"
          }`}
        >
          Manual DNS
        </button>
        <div className="ml-auto flex items-center gap-2">
          {tenantName ? <Badge>tenant: {tenantName}</Badge> : <Badge>no tenant linked</Badge>}
          {tab === "cloudflare" ? (
            hasCloudflareToken ? <Badge>cloudflare: connected</Badge> : <Badge>cloudflare: not connected</Badge>
          ) : (
            <Badge>manual DNS</Badge>
          )}
          <Badge>{parsed.uniq.length} outbound IP{parsed.uniq.length === 1 ? "" : "s"}</Badge>
        </div>
      </div>

      {tab === "cloudflare" ? (
        <div className="grid gap-4">
          <Card title="Cloudflare DNS + sending defaults">
            <p className="text-sm opacity-80">
              Connect Cloudflare for <b>one‑click DNS sync</b> (SPF/DKIM/DMARC/MX/A) and keep your <b>outbound IP pool</b> here so SPF suggestions are correct.
            </p>

            <div className="mt-4 grid gap-3">
              <form className="grid gap-3" action="/api/domains/cloudflare/save" method="post">
                <input type="hidden" name="domainId" value={domainId} />
                <input type="hidden" name="redirectTo" value={redirectPath} />

                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs opacity-70 mb-1">Server IP (for mail.{domainName} A record)</div>
                    <Input name="serverIp" defaultValue={safeTrim(defaultServerIp)} placeholder="51.38.38.222" />
                    <div className="text-xs opacity-60 mt-1">Used for A/MX defaults and Mailstack provisioning.</div>
                  </div>
                  <div>
                    <div className="text-xs opacity-70 mb-1">Cloudflare API token</div>
                    {hasCloudflareToken && !replaceCloudflareToken ? (
                      <div className="flex items-center gap-2">
                        {/* Masked indicator (not submitted) */}
                        <Input value="•••••••••••• (saved)" disabled aria-label="Cloudflare token saved" />
                        <Button type="button" variant="ghost" onClick={() => setReplaceCloudflareToken(true)}>
                          Replace
                        </Button>
                      </div>
                    ) : (
                      <Input
                        name="cloudflareToken"
                        placeholder={hasCloudflareToken ? "Paste new token to replace" : "CF API token"}
                        autoComplete="off"
                      />
                    )}
                    <div className="text-xs opacity-60 mt-1">
                      Permissions: <b>Zone:Read</b> + <b>DNS:Edit</b>. {hasCloudflareToken ? "(Using token saved in Mailstack settings.)" : ""}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-xs opacity-70 mb-1">Outbound IPs (one per line — used in SPF suggestions)</div>
                    <div className="ml-auto">
                      <Button type="button" variant="ghost" onClick={detectOutboundIps} disabled={detectBusy}>
                        {detectBusy ? "Detecting…" : "Detect from server"}
                      </Button>
                    </div>
                  </div>
                  <Textarea name="outboundIps" value={outIps} onChange={(e) => setOutIps(e.target.value)} rows={4} placeholder={`51.38.38.222\n51.38.38.223`} />
                  {detectMsg ? <div className="text-xs opacity-70 mt-1">{detectMsg}</div> : null}
                  {parsed.invalid.length ? (
                    <div className="text-xs text-red-700 mt-1">Invalid lines ignored: {parsed.invalid.slice(0, 6).join(", ")}{parsed.invalid.length > 6 ? "…" : ""}</div>
                  ) : (
                    <div className="text-xs opacity-60 mt-1">Saved as workspace defaults (used for SPF suggestions before a tenant IP pool exists).</div>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <Button type="submit">Save settings</Button>
                  <Copy text={safeTrim(defaultServerIp)} label="Copy server IP" />
                  <Copy text={zoneText} label="Copy all DNS records" />
                  {parsed.invalid.length ? <Badge tone="danger">{parsed.invalid.length} invalid IP line{parsed.invalid.length === 1 ? "" : "s"}</Badge> : null}
                </div>
              </form>

              <div className="flex items-center gap-2 flex-wrap">
                <form action="/api/domains/cloudflare/init" method="post">
                  <input type="hidden" name="domainId" value={domainId} />
                  <input type="hidden" name="redirectTo" value={redirectPath} />
                  <Button type="submit" variant="ghost">Initialize Cloudflare for SSL automation</Button>
                </form>

                {tenantId ? (
                  <Button type="button" onClick={syncNow} disabled={busySync || !hasCloudflareToken}>
                    {busySync ? "Syncing…" : "Sync DNS now"}
                  </Button>
                ) : null}
              </div>

              {msg ? <div className="text-sm">{msg}</div> : null}
            </div>
          </Card>

          {children}
        </div>
      ) : (
        <div className="grid gap-4">
          <Card title="Sending defaults (SPF builder)">
            <p className="text-sm opacity-80">
              Store your <b>outbound IP pool</b> here so SPF suggestions stay accurate across all domains in this workspace.
            </p>
            <form className="mt-4 grid gap-3" action="/api/domains/dns-defaults/save" method="post">
              <input type="hidden" name="domainId" value={domainId} />
              <input type="hidden" name="redirectTo" value={redirectPath} />
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs opacity-70 mb-1">Server IP (for mail.{domainName} A record)</div>
                  <Input name="serverIp" defaultValue={safeTrim(defaultServerIp)} placeholder="51.38.38.222" />
                </div>
                <div>
                  <div className="text-xs opacity-70 mb-1">Outbound IPs (one per line)</div>
                  <div className="flex items-center gap-2">
                    <div className="text-xs opacity-70">Detect from server to avoid wrong IPs.</div>
                    <div className="ml-auto">
                      <Button type="button" variant="ghost" onClick={detectOutboundIps} disabled={detectBusy}>
                        {detectBusy ? "Detecting…" : "Detect"}
                      </Button>
                    </div>
                  </div>
                  <Textarea name="outboundIps" value={outIps} onChange={(e) => setOutIps(e.target.value)} rows={4} placeholder={`51.38.38.222\n51.38.38.223`} />
                  {detectMsg ? <div className="text-xs opacity-70 mt-1">{detectMsg}</div> : null}
                  {parsed.invalid.length ? (
                    <div className="text-xs text-red-700 mt-1">Invalid lines ignored: {parsed.invalid.slice(0, 6).join(", ")}{parsed.invalid.length > 6 ? "…" : ""}</div>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button type="submit">Save defaults</Button>
                <Copy text={zoneText} label="Copy all records" />
              </div>
            </form>
          </Card>

          <Card title="Manual DNS (copy/paste)">
            <p className="text-sm opacity-80">Use these records in your DNS provider. TTL suggestions are included.</p>

            <div className="mt-4 grid gap-3">
              {dnsRows.map((r, idx) => (
                <div key={idx} className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge>{r.type}</Badge>
                    <div className="font-medium break-all">{r.name}</div>
                    <div className="ml-auto flex items-center gap-2">
                      {typeof r.ttl === "number" ? <Badge>TTL {r.ttl}</Badge> : null}
                      {typeof r.priority === "number" ? <Badge>prio {r.priority}</Badge> : null}
                      <Copy text={r.value} />
                    </div>
                  </div>
                  <Textarea readOnly rows={r.type === "TXT" ? 3 : 2} value={r.value} className="mt-2" />
                </div>
              ))}
            </div>
          </Card>

          {children}
        </div>
      )}
    </div>
    </DnsTabCtx.Provider>
  );
}
