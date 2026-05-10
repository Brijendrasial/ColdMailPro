import { Container, Card, Input, Button, Badge, PageHeader, Pill } from "@/components/ui";
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

function MetricTile({ label, value, hint, tone = "slate" }: { label: string; value: string | number; hint?: string; tone?: "slate" | "indigo" | "emerald" | "amber" | "rose" }) {
  const tones: Record<string, string> = {
    slate: "from-slate-950 to-slate-700",
    indigo: "from-indigo-600 to-sky-500",
    emerald: "from-emerald-500 to-teal-500",
    amber: "from-amber-500 to-orange-500",
    rose: "from-rose-500 to-red-500",
  };
  return (
    <div className="relative overflow-hidden rounded-[1.6rem] border border-white/70 bg-white/85 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.07)]">
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${tones[tone]}`} />
      <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">{label}</div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

function WorkflowStep({ step, title, text }: { step: string; title: string; text: string }) {
  return (
    <div className="rounded-[1.4rem] border border-slate-200/80 bg-white/80 p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-950 text-sm font-semibold text-white shadow-md">{step}</div>
        <div>
          <div className="font-semibold text-slate-950">{title}</div>
          <div className="mt-0.5 text-xs leading-5 text-slate-500">{text}</div>
        </div>
      </div>
    </div>
  );
}

export default async function MailstackPage() {
  const s = await requireSession();

  const user = await prisma.user.findUnique({ where: { id: s.uid } });
  if (!user) {
    redirect("/api/auth/logout?next=/login");
  }

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

  const p: any = prisma as any;
  if (!p.mailstackConfig || !p.mailstackTenant) {
    return (
      <Container wide>
        <Card title="Mailstack integration">
          <p className="text-sm opacity-80">Your Prisma Client is missing the Mailstack models.</p>
          <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-black/5 p-3 text-xs">{`Fix:
  npm run prisma:generate
  npx prisma db push
  npm run seed

Then restart:
  npm run dev
  npm run worker:dev`}</pre>
        </Card>
      </Container>
    );
  }

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

  const activeTenants = tenants.filter((t) => t.status !== "suspended").length;
  const domainCount = tenants.reduce((sum, t) => sum + t.domains.length, 0);
  const mailboxCount = tenants.reduce((sum, t) => sum + t.mailboxes.length, 0);
  const ipCount = tenants.reduce((sum, t) => sum + t.ips.length, 0);
  const needsAttention = tenants.filter((t) => t.status === "suspended" || t.lastJobStatus === "failed").length;

  return (
    <Container wide>
      <div className="space-y-8">
        <PageHeader
          title="Mailstack Control Center"
          subtitle="Provision tenants, sync Cloudflare DNS, rotate outbound IPs, update Roundcube, and keep your mail server fleet healthy from one clean workspace."
          right={
            <>
              <Badge>Workspace: {ws.name}</Badge>
              <Badge>ID: {s.wid.slice(0, 8)}</Badge>
              <Link href="/app/mailstack/new"><Button>Create tenant</Button></Link>
            </>
          }
          className="min-h-[220px]"
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <MetricTile label="Tenants" value={tenants.length} hint={`${activeTenants} active`} tone="indigo" />
          <MetricTile label="Domains" value={domainCount} hint="DNS managed" tone="emerald" />
          <MetricTile label="Mailboxes" value={mailboxCount} hint="Imported senders" tone="slate" />
          <MetricTile label="Outbound IPs" value={ipCount} hint="SPF rotation pool" tone="amber" />
          <MetricTile label="Attention" value={needsAttention} hint="Suspended / failed jobs" tone={needsAttention ? "rose" : "emerald"} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <WorkflowStep step="1" title="Connect server" text="Save the MailStack server IP and encrypted Cloudflare token for this workspace." />
          <WorkflowStep step="2" title="Create tenant" text="Group domains, outbound IPs, and mailbox users into one provisioning job." />
          <WorkflowStep step="3" title="Operate safely" text="Run DNS sync, rotate IPs, issue SSL, update packages, and stream worker progress." />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)]">
          <Card title="Integration vault" subtitle="Workspace-specific server settings used by domain provisioning and Cloudflare sync.">
            <form className="grid gap-5" action="/api/mailstack/config/save" method="post">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium text-slate-700">
                  Server IP
                  <Input name="serverIp" defaultValue={cfg.serverIp || ""} placeholder="51.38.38.222" />
                </label>
                <label className="grid gap-2 text-sm font-medium text-slate-700">
                  Cloudflare API token
                  <Input name="cloudflareToken" type="password" placeholder={cfg.cloudflareTokenEnc ? "•••••••• (set)" : "paste token"} />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit">Save settings</Button>
                {cfg.cloudflareTokenEnc ? <Pill tone="success">Token set</Pill> : <Pill tone="warning">Token not set</Pill>}
                {cfg.serverIp ? <Pill tone="info">Server IP {cfg.serverIp}</Pill> : <Pill tone="warning">Server IP missing</Pill>}
              </div>
            </form>

            <div className="mt-6 rounded-[1.4rem] border border-slate-200/80 bg-slate-50/80 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-semibold text-slate-950">Cloudflare bootstrap</div>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Writes the encrypted token into the server-side workspace environment file so MailStack scripts can create and update DNS records.
                  </p>
                </div>
                <form action="/api/mailstack/config/init" method="post" className="shrink-0">
                  <Button variant="ghost" type="submit">Init Cloudflare</Button>
                </form>
              </div>
            </div>
          </Card>

          <Card title="Server maintenance studio" subtitle="One-click operating system, MailStack service, and Roundcube updates with live progress.">
            <MailstackMaintenanceClient />
          </Card>
        </div>

        <Card
          title="Tenant fleet"
          subtitle="Every tenant links domains, IPs, mailbox users, DNS state, and operational actions."
          right={<Link href="/app/mailstack/new"><Button>Create tenant</Button></Link>}
        >
          {tenants.length === 0 ? (
            <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-white/70 p-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg">✦</div>
              <h3 className="mt-4 text-lg font-semibold text-slate-950">No tenants yet</h3>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
                Create your first tenant to generate domain DNS defaults, mailbox users, outbound IP mappings, and DKIM/SPF/DMARC records.
              </p>
              <div className="mt-5"><Link href="/app/mailstack/new"><Button>Create tenant</Button></Link></div>
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {tenants.map((t) => {
                const attention = t.status === "suspended" || t.lastJobStatus === "failed";
                return (
                  <div key={t.id} className="group relative overflow-hidden rounded-[1.7rem] border border-slate-200/80 bg-white/85 p-5 shadow-[0_18px_55px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_70px_rgba(15,23,42,0.10)]">
                    <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${attention ? "from-amber-400 to-rose-500" : "from-emerald-400 to-cyan-500"}`} />
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link className="text-xl font-semibold tracking-tight text-slate-950 underline-offset-4 hover:underline" href={`/app/mailstack/${t.id}`}>{t.name}</Link>
                          <Pill tone={t.status === "active" ? "success" : t.status === "suspended" ? "warning" : "neutral"}>{t.status}</Pill>
                          {t.lastJobStatus ? <Pill tone={t.lastJobStatus === "done" ? "success" : t.lastJobStatus === "failed" ? "danger" : "info"}>last job {t.lastJobStatus}</Pill> : null}
                        </div>
                        <div className="mt-1 text-sm text-slate-500">Server IP: {t.serverIp || "not set"}</div>
                        <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                          <div className="rounded-2xl bg-slate-50 p-3"><div className="text-lg font-semibold text-slate-950">{t.domains.length}</div><div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Domains</div></div>
                          <div className="rounded-2xl bg-slate-50 p-3"><div className="text-lg font-semibold text-slate-950">{t.ips.length}</div><div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">IPs</div></div>
                          <div className="rounded-2xl bg-slate-50 p-3"><div className="text-lg font-semibold text-slate-950">{t.users.length}</div><div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Users</div></div>
                          <div className="rounded-2xl bg-slate-50 p-3"><div className="text-lg font-semibold text-slate-950">{t.mailboxes.length}</div><div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Boxes</div></div>
                        </div>
                      </div>
                      <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                        <form action="/api/mailstack/tenant/sync" method="post">
                          <input type="hidden" name="tenantId" value={t.id} />
                          <Button variant="ghost" type="submit">DNS sync</Button>
                        </form>
                        <form action="/api/mailstack/tenant/rotate" method="post">
                          <input type="hidden" name="tenantId" value={t.id} />
                          <Button variant="ghost" type="submit">Rotate IP</Button>
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
                        <Link href={`/app/mailstack/${t.id}`}><Button variant="secondary">Open cockpit</Button></Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </Container>
  );
}
