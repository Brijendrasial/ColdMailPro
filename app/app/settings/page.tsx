import Link from "next/link";
import { Card, Container, Input, Button, Pill } from "@/components/ui";
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
import AutoFixCard from "./AutoFixCard";
import IncidentsCard from "./IncidentsCard";
import WorkspacesCard from "./WorkspacesCard";
import { countRecoveryCodes } from "@/lib/twofa";

type SettingsTab = {
  key: string;
  label: string;
  icon: string;
  hint: string;
  group: "Identity" | "Access" | "Workspace" | "System";
  tone: "neutral" | "info" | "success" | "warning" | "danger";
};

const tabs: SettingsTab[] = [
  { key: "account", label: "Account", icon: "👤", hint: "Profile and workspace identity", group: "Identity", tone: "info" },
  { key: "security", label: "Security", icon: "🔐", hint: "Password and two-factor auth", group: "Access", tone: "warning" },
  { key: "sessions", label: "Sessions", icon: "🖥️", hint: "Browsers and active devices", group: "Access", tone: "neutral" },
  { key: "notifications", label: "Notifications", icon: "🔔", hint: "Alerts and workspace signals", group: "Workspace", tone: "info" },
  { key: "deliverability", label: "Deliverability", icon: "📬", hint: "Sending guardrails and defaults", group: "Workspace", tone: "success" },
  { key: "workspaces", label: "Workspaces", icon: "🏢", hint: "Switch or create workspaces", group: "Workspace", tone: "success" },
  { key: "team", label: "Team", icon: "👥", hint: "Members, invites and roles", group: "Workspace", tone: "info" },
  { key: "audit", label: "Audit log", icon: "🧾", hint: "Admin activity trail", group: "System", tone: "neutral" },
  { key: "system", label: "System", icon: "🛠️", hint: "Incidents and auto-fix", group: "System", tone: "warning" },
  { key: "integrations", label: "Integrations", icon: "🔗", hint: "Webhooks and connected tools", group: "System", tone: "info" },
  { key: "developer", label: "Developer", icon: "🧩", hint: "API keys and automation", group: "System", tone: "neutral" },
  { key: "danger", label: "Danger Zone", icon: "🧨", hint: "High impact controls", group: "System", tone: "danger" },
];

function toneClasses(tone: SettingsTab["tone"], active = false) {
  if (active) return "border-slate-900 bg-slate-950 text-white shadow-[0_18px_45px_rgba(15,23,42,0.20)]";
  const tones: Record<SettingsTab["tone"], string> = {
    neutral: "border-slate-200/80 bg-white/74 text-slate-700 hover:border-slate-300 hover:bg-white",
    info: "border-indigo-100 bg-indigo-50/50 text-slate-700 hover:border-indigo-200 hover:bg-white",
    success: "border-emerald-100 bg-emerald-50/50 text-slate-700 hover:border-emerald-200 hover:bg-white",
    warning: "border-amber-100 bg-amber-50/60 text-slate-700 hover:border-amber-200 hover:bg-white",
    danger: "border-rose-100 bg-rose-50/50 text-slate-700 hover:border-rose-200 hover:bg-white",
  };
  return tones[tone];
}

function StatusMetric({ label, value, hint, tone = "neutral" }: { label: string; value: string; hint: string; tone?: SettingsTab["tone"] }) {
  const bar: Record<SettingsTab["tone"], string> = {
    neutral: "from-slate-900 to-slate-600",
    info: "from-indigo-500 to-sky-400",
    success: "from-emerald-500 to-teal-400",
    warning: "from-amber-400 to-orange-500",
    danger: "from-rose-500 to-red-500",
  };
  return (
    <div className="relative overflow-hidden rounded-[1.4rem] border border-white/70 bg-white/76 p-4 shadow-[0_16px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${bar[tone]}`} />
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</div>
      <div className="mt-1 text-xs leading-5 text-slate-500">{hint}</div>
    </div>
  );
}

function TabLink({ href, active, tab }: { href: string; active: boolean; tab: SettingsTab }) {
  return (
    <Link
      href={href}
      className={`group relative flex items-center gap-3 rounded-[1.35rem] border px-3.5 py-3 transition ${toneClasses(tab.tone, active)}`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${active ? "bg-white/10" : "bg-white/70 shadow-sm"}`}>
        <span className="text-lg">{tab.icon}</span>
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-5">{tab.label}</span>
        <span className={`block truncate text-xs leading-5 ${active ? "text-slate-300" : "text-slate-500"}`}>{tab.hint}</span>
      </span>
      {active ? <span className="ml-auto h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_0_5px_rgba(52,211,153,0.15)]" /> : null}
    </Link>
  );
}

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{children}</span>
      {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

function SettingsHero({ activeTab, workspaceName, twoFactorEnabled, keyCount }: { activeTab: SettingsTab; workspaceName: string; twoFactorEnabled: boolean; keyCount: number }) {
  return (
    <div className="relative overflow-hidden rounded-[2.25rem] border border-white/70 bg-slate-950 text-white shadow-[0_30px_90px_rgba(15,23,42,0.18)]">
      <div className="absolute inset-0 bg-[radial-gradient(900px_circle_at_0%_0%,rgba(99,102,241,0.34),transparent_44%),radial-gradient(760px_circle_at_100%_0%,rgba(20,184,166,0.30),transparent_42%),linear-gradient(135deg,#080b1c,#0b1020_48%,#082f35)]" />
      <div className="absolute -right-24 -top-20 h-72 w-72 rounded-full bg-cyan-300/20 blur-3xl" />
      <div className="absolute -left-24 bottom-0 h-72 w-72 rounded-full bg-violet-500/20 blur-3xl" />
      <div className="relative grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_460px] lg:p-10">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.26em] text-white/70 shadow-sm backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_0_4px_rgba(52,211,153,0.18)]" />
            Control workspace
          </div>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Settings</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
            Manage identity, security, team access, deliverability defaults, integrations and system controls from one polished command center.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Pill tone="info">Active: {activeTab.label}</Pill>
            <Pill tone={twoFactorEnabled ? "success" : "warning"}>{twoFactorEnabled ? "2FA enabled" : "2FA not enabled"}</Pill>
            <Pill tone="neutral">Workspace: {workspaceName}</Pill>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          <div className="rounded-[1.4rem] border border-white/15 bg-white/10 p-4 backdrop-blur-xl">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Security</div>
            <div className="mt-2 text-2xl font-semibold">{twoFactorEnabled ? "Strong" : "Basic"}</div>
            <div className="mt-1 text-xs text-slate-300">Account protection</div>
          </div>
          <div className="rounded-[1.4rem] border border-white/15 bg-white/10 p-4 backdrop-blur-xl">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Developer</div>
            <div className="mt-2 text-2xl font-semibold">{keyCount}</div>
            <div className="mt-1 text-xs text-slate-300">API keys</div>
          </div>
          <div className="rounded-[1.4rem] border border-white/15 bg-white/10 p-4 backdrop-blur-xl">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Workspace</div>
            <div className="mt-2 truncate text-2xl font-semibold">Live</div>
            <div className="mt-1 text-xs text-slate-300">Settings synced</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsShell({ children, activeTab, sidebar, summary }: { children: React.ReactNode; activeTab: SettingsTab; sidebar: React.ReactNode; summary: React.ReactNode }) {
  return (
    <div className="mt-6 grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="xl:sticky xl:top-20 h-fit space-y-4">
        {sidebar}
        {summary}
      </aside>
      <main className="min-w-0">
        <div className="mb-4 rounded-[1.7rem] border border-white/70 bg-white/74 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Current panel</div>
              <div className="mt-1 flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-lg text-white shadow-soft">{activeTab.icon}</span>
                <div>
                  <div className="text-xl font-semibold tracking-tight text-slate-950">{activeTab.label}</div>
                  <div className="text-sm text-slate-500">{activeTab.hint}</div>
                </div>
              </div>
            </div>
            <Pill tone={activeTab.tone}>{activeTab.group}</Pill>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}

export default async function Settings({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const s = await requireSession();
  const tab = String(searchParams?.tab || "account");
  const activeTab = tabs.find((t) => t.key === tab) || tabs[0];

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
  const workspaceName = ws?.name || "Workspace";
  const groupedTabs = tabs.reduce<Record<string, SettingsTab[]>>((acc, item) => {
    acc[item.group] = acc[item.group] || [];
    acc[item.group].push(item);
    return acc;
  }, {});
  const base = "/app/settings";

  const sidebar = (
    <div className="rounded-[1.8rem] border border-white/70 bg-white/72 p-3 shadow-[0_22px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="px-2 pb-3 pt-2">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Settings map</div>
        <div className="mt-1 text-sm text-slate-600">Jump between account, workspace, and system controls.</div>
      </div>
      <div className="space-y-4">
        {Object.entries(groupedTabs).map(([group, items]) => (
          <div key={group}>
            <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{group}</div>
            <div className="grid gap-2">
              {items.map((t) => (
                <TabLink key={t.key} href={`${base}?tab=${t.key}`} active={activeTab.key === t.key} tab={t} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const summary = (
    <div className="rounded-[1.8rem] border border-white/70 bg-slate-950 p-4 text-white shadow-[0_22px_70px_rgba(15,23,42,0.16)]">
      <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Workspace brief</div>
      <div className="mt-2 text-lg font-semibold">{workspaceName}</div>
      <div className="mt-1 text-xs text-slate-400">ID {ws?.id?.slice(0, 8) || "-"}</div>
      <div className="mt-4 grid gap-2">
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
          <span className="text-slate-300">Two-factor</span>
          <span className={me?.twoFactorEnabled ? "text-emerald-300" : "text-amber-300"}>{me?.twoFactorEnabled ? "On" : "Off"}</span>
        </div>
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
          <span className="text-slate-300">Recovery codes</span>
          <span>{recoveryCount}</span>
        </div>
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
          <span className="text-slate-300">API keys</span>
          <span>{keys.length}</span>
        </div>
      </div>
    </div>
  );

  return (
    <Container wide>
      {err ? (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm font-medium text-red-700 shadow-soft">
          ❌ {err}
        </div>
      ) : null}
      {ok ? (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm font-medium text-emerald-700 shadow-soft">
          ✅ {ok}
        </div>
      ) : null}

      <SettingsHero activeTab={activeTab} workspaceName={workspaceName} twoFactorEnabled={!!me?.twoFactorEnabled} keyCount={keys.length} />

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatusMetric label="Account" value={me?.name || "Admin"} hint={me?.email || "Signed-in user"} tone="info" />
        <StatusMetric label="Security posture" value={me?.twoFactorEnabled ? "Protected" : "Needs 2FA"} hint={me?.twoFactorEnabled ? "Two-factor authentication is enabled." : "Enable 2FA to secure admin access."} tone={me?.twoFactorEnabled ? "success" : "warning"} />
        <StatusMetric label="Developer access" value={`${keys.length}`} hint="Active API keys on this account." tone="neutral" />
        <StatusMetric label="Workspace age" value={ws?.createdAt ? new Date(ws.createdAt).toLocaleDateString() : "-"} hint="Created date for this workspace." tone="success" />
      </div>

      <SettingsShell activeTab={activeTab} sidebar={sidebar} summary={summary}>
        <div className="grid gap-5">
          {activeTab.key === "account" ? (
            <div className="grid gap-5 2xl:grid-cols-2">
              <Card title="Profile identity" subtitle="Control how you appear inside ColdMailPro." right={<Pill tone="info">Account</Pill>} className="min-h-[430px]">
                <form action="/api/settings/profile/update" method="post" className="grid gap-5">
                  <div className="rounded-[1.4rem] border border-slate-200/80 bg-white/70 p-4">
                    <FieldLabel>Email address</FieldLabel>
                    <Input value={me?.email || ""} readOnly className="mt-2" />
                    <p className="mt-2 text-xs text-slate-500">Email is locked because it is tied to login and audit records.</p>
                  </div>
                  <div className="rounded-[1.4rem] border border-slate-200/80 bg-white/70 p-4">
                    <FieldLabel hint="Shown in the UI, team lists, logs and shared inbox actions.">Display name</FieldLabel>
                    <Input name="name" defaultValue={me?.name || ""} placeholder="Your name" className="mt-2" />
                  </div>
                  <div className="flex items-center justify-end">
                    <Button type="submit" variant="primary" className="min-w-32">Save profile</Button>
                  </div>
                </form>
              </Card>

              <Card title="Workspace identity" subtitle="Rename the workspace and review immutable workspace details." right={<Pill tone="success">Workspace</Pill>} className="min-h-[430px]">
                <form action="/api/settings/workspace/update" method="post" className="grid gap-5">
                  <div className="rounded-[1.4rem] border border-slate-200/80 bg-white/70 p-4">
                    <FieldLabel>Workspace name</FieldLabel>
                    <Input name="name" defaultValue={ws?.name || ""} placeholder="Workspace name" className="mt-2" />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-[1.4rem] border border-slate-200/80 bg-white/70 p-4">
                      <FieldLabel>Workspace ID</FieldLabel>
                      <Input value={ws?.id || ""} readOnly className="mt-2 font-mono text-xs" />
                    </div>
                    <div className="rounded-[1.4rem] border border-slate-200/80 bg-white/70 p-4">
                      <FieldLabel>Created</FieldLabel>
                      <Input value={ws?.createdAt ? new Date(ws.createdAt).toLocaleString() : ""} readOnly className="mt-2" />
                    </div>
                  </div>
                  <div className="flex items-center justify-end">
                    <Button type="submit" variant="primary" className="min-w-32">Update workspace</Button>
                  </div>
                </form>
              </Card>
            </div>
          ) : null}

          {activeTab.key === "security" ? (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px]">
              <Card title="Password vault" subtitle="Change the password used for this admin account." right={<Pill tone="warning">Security</Pill>}>
                <form action="/api/settings/password/change" method="post" className="grid gap-4">
                  <div>
                    <FieldLabel>Current password</FieldLabel>
                    <Input type="password" name="currentPassword" required className="mt-2" />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <FieldLabel>New password</FieldLabel>
                      <Input type="password" name="newPassword" required placeholder="Min 8 chars" className="mt-2" />
                    </div>
                    <div>
                      <FieldLabel>Confirm password</FieldLabel>
                      <Input type="password" name="confirmPassword" required placeholder="Repeat" className="mt-2" />
                    </div>
                  </div>
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3 text-xs leading-5 text-amber-800">
                    Use a unique password. Session and audit panels below help you review account activity after changes.
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" variant="primary">Change password</Button>
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

          {activeTab.key === "sessions" ? <SessionsCard /> : null}

          {activeTab.key === "notifications" ? <NotificationsCard initial={me?.settingsJson as any} /> : null}

          {activeTab.key === "deliverability" ? <DeliverabilityCard initial={ws?.settingsJson as any} /> : null}

          {activeTab.key === "workspaces" ? <WorkspacesCard currentWorkspaceId={s.wid} /> : null}

          {activeTab.key === "team" ? <TeamCard currentUserId={s.uid} /> : null}

          {activeTab.key === "audit" ? <AuditLogCard /> : null}

          {activeTab.key === "integrations" ? <WebhooksCard /> : null}

          {activeTab.key === "developer" ? <ApiKeysCard initialKeys={keys as any} /> : null}

          {activeTab.key === "system" ? (
            <div className="grid gap-5 xl:grid-cols-2">
              <IncidentsCard />
              <AutoFixCard />
            </div>
          ) : null}

          {activeTab.key === "danger" ? (
            <Card title="Danger zone" subtitle="High impact actions with permanent consequences." right={<Pill tone="danger">Danger</Pill>}>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-[1.5rem] border border-red-200 bg-red-50/70 p-5">
                  <div className="text-sm font-semibold text-red-950">Sign out everywhere</div>
                  <div className="mt-1 text-sm leading-6 text-red-700">Invalidate all sessions across devices and browsers. Use this after a suspected account compromise.</div>
                  <form action="/api/settings/sessions/revoke-all" method="post">
                    <Button type="submit" variant="danger" className="mt-4">Sign out everywhere</Button>
                  </form>
                </div>

                <div className="rounded-[1.5rem] border border-slate-200 bg-white/70 p-5 opacity-75">
                  <div className="text-sm font-semibold text-slate-950">Delete account</div>
                  <div className="mt-1 text-sm leading-6 text-slate-600">Reserved for a future admin policy flow with extra confirmation and export safeguards.</div>
                  <Button type="button" variant="danger" disabled className="mt-4">Coming soon</Button>
                </div>
              </div>
            </Card>
          ) : null}
        </div>
      </SettingsShell>
    </Container>
  );
}
