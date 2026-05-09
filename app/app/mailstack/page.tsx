import { Container, Card, Input, Button, Badge } from "@/components/ui";
import MailstackMaintenanceClient from "./MailstackMaintenanceClient";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

type MailstackTenantRow = {
  id: string;
  name: string;
  serverIp: string | null;
  status: string;
  lastJobStatus: string | null;
  domains: unknown[];
  ips: unknown[];
  users: unknown[];
  mailboxes: unknown[];
};


export default async function MailstackPage() {
  const s = await requireSession();

  // If DB was reset but browser still has an old session cookie,
  // the user row may no longer exist. Avoid FK crashes by forcing a re-login.
  const user = await prisma.user.findUnique({ where: { id: s.uid } });
  if (!user) {
    redirect("/api/auth/logout?next=/login");
  }

  // Defensive: some installs end up with a session wid that has no Workspace row
  // (eg after partial DB resets / schema pushes). MailstackConfig has an FK to Workspace,
  // so ensure the Workspace (and Membership) exist before creating config.
  let ws = await prisma.workspace.findUnique({ where: { id: s.wid } });
  if (!ws) {
    const wsName = user?.name ? `${user.name}'s Workspace` : "Default Workspace";
    ws = await prisma.workspace.create({ data: { id: s.wid, name: wsName } });
  }

  const existingMembership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: s.uid, workspaceId: s.wid } },
  });
  if (!existingMembership) {
    await prisma.membership.create({
      data: { userId: s.uid, workspaceId: s.wid, role: "owner" },
    });
  }

  // If the Prisma Client was generated from an older schema (common after zip updates),
  // these Mailstack models won't exist at runtime and would crash the page.
  // Show a helpful message instead.
  const p: any = prisma as any;
  if (!p.mailstackConfig || !p.mailstackTenant) {
    return (
      <Container>
        <Card title="Mailstack integration">
          <p className="text-sm opacity-80">
            Your Prisma Client is missing the Mailstack models.
          </p>
          <pre className="text-xs whitespace-pre-wrap bg-black/5 p-3 rounded-xl mt-3">
{`Fix:
  npm run prisma:generate
  npx prisma db push
  npm run seed

Then restart:
  npm run dev
  npm run worker:dev`}
          </pre>
        </Card>
      </Container>
    );
  }

  // Use upsert to avoid FK race conditions and make the page idempotent
  const cfg = await p.mailstackConfig.upsert({
    where: { workspaceId: s.wid },
    update: {},
    create: { workspaceId: s.wid },
  });

  const tenants: MailstackTenantRow[] = await p.mailstackTenant.findMany({
    where: { workspaceId: s.wid },
    orderBy: { createdAt: "desc" },
    include: { domains: true, ips: true, users: true, mailboxes: true },
  });

  return (
    <Container>
      <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
        <div className="min-w-0">
          <div className="text-2xl font-semibold">🛠️ Mailstack</div>
          <div className="text-sm opacity-70 mt-1 truncate">
            Workspace: <span className="font-medium">{ws.name}</span>{" "}
            <span className="font-mono text-xs opacity-80">({s.wid.slice(0, 8)})</span>
          </div>
        </div>
        <div className="text-xs opacity-60">Tip: switch workspace from the sidebar → “Switch workspace”.</div>
      </div>
      <div className="grid gap-6">
        <Card title="Mailstack integration">
          <p className="opacity-80 text-sm">
            This connects the app to your on-server <code>mailstack.sh</code> + <code>mailstack-addon.sh</code> scripts to provision domains,
            DNS (Cloudflare), DKIM/SPF/DMARC, and mailboxes.
          </p>

          <form className="mt-4 grid gap-3" action="/api/mailstack/config/save" method="post">
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <div className="text-xs opacity-70 mb-1">Server IP</div>
                <Input name="serverIp" defaultValue={cfg.serverIp || ""} placeholder="51.38.38.222" />
              </div>
              <div>
                <div className="text-xs opacity-70 mb-1">Cloudflare API token (stored per-workspace, encrypted)</div>
                <Input name="cloudflareToken" type="password" placeholder={cfg.cloudflareTokenEnc ? "•••••••• (set)" : "paste token"} />
              </div>
            </div>
            <div className="flex gap-3 items-center">
              <Button type="submit">Save settings</Button>
              {cfg.cloudflareTokenEnc ? <Badge>Token: set</Badge> : <Badge>Token: not set</Badge>}
              {cfg.serverIp ? <Badge>Server IP: {cfg.serverIp}</Badge> : <Badge>Server IP: not set</Badge>}
            </div>
          </form>

          <form className="mt-3" action="/api/mailstack/config/init" method="post">
            <Button variant="ghost" type="submit">Init Cloudflare (writes /etc/mailstack/workspaces/&lt;workspace&gt;/cloudflare.env)</Button>
          </form>

          <div className="mt-4 flex gap-3">
            <Link href="/app/mailstack/new"><Button>Create tenant</Button></Link>
          </div>
        </Card>


        <Card title="Server maintenance" subtitle="Beautiful one-click updates with a live popup, progress stages, and worker logs.">
          <div className="grid gap-4 text-sm">
            <p className="text-slate-600">
              Update OS packages and MailStack-installed services. After updates finish, the script automatically restarts Exim, Dovecot, Nginx, PHP-FPM, database/cache services when present, and reapplies safe MailStack permissions/fixes.
            </p>
            <MailstackMaintenanceClient />
          </div>
        </Card>

        <Card title="Tenants">
          {tenants.length === 0 ? (
            <p className="opacity-70 text-sm">No tenants yet.</p>
          ) : (
            <div className="grid gap-3">
              {tenants.map((t) => (
                <div key={t.id} className="rounded-xl border border-black/10 dark:border-white/10 p-3 flex items-start justify-between gap-4">
                  <div className="grid gap-1">
                    <div className="font-semibold">
                      <Link className="underline" href={`/app/mailstack/${t.id}`}>{t.name}</Link>
                      <span className="ml-2 text-xs opacity-70">{t.serverIp}</span>
                    </div>
                    <div className="text-xs opacity-70">
                      Domains: {t.domains.length} • IPs: {t.ips.length} • Users: {t.users.length} • Mailboxes: {t.mailboxes.length}
                    </div>
                    <div className="text-xs opacity-70">
                      Status: <span className="font-medium">{t.status}</span>{t.lastJobStatus ? ` • Last job: ${t.lastJobStatus}` : ""}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-end">
                    <form action="/api/mailstack/tenant/sync" method="post">
                      <input type="hidden" name="tenantId" value={t.id} />
                      <Button variant="ghost" type="submit">DNS sync</Button>
                    </form>
                    <form action="/api/mailstack/tenant/rotate" method="post">
                      <input type="hidden" name="tenantId" value={t.id} />
                      <Button variant="ghost" type="submit">Rotate now</Button>
                    </form>
                    {t.status === "suspended" ? (
                      <form action="/api/mailstack/tenant/unsuspend" method="post">
                        <input type="hidden" name="tenantId" value={t.id} />
                        <Button variant="ghost" type="submit">Unsuspend</Button>
                      </form>
                    ) : (
                      <form action="/api/mailstack/tenant/suspend" method="post">
                        <input type="hidden" name="tenantId" value={t.id} />
                        <Button variant="ghost" type="submit">Suspend</Button>
                      </form>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </Container>
  );
}
