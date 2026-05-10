import Link from "next/link";
import { Container, Card, Pill, Button } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ProvisionMailstackClient from "./ProvisionMailstackClient";
import DeleteDomainButton from "./DeleteDomainButton";
import DnsCheckButton from "./DnsCheckButton";
import DomainDnsTabs from "./DomainDnsTabs";
import DkimRotationPanel from "./DkimRotationPanel";

function safeJsonParse(v: any) {
  try {
    return JSON.parse(String(v || "{}"));
  } catch {
    return null;
  }
}

function healthPill(status: string, pending: boolean) {
  if (pending) return <Pill tone="info">checking…</Pill>;
  if (status === "healthy") return <Pill tone="success">healthy</Pill>;
  if (status === "warning") return <Pill tone="warning">needs work</Pill>;
  if (status === "fail") return <Pill tone="danger">misconfigured</Pill>;
  return <Pill tone="neutral">not checked</Pill>;
}

function isIPv4(v: string) {
  // strict-enough for config inputs
  return /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(v);
}

function buildSpf(ips: string[]) {
  const uniq = Array.from(new Set(ips.filter(isIPv4)));
  if (uniq.length === 0) return "v=spf1 a mx ~all";
  return `v=spf1 a mx ${uniq.map((ip) => `ip4:${ip}`).join(" ")} -all`;
}

function parseOutboundIpsText(text: any): string[] {
  const ips = String(text || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter(isIPv4);
  return Array.from(new Set(ips));
}

export default async function DomainDetail({ params }: { params: { id: string } }) {
  const s = await requireSession();
  const d = await prisma.domain.findFirst({ where: { id: params.id, workspaceId: s.wid } });
  if (!d) return <Container><Card title="Not found">Domain not found.</Card></Container>;

  // latest DNS check (job.lastError stores JSON result)
  const jobs = await prisma.job.findMany({
    where: {
      type: "domain_dns_check",
      status: { in: ["queued", "running", "done", "failed"] },
      payload: { contains: d.id },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { status: true, payload: true, lastError: true, createdAt: true },
  });

  let pending = false;
  let latest: any = null;
  for (const j of jobs as any[]) {
    const p = safeJsonParse(j.payload);
    if (!p) continue;
    if (String(p.workspaceId || "") !== String(s.wid)) continue;
    if (String(p.domainId || "") !== String(d.id)) continue;
    if (j.status === "queued" || j.status === "running") {
      pending = true;
      continue;
    }
    if (!latest) {
      latest = safeJsonParse(j.lastError) || { checkedAt: j.createdAt?.toISOString?.() };
    }
  }

  const summary = latest?.summary || null;
  const rec = latest?.records || null;

  const selector = d.dkimSelector && String(d.dkimSelector).toLowerCase() !== "cm" ? d.dkimSelector : "default";
  const dkimName = `${selector}._domainkey.${d.name}`;
  const dkimValue = d.dkimPublic
    ? `v=DKIM1; k=rsa; p=${d.dkimPublic}`
    : "(generated on server after Mailstack provisioning / DKIM sync)";

  // Staged DKIM (zero‑downtime rotation)
  const pendingSelector = (d as any)?.pendingDkimSelector ? String((d as any).pendingDkimSelector) : "";
  const pendingName = pendingSelector ? `${pendingSelector}._domainkey.${d.name}` : "";
  const pendingValue = pendingSelector && (d as any)?.pendingDkimPublic
    ? `v=DKIM1; k=rsa; p=${String((d as any).pendingDkimPublic)}`
    : "";
  const hasPendingDkim = !!pendingSelector;

  // SPF suggestion: include the Mailstack tenant IP pool if present.
  // Guard for the common case where Prisma Client was generated from an older schema.
  const p: any = prisma as any;
  const hasMailstackModels = !!p.mailstackTenantDomain && !!p.mailstackConfig;

  const tenantDomain = hasMailstackModels
    ? await p.mailstackTenantDomain.findFirst({
        where: {
          domainName: d.name,
          tenant: { workspaceId: s.wid },
        },
        include: { tenant: { include: { ips: true } } },
      })
    : null;

  const cfg = hasMailstackModels ? await p.mailstackConfig.findUnique({ where: { workspaceId: s.wid } }) : null;
  const hasCloudflareToken = !!cfg?.cloudflareTokenEnc;
  const ipPool = tenantDomain?.tenant?.ips?.map((x: any) => x.ip) ?? [];
  const outboundCfgIps = parseOutboundIpsText((cfg as any)?.outboundIpsText);
  const outboundIpsText = String((cfg as any)?.outboundIpsText || "");

  // Fallback to configured server IP, then to the app host.
  let fallbackIp = cfg?.serverIp ?? process.env.HOST_IP ?? "";
  if (!fallbackIp && process.env.PUBLIC_APP_URL) {
    try {
      const u = new URL(process.env.PUBLIC_APP_URL);
      fallbackIp = u.hostname;
    } catch {}
  }

  const spfBaseIps = ipPool.length
    ? ipPool
    : outboundCfgIps.length
      ? outboundCfgIps
      : (isIPv4(fallbackIp) ? [fallbackIp] : []);
  const spfValue = buildSpf(spfBaseIps);
  const dmarcName = `_dmarc.${d.name}`;
  const dmarcValue = `v=DMARC1; p=none; rua=mailto:dmarc@${d.name}; ruf=mailto:dmarc@${d.name}; fo=1`;

  const mailHost = `mail.${d.name}`;
  const aValue = isIPv4(fallbackIp) ? fallbackIp : "";
  const mxValue = mailHost;
  const tenantNameDefault = (`auto-${d.name.replace(/\./g, "-")}`).slice(0, 48);
  const existingTenantId = tenantDomain?.tenant?.id ? String(tenantDomain.tenant.id) : "";
  const existingTenantName = tenantDomain?.tenant?.name ? String(tenantDomain.tenant.name) : "";

  const dnsRows = [
    { type: "A", name: mailHost, value: aValue || "(set your mail server IPv4)", ttl: 120 },
    { type: "MX", name: d.name, value: mxValue, ttl: 120, priority: 10 },
    { type: "TXT", name: d.name, value: spfValue, ttl: 120 },
    { type: "TXT", name: dkimName, value: dkimValue, ttl: 120 },
    ...(hasPendingDkim && pendingName && pendingValue
      ? [{ type: "TXT", name: pendingName, value: pendingValue, ttl: 120 }]
      : []),
    { type: "TXT", name: dmarcName, value: dmarcValue, ttl: 120 },
  ];

  return (
    <Container wide className="max-w-[1500px]">
      <div className="grid gap-6">
        <section className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-slate-950 text-white shadow-[0_30px_100px_rgba(15,23,42,0.24)]">
          <div className="absolute inset-0 bg-[radial-gradient(900px_circle_at_0%_0%,rgba(99,102,241,0.32),transparent_42%),radial-gradient(760px_circle_at_100%_0%,rgba(20,184,166,0.25),transparent_40%)]" />
          <div className="relative p-6 sm:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Domain workspace
                </div>
                <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight sm:text-5xl">{d.name}</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                  Publish DNS records, verify propagation, provision mailboxes, and rotate DKIM without breaking active sending.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap lg:justify-end">
                {healthPill(String(summary?.status || "unknown"), pending)}
                <Pill tone="info">score {Math.round(Number(summary?.score || 0))}/100</Pill>
                {existingTenantName ? <Pill tone="success">tenant {existingTenantName}</Pill> : <Pill tone="neutral">no tenant linked</Pill>}
                <Link href="/app/domains"><Button variant="ghost" className="bg-white/10 text-white border-white/15 hover:bg-white/15">Back to domains</Button></Link>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-4">
          <div className="rounded-[1.6rem] border border-white/70 bg-white/82 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.07)]">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Health score</div>
            <div className="mt-2 font-display text-4xl font-semibold text-slate-950">{Math.round(Number(summary?.score || 0))}</div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-400" style={{ width: `${Math.max(0, Math.min(100, Math.round(Number(summary?.score || 0))))}%` }} />
            </div>
          </div>
          <div className="rounded-[1.6rem] border border-white/70 bg-white/82 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.07)]">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">DKIM selector</div>
            <div className="mt-2 font-mono text-2xl font-semibold text-slate-950">{selector}</div>
            <div className="mt-1 text-xs text-slate-500">{hasPendingDkim ? "staged key waiting" : "active key"}</div>
          </div>
          <div className="rounded-[1.6rem] border border-white/70 bg-white/82 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.07)]">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Outbound IPs</div>
            <div className="mt-2 font-display text-4xl font-semibold text-slate-950">{spfBaseIps.length}</div>
            <div className="mt-1 text-xs text-slate-500">used in SPF suggestion</div>
          </div>
          <div className="rounded-[1.6rem] border border-white/70 bg-white/82 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.07)]">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Last check</div>
            <div className="mt-2 text-lg font-semibold text-slate-950">{latest?.checkedAt ? new Date(latest.checkedAt).toLocaleString() : "—"}</div>
            <div className="mt-2"><DnsCheckButton domainId={d.id} disabled={pending} /></div>
          </div>
        </div>

        <Card title="DNS health radar" subtitle="A quick read on the required records before provisioning or sending.">
          <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
            <div className="rounded-[1.6rem] border border-slate-200/80 bg-slate-50/80 p-5">
              <div className="flex items-center gap-2 flex-wrap">
                {healthPill(String(summary?.status || "unknown"), pending)}
                <span className="text-sm text-slate-500">Required records must pass before mailbox provisioning unlocks.</span>
              </div>
              {Array.isArray(summary?.issues) && summary.issues.length ? (
                <div className="mt-4">
                  <div className="text-sm font-semibold text-slate-950">What needs attention</div>
                  <ul className="mt-2 grid gap-2 text-sm leading-6 text-slate-700">
                    {summary.issues.slice(0, 8).map((x: string, i: number) => <li key={i} className="rounded-2xl border border-amber-200 bg-amber-50/80 px-3 py-2">{x}</li>)}
                  </ul>
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 text-sm text-emerald-800">No issues found, or DNS has not been checked yet.</div>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["SPF", rec?.spf?.detail || "—"],
                ["DKIM", rec?.dkim?.detail || "—"],
                ["DMARC", rec?.dmarc?.detail || "—"],
                ["MX", rec?.mx?.detail || "—"],
              ].map(([label, detail]) => (
                <div key={label} className="rounded-[1.4rem] border border-slate-200/80 bg-white/80 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
                  <div className="mt-2 text-sm leading-6 text-slate-700 break-words">{detail}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <DomainDnsTabs
          domainId={d.id}
          domainName={d.name}
          hasCloudflareToken={hasCloudflareToken}
          defaultServerIp={cfg?.serverIp || process.env.HOST_IP || ""}
          outboundIpsText={outboundIpsText}
          redirectTo={`/app/domains/${d.id}`}
          tenantId={existingTenantId || undefined}
          tenantName={existingTenantName || undefined}
          dnsRows={dnsRows as any}
        >
          <Card title="Mailstack provisioning" subtitle="Create or update the tenant, outbound IP pool, mailbox users, HELO, and DMARC defaults.">
            {!hasMailstackModels ? (
              <div className="text-sm text-slate-600">Mailstack models are not available in this build.</div>
            ) : (
              <ProvisionMailstackClient
                domainId={d.id}
                domainName={d.name}
                mailHost={mailHost}
                expectedIp={aValue}
                defaultTenantName={tenantNameDefault}
                defaultServerIp={cfg?.serverIp || process.env.HOST_IP || ""}
                defaultOutboundIps={outboundCfgIps.length ? outboundCfgIps : (isIPv4(fallbackIp) ? [fallbackIp] : [])}
                defaultHeloTemplate={cfg?.heloTemplate || "mail.%d"}
                defaultDmarcPolicy={cfg?.dmarcPolicy || "none"}
                defaultDmarcRuaTemplate={cfg?.dmarcRuaTemplate || "dmarc@%d"}
                existingTenantId={existingTenantId || undefined}
                existingTenantName={existingTenantName || undefined}
                existingServerIp={tenantDomain?.tenant?.serverIp || undefined}
                existingOutboundIps={tenantDomain?.tenant?.ips?.map((x: any) => x.ip) || undefined}
                existingHeloTemplate={tenantDomain?.tenant?.heloTemplate || undefined}
                existingDmarcPolicy={tenantDomain?.tenant?.dmarcPolicy || undefined}
                existingDmarcRuaTemplate={tenantDomain?.tenant?.dmarcRuaTemplate || undefined}
                initialResult={latest}
              />
            )}
          </Card>

          <Card title="DKIM rotation studio" subtitle="Stage a fresh selector, publish it, then activate without breaking the current key.">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[1.5rem] border border-slate-200/80 bg-white/80 p-4">
                <div className="text-sm font-semibold text-slate-950">Active DKIM</div>
                <div className="mt-1 text-xs text-slate-500">selector <b>{selector}</b> · TXT <b>{dkimName}</b></div>
                <pre className="mt-3 max-h-44 overflow-auto rounded-2xl border border-slate-200 bg-slate-950 p-3 text-xs text-slate-100 whitespace-pre-wrap break-words">{dkimValue}</pre>
              </div>

              <div className="rounded-[1.5rem] border border-slate-200/80 bg-white/80 p-4">
                <div className="text-sm font-semibold text-slate-950">Staged DKIM</div>
                {hasPendingDkim ? (
                  <>
                    <div className="mt-1 text-xs text-slate-500">selector <b>{pendingSelector}</b> · TXT <b>{pendingName}</b></div>
                    <pre className="mt-3 max-h-44 overflow-auto rounded-2xl border border-slate-200 bg-slate-950 p-3 text-xs text-slate-100 whitespace-pre-wrap break-words">{pendingValue}</pre>
                    <div className="mt-2 text-xs text-slate-500">Publish this staged TXT record first. When it resolves, activate it.</div>
                  </>
                ) : (
                  <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No staged DKIM yet.</div>
                )}
              </div>
            </div>

            <div className="mt-4">
              {hasMailstackModels && existingTenantId ? (
                <DkimRotationPanel
                  domainId={d.id}
                  domainName={d.name}
                  tenantId={existingTenantId}
                  tenantName={existingTenantName || tenantNameDefault}
                  hasPending={hasPendingDkim}
                  pendingSelector={pendingSelector}
                  hasCloudflareToken={hasCloudflareToken}
                />
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600">
                  To stage/activate DKIM from the app, first provision this domain into a Mailstack tenant.
                </div>
              )}
            </div>
          </Card>
        </DomainDnsTabs>

        <div className="grid gap-6 lg:grid-cols-2">
          {d.trackingSubdomain ? (
            <Card title="Tracking CNAME" subtitle="Point tracking to the app host for click/open tracking.">
              <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 text-sm">
                <div><b>Name:</b> {d.trackingSubdomain}</div>
                <pre className="mt-3 whitespace-pre-wrap break-words rounded-2xl bg-slate-950 p-3 text-xs text-slate-100">{process.env.PUBLIC_APP_URL ?? "https://app.yourdomain.com"}</pre>
              </div>
            </Card>
          ) : null}

          <Card title="Danger zone" subtitle="Remove this domain from the app only when you are sure.">
            <div className="rounded-2xl border border-red-200 bg-red-50/70 p-4 text-sm text-red-900">
              This removes the domain from the app and deletes mailboxes whose email ends with <b>@{d.name}</b> from the app database.
            </div>
            <div className="mt-4"><DeleteDomainButton domainId={d.id} domainName={d.name} /></div>
            <div className="mt-2 text-xs text-slate-500">It does not automatically delete operating-system mailbox accounts on the Mailstack server.</div>
          </Card>
        </div>
      </div>
    </Container>
  );
}
