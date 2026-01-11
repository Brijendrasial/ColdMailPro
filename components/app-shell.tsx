import React from "react";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Sidebar from "@/components/sidebar";
import MobileNav from "@/components/mobile-nav";

export default async function AppShell({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) return <>{children}</>;

  const [ws, me] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: s.wid }, select: { id: true, name: true } }),
    prisma.user.findUnique({ where: { id: s.uid }, select: { id: true, name: true, email: true } }),
  ]);

  const items = [
    { href: "/app", label: "Dashboard", icon: "🏠" },
    { href: "/app/campaigns", label: "Campaigns", icon: "📣" },
    { href: "/app/leads", label: "Leads", icon: "👥" },
    { href: "/app/mailboxes", label: "Mailboxes", icon: "📮" },
    { href: "/app/domains", label: "Domains", icon: "🌐" },
    { href: "/app/replies", label: "Replies", icon: "💬" },
    { href: "/app/analytics", label: "Analytics", icon: "📈" },
    { href: "/app/logs", label: "Logs", icon: "🧾" },
    { href: "/app/mailstack", label: "Mailstack", icon: "🛠️" },
    { href: "/app/settings", label: "Settings", icon: "⚙️" },
  ];

  return (
    <div className="min-h-screen bg-slate-50 bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(99,102,241,0.10),transparent_55%),radial-gradient(900px_circle_at_80%_-10%,rgba(16,185,129,0.08),transparent_55%)]">
      <div className="flex min-h-screen">
        <Sidebar
          items={items}
          workspaceId={s.wid}
          workspaceName={ws?.name || "Workspace"}
          userName={me?.name || null}
          userEmail={me?.email || ""}
        />

        <div className="flex-1 min-w-0">
          <div className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/55 backdrop-blur">
            <div className="px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <MobileNav items={items.map((i) => ({ href: i.href, label: i.label }))} />
                <div className="font-display font-semibold tracking-tight text-slate-900">ColdMail Pro</div>
                <div className="hidden sm:block text-xs text-slate-600 truncate">{ws?.name || ""}</div>
              </div>

              <div className="hidden md:flex flex-1 justify-center px-4">
                <div className="w-full max-w-xl">
                  <div className="relative">
                    <input
                      className="w-full px-4 py-2 rounded-2xl border border-slate-200 bg-white/70 outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 placeholder:text-slate-400"
                      placeholder="Search campaigns, leads, domains… (coming soon)"
                      disabled
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 border border-slate-200 bg-white/70 rounded-lg px-2 py-1">
                      /
                    </div>
                  </div>
                </div>
              </div>

              <div className="ml-auto flex items-center gap-2">
                <div className="hidden lg:flex items-center gap-2">
                  <Link href="/app/campaigns/new" className="px-3 py-2 rounded-2xl text-sm font-medium border border-slate-200 bg-white/70 hover:bg-white transition">
                    + New campaign
                  </Link>
                  <Link href="/app/mailboxes" className="px-3 py-2 rounded-2xl text-sm font-medium border border-slate-200 bg-white/70 hover:bg-white transition">
                    + Add mailbox
                  </Link>
                </div>

                <div className="hidden md:block text-xs text-slate-600 truncate max-w-[260px]">
                  {me?.name ? `${me.name} · ` : ""}
                  {me?.email || ""}
                </div>

                <form action="/api/auth/logout" method="post">
                  <button className="text-sm px-3 py-2 rounded-2xl border border-slate-200 bg-white/70 hover:bg-white transition">
                    Logout
                  </button>
                </form>
              </div>
            </div>
          </div>

          <main className="p-0">{children}</main>
        </div>
      </div>
    </div>
  );
}
