import { Container, Card } from "@/components/ui";
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
      <div className="text-xl font-semibold mb-4">Domains (DKIM/SPF/Tracking)</div>

      <div className="grid gap-4">
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
