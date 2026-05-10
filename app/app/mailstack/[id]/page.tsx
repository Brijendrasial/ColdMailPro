import type React from "react";
import { Container, Card, Button, Badge, PageHeader, Pill } from "@/components/ui";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { ResetTenantForm } from "@/components/mailstack/reset-tenant-form";

function MiniMetric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-[1.5rem] border border-white/70 bg-white/85 p-4 shadow-[0_16px_45px_rgba(15,23,42,0.06)]">
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

function ListPanel({ title, empty, children }: { title: string; empty: string; children?: React.ReactNode }) {
  return (
    <Card title={title}>
      {children ? children : <p className="text-sm text-slate-500">{empty}</p>}
    </Card>
  );
}

export default async function TenantPage({ params }: { params: { id: string } }) {
  const s = await requireSession();
  const ws = await prisma.workspace.findUnique({ where: { id: s.wid }, select: { name: true } });
  const t = await prisma.mailstackTenant.findFirst({
    where: { id: params.id, workspaceId: s.wid },
    include: { domains: true, ips: true, users: true, mailboxes: true },
  });
  if (!t) return notFound();

  const domainNames = t.domains.map((d: any) => d.domainName).filter(Boolean);
  const ips = t.ips.map((i: any) => i.ip).filter(Boolean);
  const users = t.users.map((u: any) => u.email || u.username || u.name).filter(Boolean);
  const mailboxes = t.mailboxes.map((m: any) => m.email).filter(Boolean);

  return (
    <Container wide>
      <div className="space-y-8">
        <PageHeader
          title={`Tenant: ${t.name}`}
          subtitle="Operate this MailStack tenant: sync DNS, rotate outbound IPs, issue SSL, rebuild Exim maps, export mailboxes, and review linked assets."
          right={
            <>
              <Badge>{ws?.name || "Workspace"}</Badge>
              <Pill tone={t.status === "active" ? "success" : t.status === "suspended" ? "warning" : "neutral"}>Status: {t.status}</Pill>
              {t.lastJobStatus ? <Pill tone={t.lastJobStatus === "done" ? "success" : t.lastJobStatus === "failed" ? "danger" : "info"}>Last job: {t.lastJobStatus}</Pill> : null}
              <Link href="/app/mailstack"><Button variant="ghost">Back to Mailstack</Button></Link>
            </>
          }
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <MiniMetric label="Server IP" value={t.serverIp || "—"} hint="primary tenant server" />
          <MiniMetric label="Domains" value={t.domains.length} hint="DNS managed" />
          <MiniMetric label="Outbound IPs" value={t.ips.length} hint="rotation pool" />
          <MiniMetric label="Users" value={t.users.length} hint="server accounts" />
          <MiniMetric label="Mailboxes" value={t.mailboxes.length} hint="imported senders" />
        </div>

        <Card title="Operations console" subtitle="Run safe tenant actions without digging into shell commands.">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[1.3rem] border border-slate-200/80 bg-slate-50/80 p-4"><div className="font-semibold text-slate-950">DNS sync</div><p className="mt-1 text-sm text-slate-600">Push SPF, DKIM, DMARC, MX, and A records through Cloudflare.</p></div>
              <div className="rounded-[1.3rem] border border-slate-200/80 bg-slate-50/80 p-4"><div className="font-semibold text-slate-950">Rotate IP</div><p className="mt-1 text-sm text-slate-600">Move the tenant to the next outbound IP pool mapping.</p></div>
              <div className="rounded-[1.3rem] border border-slate-200/80 bg-slate-50/80 p-4"><div className="font-semibold text-slate-950">Exim rebuild</div><p className="mt-1 text-sm text-slate-600">Regenerate maps and apply mail routing changes.</p></div>
              <div className="rounded-[1.3rem] border border-slate-200/80 bg-slate-50/80 p-4"><div className="font-semibold text-slate-950">Issue SSL</div><p className="mt-1 text-sm text-slate-600">Request certificates for tenant mail hostnames.</p></div>
            </div>
            <div className="flex flex-wrap gap-2 lg:max-w-[320px] lg:justify-end">
              <form action="/api/mailstack/tenant/sync" method="post"><input type="hidden" name="tenantId" value={t.id} /><Button type="submit">DNS sync</Button></form>
              <form action="/api/mailstack/tenant/rotate" method="post"><input type="hidden" name="tenantId" value={t.id} /><Button variant="ghost" type="submit">Rotate now</Button></form>
              <form action="/api/mailstack/tenant/rebuild" method="post"><input type="hidden" name="tenantId" value={t.id} /><Button variant="ghost" type="submit">Exim rebuild</Button></form>
              <form action="/api/mailstack/tenant/ssl" method="post"><input type="hidden" name="tenantId" value={t.id} /><Button variant="ghost" type="submit">Issue SSL</Button></form>
              <a href={`/api/mailstack/tenant/mailboxes?tenantId=${t.id}`} className="inline-flex"><Button variant="secondary" type="button">Download CSV</Button></a>
            </div>
          </div>
        </Card>

        <div className="grid gap-6 xl:grid-cols-2">
          <ListPanel title="Domains" empty="No domains linked yet.">
            {domainNames.length ? (
              <div className="grid gap-2">
                {domainNames.map((domain) => <div key={domain} className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 font-medium text-slate-800">{domain}</div>)}
              </div>
            ) : null}
          </ListPanel>

          <ListPanel title="Outbound IP pool" empty="No outbound IPs linked yet.">
            {ips.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {ips.map((ip) => <div key={ip} className="rounded-2xl border border-slate-200/80 bg-slate-950 px-4 py-3 font-mono text-sm text-white shadow-sm">{ip}</div>)}
              </div>
            ) : null}
          </ListPanel>

          <ListPanel title="Mailbox users" empty="No server users imported yet.">
            {users.length ? (
              <div className="grid gap-2">
                {users.map((u) => <div key={u} className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-sm text-slate-700">{u}</div>)}
              </div>
            ) : null}
          </ListPanel>

          <ListPanel title="Imported sender mailboxes" empty="No mailboxes imported yet. If you just created the tenant, wait for the worker to finish.">
            {mailboxes.length ? (
              <div className="grid gap-2">
                {mailboxes.map((email) => <div key={email} className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm"><span className="font-medium text-emerald-950">{email}</span><Pill tone="success">encrypted password</Pill></div>)}
              </div>
            ) : null}
            <div className="mt-3 text-xs text-slate-500">Tip: after provisioning, mailboxes are also added in <Link className="underline" href="/app/mailboxes">Mailboxes</Link> for sending.</div>
          </ListPanel>
        </div>

        <Card title="Danger zone" subtitle="Only reset a tenant when you are sure. This removes app records and the server tenant folder.">
          <div className="rounded-[1.4rem] border border-red-200 bg-red-50/80 p-4 text-sm leading-6 text-red-800">
            Resetting this tenant deletes it from ColdMailPro, removes imported mailboxes, and asks the MailStack server script to remove tenant files. It does not automatically delete external DNS records.
          </div>
          <div className="mt-4"><ResetTenantForm tenantId={t.id} tenantName={t.name} /></div>
        </Card>
      </div>
    </Container>
  );
}
