import { Container, Card, Button, Badge } from "@/components/ui";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { ResetTenantForm } from "@/components/mailstack/reset-tenant-form";

export default async function TenantPage({ params }: { params: { id: string } }) {
  const s = await requireSession();
  const ws = await prisma.workspace.findUnique({ where: { id: s.wid }, select: { name: true } });
  const t = await prisma.mailstackTenant.findFirst({
    where: { id: params.id, workspaceId: s.wid },
    include: { domains: true, ips: true, users: true, mailboxes: true },
  });
  if (!t) return notFound();

  return (
    <Container>
      <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
        <div className="min-w-0">
          <div className="text-2xl font-semibold">🛠️ Mailstack</div>
          <div className="text-sm opacity-70 mt-1 truncate">
            Workspace: <span className="font-medium">{ws?.name || "Workspace"}</span>{" "}
            <span className="font-mono text-xs opacity-80">({s.wid.slice(0, 8)})</span>
          </div>
        </div>
        <Link href="/app/mailstack" className="text-xs underline opacity-80">Back to Mailstack</Link>
      </div>
      <div className="grid gap-6">
        <Card title={`Tenant: ${t.name}`}>
          <div className="flex flex-wrap gap-2 items-center">
            <Badge>Status: {t.status}</Badge>
            <Badge>Server IP: {t.serverIp}</Badge>
            {t.lastJobStatus ? <Badge>Last job: {t.lastJobStatus}</Badge> : null}
          </div>

          <div className="mt-4 flex gap-3 flex-wrap">
            <form action="/api/mailstack/tenant/sync" method="post">
              <input type="hidden" name="tenantId" value={t.id} />
              <Button variant="ghost" type="submit">DNS sync</Button>
            </form>
            <form action="/api/mailstack/tenant/rotate" method="post">
              <input type="hidden" name="tenantId" value={t.id} />
              <Button variant="ghost" type="submit">Rotate now</Button>
            </form>
            <form action="/api/mailstack/tenant/rebuild" method="post">
              <input type="hidden" name="tenantId" value={t.id} />
              <Button variant="ghost" type="submit">Exim rebuild</Button>
            </form>
            <form action="/api/mailstack/tenant/ssl" method="post">
              <input type="hidden" name="tenantId" value={t.id} />
              <Button variant="ghost" type="submit">Issue SSL</Button>
            </form>
            <a href={`/api/mailstack/tenant/mailboxes?tenantId=${t.id}`} className="inline-flex">
              <Button variant="ghost" type="button">Download mailboxes CSV</Button>
            </a>
            <Link href="/app/mailstack"><Button variant="ghost">Back</Button></Link>
          </div>
        </Card>

        <Card title="Domains">
          {t.domains.length === 0 ? <p className="opacity-70 text-sm">None.</p> : (
            <div className="grid gap-1">
              {t.domains.map((d) => <div key={d.id} className="text-sm">{d.domainName}</div>)}
            </div>
          )}
        </Card>

        <Card title="Outbound IPs">
          {t.ips.length === 0 ? <p className="opacity-70 text-sm">None.</p> : (
            <div className="grid gap-1">
              {t.ips.map((i) => <div key={i.id} className="text-sm">{i.ip}</div>)}
            </div>
          )}
        </Card>

        <Card title="Mailboxes">
          {t.mailboxes.length === 0 ? (
            <p className="opacity-70 text-sm">No mailboxes imported yet. If you just created the tenant, wait for the worker to finish.</p>
          ) : (
            <div className="grid gap-1">
              {t.mailboxes.map((m) => (
                <div key={m.id} className="text-sm">{m.email} <span className="opacity-60">(password stored encrypted)</span></div>
              ))}
            </div>
          )}
          <div className="mt-3 text-xs opacity-70">
            Tip: after provisioning, mailboxes are also added in <Link className="underline" href="/app/mailboxes">Mailboxes</Link> for sending.
          </div>
        </Card>

        <Card title="Danger zone">
          <p className="text-sm opacity-70">
            Resetting a tenant will delete it from the app, remove imported mailboxes, and remove its server tenant folder.
          </p>
          <div className="mt-3">
            <ResetTenantForm tenantId={t.id} tenantName={t.name} />
          </div>
        </Card>
      </div>
    </Container>
  );
}
