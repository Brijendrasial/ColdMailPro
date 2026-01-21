import { Container, Card, PageHeader, Button } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import DomainsClient from "./DomainsClient";
import AddDomainCard from "./AddDomainCard";

export default async function Domains() {
  const s = await requireSession();
  const cfg = await prisma.mailstackConfig.findUnique({ where: { workspaceId: s.wid } });

  // Tenants are optional on some builds (older Prisma client). Guard at runtime.
  const p: any = prisma as any;
  const tenants: { id: string; name: string }[] = p.mailstackTenant?.findMany
    ? await p.mailstackTenant.findMany({
        where: { workspaceId: s.wid },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true },
      })
    : [];

  const initialServerIp = String(cfg?.serverIp || process.env.HOST_IP || "");
  const initialOutboundIps = String((cfg as any)?.outboundIpsText || "");
  const hasCloudflareToken = !!cfg?.cloudflareTokenEnc;

  return (
    <Container>
      <PageHeader
        title="Domains"
        subtitle="Generate DKIM keys, build SPF with your outbound IP pool, and verify DNS health (SPF/DKIM/DMARC/MX)."
        right={
          <div className="flex items-center gap-2">
            <a href="/app/mailstack">
              <Button variant="ghost">Mailstack settings</Button>
            </a>
          </div>
        }
      />

      <div className="mt-4 glass p-4 sm:p-5">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="text-sm">
            <div className="font-medium">1) Add domains</div>
            <div className="text-xs text-slate-600 mt-0.5">Paste a list and we’ll prepare DKIM keys automatically.</div>
          </div>
          <div className="text-sm">
            <div className="font-medium">2) Add DNS records</div>
            <div className="text-xs text-slate-600 mt-0.5">Use the suggested SPF/DKIM/DMARC/MX (or sync via Cloudflare).</div>
          </div>
          <div className="text-sm">
            <div className="font-medium">3) Check health → create mailboxes</div>
            <div className="text-xs text-slate-600 mt-0.5">Run a DNS check, then proceed to mailbox provisioning.</div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 mt-6">
        <AddDomainCard
          initialServerIp={initialServerIp}
          initialOutboundIps={initialOutboundIps}
          hasCloudflareToken={hasCloudflareToken}
          tenants={tenants}
        />

        <Card title="Existing">
          <DomainsClient />
        </Card>
      </div>
    </Container>
  );
}
