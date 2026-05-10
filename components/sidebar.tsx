"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import WorkspaceSwitcher from "@/components/workspace-switcher";

export default function Sidebar(props: {
  items: { href: string; label: string; icon?: string }[];
  workspaceId: string;
  workspaceName: string;
  userName: string | null;
  userEmail: string;
}) {
  const { items, workspaceId, workspaceName, userName, userEmail } = props;
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-[292px] shrink-0 p-4">
      <div className="sticky top-4 flex h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-[2rem] border border-white/70 bg-white/72 shadow-[0_24px_80px_rgba(15,23,42,0.09)] backdrop-blur-xl">
        <div className="relative overflow-hidden p-4 border-b border-slate-200/70">
          <div className="absolute inset-0 bg-[radial-gradient(420px_circle_at_0%_0%,rgba(99,102,241,0.16),transparent_55%),radial-gradient(360px_circle_at_100%_0%,rgba(16,185,129,0.14),transparent_50%)]" />
          <div className="relative flex items-center gap-3">
            <div className="relative h-12 w-12 rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-emerald-500 text-white flex items-center justify-center font-bold shadow-lg">
              C
              <div className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-emerald-400 border-2 border-white" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-tight truncate text-slate-950 flex items-center gap-2 font-display">
                {workspaceName}
                <span className="opacity-50">▾</span>
              </div>
              <div className="text-xs text-slate-600 truncate mt-0.5">
                {userName ? `${userName} · ` : ""}
                {userEmail}
              </div>
            </div>
          </div>
          <div className="relative mt-4">
            <WorkspaceSwitcher currentWorkspaceId={workspaceId} currentWorkspaceName={workspaceName} />
          </div>
        </div>

        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-[0.22em] font-semibold text-slate-500">Navigation</div>
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.16)]" />
        </div>

        <nav className="px-3 pb-4 space-y-1.5 overflow-y-auto">
          {items.map((it) => {
            const active = pathname === it.href || (it.href !== "/app" && pathname?.startsWith(it.href + "/"));
            return (
              <Link
                key={it.href}
                href={it.href}
                className={
                  "group relative flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm transition border " +
                  (active
                    ? "bg-slate-950 text-white border-slate-900/20 shadow-[0_16px_32px_rgba(15,23,42,0.18)]"
                    : "border-transparent text-slate-700 hover:bg-white/85 hover:border-slate-200/80 hover:shadow-sm")
                }
              >
                {active ? <span className="absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-emerald-400" /> : null}
                <span
                  className={
                    "w-9 h-9 rounded-2xl flex items-center justify-center transition " +
                    (active ? "bg-white/10" : "bg-slate-100/80 group-hover:bg-indigo-50")
                  }
                >
                  <span className="text-base">{it.icon || ""}</span>
                </span>
                <span className="truncate font-semibold">{it.label}</span>
                {active ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-300" /> : null}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto p-4">
          <div className="rounded-[1.4rem] border border-indigo-100 bg-gradient-to-br from-indigo-50 to-emerald-50 p-4 text-xs text-slate-600 shadow-sm">
            <div className="font-semibold text-slate-900 mb-1">Inbox discipline</div>
            Replies is your shared command room. Assign, snooze, and keep hot leads moving.
          </div>
        </div>
      </div>
    </aside>
  );
}
