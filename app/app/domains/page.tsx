import Link from "next/link";
import { Container, Card, PageHeader, Button, Pill } from "@/components/ui";
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
  const outboundCount = initialOutboundIps.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).length;

  return (
    <Container wide className="max-w-[1600px]">
      <div className="grid gap-6">
        <PageHeader
          title="Domain Control Center"
          subtitle="Launch sending domains with clean DKIM, SPF, DMARC, MX, Cloudflare sync, health checks, and Mailstack provisioning from one focused workspace."
          right={
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <Pill tone={hasCloudflareToken ? "success" : "neutral"}>{hasCloudflareToken ? "Cloudflare connected" : "Cloudflare optional"}</Pill>
              <Pill tone={outboundCount ? "info" : "warning"}>{outboundCount || 0} outbound IP{outboundCount === 1 ? "" : "s"}</Pill>
              <Link href="/app/mailstack">
                <Button variant="ghost">Mailstack settings</Button>
              </Link>
            </div>
          }
        />

        <section className="grid gap-4 lg:grid-cols-3">
          {[
            ["01", "Add domains", "Paste one domain or a whole batch. DKIM keys and DNS suggestions are prepared automatically."],
            ["02", "Publish records", "Copy records manually or sync SPF, DKIM, DMARC, MX, and A records with Cloudflare."],
            ["03", "Verify + provision", "Run DNS health checks, then create Mailstack tenants and mailboxes with safer defaults."],
          ].map(([num, title, body]) => (
            <div key={num} className="relative overflow-hidden rounded-[1.75rem] border border-white/70 bg-white/82 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.07)] backdrop-blur-xl">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-400" />
              <div className="flex items-start gap-4">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-950 text-sm font-semibold text-white shadow-lg">{num}</div>
                <div>
                  <div className="font-display text-lg font-semibold text-slate-950">{title}</div>
                  <div className="mt-1 text-sm leading-6 text-slate-600">{body}</div>
                </div>
              </div>
            </div>
          ))}
        </section>

        <AddDomainCard
          initialServerIp={initialServerIp}
          initialOutboundIps={initialOutboundIps}
          hasCloudflareToken={hasCloudflareToken}
          tenants={tenants}
        />

        <Card
          title="Domain fleet"
          subtitle="Monitor DNS health, record status, Mailstack linkage, and high-impact fixes across every sending domain."
        >
          <DomainsClient />
        </Card>
      </div>
    </Container>
  );
}
