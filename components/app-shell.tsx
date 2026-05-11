import React from "react";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Sidebar from "@/components/sidebar";
import MobileNav from "@/components/mobile-nav";
import SearchBar from "@/components/search-bar";

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
    { href: "/app/blacklist", label: "Blacklist", icon: "🛡️" },
    { href: "/app/logs", label: "Logs", icon: "🧾" },
    { href: "/app/mailstack", label: "Mailstack", icon: "🛠️" },
    { href: "/app/settings", label: "Settings", icon: "⚙️" },
  ];

  return (
    <div className="min-h-screen bg-[radial-gradient(1100px_circle_at_12%_-10%,rgba(99,102,241,0.14),transparent_58%),radial-gradient(950px_circle_at_92%_0%,rgba(20,184,166,0.12),transparent_54%),linear-gradient(180deg,#f8fbff_0%,#f8fafc_45%,#eef4ff_100%)]">
      <div className="flex min-h-screen">
        <Sidebar
          items={items}
          workspaceId={s.wid}
          workspaceName={ws?.name || "Workspace"}
          userName={me?.name || null}
          userEmail={me?.email || ""}
        />

        <div className="flex-1 min-w-0">
          <div className="relative z-20 px-3 sm:px-5 pt-3">
            <div className="rounded-[1.6rem] border border-white/70 bg-white/72 shadow-[0_18px_60px_rgba(15,23,42,0.07)] backdrop-blur-xl">
              <div className="px-4 sm:px-5 py-3 flex items-center gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <MobileNav items={items.map((i) => ({ href: i.href, label: i.label }))} />
                  <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-indigo-600 to-emerald-500 text-white grid place-items-center font-bold md:hidden">C</div>
                  <div className="min-w-0">
                    <div className="font-display font-semibold tracking-tight text-slate-950 leading-tight">ColdMail Pro</div>
                    <div className="hidden sm:block text-xs text-slate-500 truncate">{ws?.name || "Workspace"}</div>
                  </div>
                </div>

                <div className="hidden md:flex flex-1 justify-center px-4">
                  <div className="w-full max-w-2xl">
                    <SearchBar />
                  </div>
                </div>

                <div className="ml-auto flex items-center gap-2">
                  <div className="hidden xl:flex items-center gap-2">
                    <Link href="/app/campaigns/new" className="px-3.5 py-2 rounded-2xl text-sm font-semibold border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition shadow-sm">
                      + Campaign
                    </Link>
                    <Link href="/app/mailboxes" className="px-3.5 py-2 rounded-2xl text-sm font-semibold border border-slate-200 bg-white/80 hover:bg-white transition shadow-sm">
                      + Mailbox
                    </Link>
                  </div>

                  <div className="hidden lg:block text-xs text-slate-600 truncate max-w-[260px] rounded-2xl border border-slate-200/80 bg-white/70 px-3 py-2">
                    {me?.name ? `${me.name} · ` : ""}
                    {me?.email || ""}
                  </div>

                  <form action="/api/auth/logout" method="post">
                    <button className="text-sm px-3.5 py-2 rounded-2xl border border-slate-200 bg-white/80 hover:bg-white transition shadow-sm font-semibold">
                      Logout
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </div>

          <main className="p-0">{children}</main>
        </div>
      </div>
    </div>
  );
}
