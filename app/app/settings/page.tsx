import Link from "next/link";
import { Card, Container, Input, PageHeader, Button, Pill } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ApiKeysCard from "./ApiKeysCard";
import TwoFactorCard from "./TwoFactorCard";
import SessionsCard from "./SessionsCard";
import NotificationsCard from "./NotificationsCard";
import DeliverabilityCard from "./DeliverabilityCard";
import WebhooksCard from "./WebhooksCard";
import TeamCard from "./TeamCard";
import AuditLogCard from "./AuditLogCard";
import WorkspacesCard from "./WorkspacesCard";
import { countRecoveryCodes } from "@/lib/twofa";

function TabLink({ href, active, label, icon }: { href: string; active: boolean; label: string; icon: string }) {
  return (
    <Link
      href={href}
      className={
        "group flex items-center gap-2 px-3 py-2.5 rounded-2xl text-sm transition border " +
        (active
          ? "bg-slate-900 text-white border-slate-900/20 shadow-soft"
          : "border-slate-200 bg-white/60 text-slate-700 hover:bg-white")
      }
    >
      <span className={"w-8 h-8 rounded-xl flex items-center justify-center " + (active ? "bg-white/10" : "bg-slate-100/70")}>
        <span className="text-base">{icon}</span>
      </span>
      <span className="font-medium">{label}</span>
    </Link>
  );
}

export default async function Settings({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const s = await requireSession();
  const tab = String(searchParams?.tab || "account");

  const [me, ws, keys] = await Promise.all([
    prisma.user.findUnique({
      where: { id: s.uid },
      select: {
        id: true,
        email: true,
        name: true,
        settingsJson: true,
        twoFactorEnabled: true,
        twoFactorEnabledAt: true,
        twoFactorRecoveryCodesHash: true,
      },
    }),
    prisma.workspace.findUnique({
      where: { id: s.wid },
      select: { id: true, name: true, createdAt: true, settingsJson: true },
    }),
    prisma.apiKey.findMany({
      where: { userId: s.uid },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, createdAt: true },
    }),
  ]);

  const err = String(searchParams?.err || "");
  const ok = String(searchParams?.ok || "");
  const recoveryCount = countRecoveryCodes(me?.twoFactorRecoveryCodesHash || null);

  const base = "/app/settings";

  const tabs = [
    { key: "account", label: "Account", icon: "👤" },
    { key: "security", label: "Security", icon: "🔐" },
    { key: "sessions", label: "Sessions", icon: "🖥️" },
    { key: "notifications", label: "Notifications", icon: "🔔" },
    { key: "deliverability", label: "Deliverability", icon: "📬" },
    { key: "workspaces", label: "Workspaces", icon: "🏢" },
    { key: "team", label: "Team", icon: "👥" },
    { key: "audit", label: "Audit log", icon: "🧾" },
    { key: "integrations", label: "Integrations", icon: "🔗" },
    { key: "developer", label: "Developer", icon: "🧩" },
    { key: "danger", label: "Danger Zone", icon: "🧨" },
  ];

  return (
    <Container>
      {err ? (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm">
          ❌ {err}
        </div>
      ) : null}
      {ok ? (
        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm">
          ✅ {ok}
        </div>
      ) : null}

      <PageHeader
        title="Settings"
        subtitle="A premium control panel for account, security, devices, deliverability defaults and integrations."
      />

      <div className="grid lg:grid-cols-[260px_1fr] gap-4 mt-6">
        <div className="lg:sticky lg:top-20 h-fit">
          <div className="grid gap-2">
            {tabs.map((t) => (
              <TabLink
                key={t.key}
                href={`${base}?tab=${t.key}`}
                active={tab === t.key}
                label={t.label}
                icon={t.icon}
              />
            ))}
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-white/60 p-4">
            <div className="text-xs text-slate-600">Workspace</div>
            <div className="mt-1 font-medium text-slate-900 truncate">{ws?.name || "Workspace"}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Pill tone="info">ID: {ws?.id?.slice(0, 8) || "—"}</Pill>
              {me?.twoFactorEnabled ? <Pill tone="success">2FA enabled</Pill> : <Pill tone="warning">2FA off</Pill>}
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          {tab === "account" ? (
            <div className="grid gap-4">
              <div className="grid lg:grid-cols-2 gap-4">
                <Card title="Account" subtitle="Profile and identity." right={<Pill tone="info">Account</Pill>}>
                  <form action="/api/settings/profile/update" method="post" className="grid gap-3">
                    <div>
                      <div className="text-sm mb-1 opacity-80">Email</div>
                      <Input value={me?.email || ""} readOnly />
                    </div>
                    <div>
                      <div className="text-sm mb-1 opacity-80">Display name</div>
                      <Input name="name" defaultValue={me?.name || ""} placeholder="Your name" />
                      <div className="mt-1 text-xs text-slate-600">Shown in the app UI and team lists.</div>
                    </div>
                    <div className="flex items-center justify-end">
                      <Button type="submit" variant="primary">
                        Save
                      </Button>
                    </div>
                  </form>
                </Card>

                <Card title="Workspace" subtitle="Workspace identity and defaults." right={<Pill tone="success">Workspace</Pill>}>
                  <form action="/api/settings/workspace/update" method="post" className="grid gap-3">
                    <div>
                      <div className="text-sm mb-1 opacity-80">Workspace name</div>
                      <Input name="name" defaultValue={ws?.name || ""} placeholder="Workspace name" />
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <div className="text-sm mb-1 opacity-80">Workspace ID</div>
                        <Input value={ws?.id || ""} readOnly />
                      </div>
                      <div>
                        <div className="text-sm mb-1 opacity-80">Created</div>
                        <Input value={ws?.createdAt ? new Date(ws.createdAt).toLocaleString() : ""} readOnly />
                      </div>
                    </div>
                    <div className="flex items-center justify-end">
                      <Button type="submit" variant="primary">
                        Update
                      </Button>
                    </div>
                  </form>
                </Card>
              </div>
            </div>
          ) : null}

          {tab === "security" ? (
            <div className="grid gap-4">
              <Card title="Password" subtitle="Update your password securely." right={<Pill tone="warning">Security</Pill>}>
                <form action="/api/settings/password/change" method="post" className="grid gap-3">
                  <div>
                    <div className="text-sm mb-1 opacity-80">Current password</div>
                    <Input type="password" name="currentPassword" required />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <div className="text-sm mb-1 opacity-80">New password</div>
                      <Input type="password" name="newPassword" required placeholder="Min 8 chars" />
                    </div>
                    <div>
                      <div className="text-sm mb-1 opacity-80">Confirm new password</div>
                      <Input type="password" name="confirmPassword" required placeholder="Repeat" />
                    </div>
                  </div>
                  <div className="flex items-center justify-end">
                    <Button type="submit" variant="primary">
                      Change password
                    </Button>
                  </div>
                </form>
              </Card>

              <TwoFactorCard
                enabled={!!me?.twoFactorEnabled}
                enabledAt={me?.twoFactorEnabledAt ? me.twoFactorEnabledAt.toISOString() : null}
                recoveryCount={recoveryCount}
              />
            </div>
          ) : null}

          {tab === "sessions" ? <SessionsCard /> : null}

          {tab === "notifications" ? <NotificationsCard initial={me?.settingsJson as any} /> : null}

          {tab === "deliverability" ? <DeliverabilityCard initial={ws?.settingsJson as any} /> : null}

          {tab === "workspaces" ? <WorkspacesCard currentWorkspaceId={s.wid} /> : null}

          {tab === "team" ? <TeamCard currentUserId={s.uid} /> : null}

          {tab === "audit" ? <AuditLogCard /> : null}

          {tab === "integrations" ? <WebhooksCard /> : null}

          {tab === "developer" ? <ApiKeysCard initialKeys={keys as any} /> : null}

          {tab === "danger" ? (
            <Card title="Danger zone" subtitle="High impact actions." right={<Pill tone="danger">Danger</Pill>}>
              <div className="grid gap-3">
                <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
                  <div className="text-sm font-medium text-slate-900">Sign out everywhere</div>
                  <div className="text-xs text-slate-600 mt-1">Invalidate all sessions across devices and browsers.</div>
                  <form action="/api/settings/sessions/revoke-all" method="post">
                    <Button type="submit" variant="danger" className="mt-3">
                      Sign out everywhere
                    </Button>
                  </form>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 opacity-60">
                  <div className="text-sm font-medium text-slate-900">Delete account</div>
                  <div className="text-xs text-slate-600 mt-1">
                    Recommended to keep behind extra confirmations + admin policy.
                  </div>
                  <Button type="button" variant="danger" disabled className="mt-3">
                    Coming soon
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </Container>
  );
}
