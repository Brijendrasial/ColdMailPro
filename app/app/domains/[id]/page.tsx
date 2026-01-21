import { Container, Card, Pill } from "@/components/ui";
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
    <Container>
      <div className="grid gap-4">
        <Card title={`Domain: ${d.name}`}>
          <div className="text-sm opacity-80">
            Below are suggested DNS records. Adjust SPF to include your real sending IP(s) and provider rules.
          </div>
        </Card>

        <Card
          title="DNS Health Check"
          right={
            <DnsCheckButton domainId={d.id} disabled={pending} />
          }
        >
          <div className="flex items-center gap-2 flex-wrap">
            {healthPill(String(summary?.status || "unknown"), pending)}
            <div className="text-sm opacity-70">score: {Math.round(Number(summary?.score || 0))}/100</div>
            <div className="text-sm opacity-70">last: {latest?.checkedAt ? new Date(latest.checkedAt).toLocaleString() : "—"}</div>
          </div>
          {Array.isArray(summary?.issues) && summary.issues.length ? (
            <div className="mt-2 text-sm">
              <div className="font-medium mb-1">Issues</div>
              <ul className="list-disc pl-5 opacity-80">
                {summary.issues.slice(0, 8).map((x: string, i: number) => <li key={i}>{x}</li>)}
              </ul>
            </div>
          ) : (
            <div className="mt-2 text-sm opacity-70">No issues found (or not checked yet).</div>
          )}
          {rec ? (
            <div className="mt-3 text-xs opacity-80 grid gap-1">
              <div><b>SPF</b>: {rec?.spf?.detail || "—"}</div>
              <div><b>DKIM</b>: {rec?.dkim?.detail || "—"}</div>
              <div><b>DMARC</b>: {rec?.dmarc?.detail || "—"}</div>
              <div><b>MX</b>: {rec?.mx?.detail || "—"}</div>
            </div>
          ) : null}
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
          <Card title="Mailstack provisioning">
            {!hasMailstackModels ? (
              <div className="text-sm opacity-80">Mailstack models are not available in this build.</div>
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

          <Card title="DKIM rotation (zero‑downtime)">
            <div className="grid gap-3">
              <div>
                <div className="text-sm opacity-80 mb-2">
                  <b>Active</b>: selector <b>{selector}</b> &nbsp;•&nbsp; TXT <b>{dkimName}</b>
                </div>
                <pre className="text-xs whitespace-pre-wrap break-words">{dkimValue}</pre>
              </div>

              {hasPendingDkim ? (
                <div>
                  <div className="text-sm opacity-80 mb-2">
                    <b>Staged</b>: selector <b>{pendingSelector}</b> &nbsp;•&nbsp; TXT <b>{pendingName}</b>
                  </div>
                  <pre className="text-xs whitespace-pre-wrap break-words">{pendingValue}</pre>
                  <div className="text-xs opacity-70 mt-1">
                    Publish this staged TXT record in DNS first (Manual DNS tab). When it resolves, click Activate.
                  </div>
                </div>
              ) : (
                <div className="text-xs opacity-70">
                  No staged DKIM yet. Use <b>Stage DKIM (safe)</b> to generate a new selector without breaking Gmail DKIM.
                </div>
              )}

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
                <div className="text-xs opacity-70">
                  To stage/activate DKIM from the app, first provision this domain into a Mailstack tenant.
                </div>
              )}
            </div>
          </Card>
        </DomainDnsTabs>

        {d.trackingSubdomain ? (
          <Card title="Tracking CNAME (suggested)">
            <div className="text-sm opacity-80 mb-2"><b>Name</b>: {d.trackingSubdomain}</div>
            <pre className="text-xs whitespace-pre-wrap break-words">{process.env.PUBLIC_APP_URL ?? "https://app.yourdomain.com"}</pre>
            <div className="text-xs opacity-70 mt-2">
              Better approach: point tracking subdomain to your app domain (CNAME to app host).
            </div>
          </Card>
        ) : null}

        <Card title="Danger zone">
          <div className="text-sm opacity-80">
            This removes the domain from the app and deletes any mailboxes whose email ends with <b>@{d.name}</b>.
          </div>
          <div className="mt-3">
            <DeleteDomainButton domainId={d.id} domainName={d.name} />
          </div>
          <div className="text-xs opacity-70 mt-2">
            Note: this does not automatically delete the mailbox accounts from the Mailstack server OS. It unlinks and removes them from the app.
          </div>
        </Card>
      </div>
    </Container>
  );
}
