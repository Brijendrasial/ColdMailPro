"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";

export default function Sidebar(props: {
  items: { href: string; label: string; icon?: string }[];
  workspaceName: string;
  userName: string | null;
  userEmail: string;
}) {
  const { items, workspaceName, userName, userEmail } = props;
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-[272px] shrink-0 border-r border-slate-200/70 bg-white/60 backdrop-blur">
      <div className="flex flex-col w-full min-h-screen">
        <div className="p-4">
          <div className="flex items-center gap-3">
            <div className="relative h-10 w-10 rounded-2xl bg-gradient-to-br from-indigo-600 to-emerald-500 text-white flex items-center justify-center font-bold shadow-soft">
              C
              <div className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-white/90 border border-slate-200" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-tight truncate text-slate-900">{workspaceName}</div>
              <div className="text-xs text-slate-600 truncate">
                {userName ? `${userName} · ` : ""}
                {userEmail}
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 pb-2">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Navigation</div>
        </div>

        <nav className="px-2 pb-4 space-y-1">
          {items.map((it) => {
            const active = pathname === it.href || (it.href !== "/app" && pathname?.startsWith(it.href + "/"));
            return (
              <Link
                key={it.href}
                href={it.href}
                className={
                  "group flex items-center gap-2 px-3 py-2.5 rounded-2xl text-sm transition border " +
                  (active
                    ? "bg-slate-900 text-white border-slate-900/20 shadow-soft"
                    : "border-transparent text-slate-700 hover:bg-white/80")
                }
              >
                <span
                  className={
                    "w-8 h-8 rounded-xl flex items-center justify-center transition " +
                    (active
                      ? "bg-white/10"
                      : "bg-slate-100/70 group-hover:bg-slate-100")
                  }
                >
                  <span className="text-base">{it.icon || ""}</span>
                </span>
                <span className="truncate font-medium">{it.label}</span>
                {active ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400" /> : null}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto p-4">
          <div className="rounded-2xl border border-slate-200/70 bg-white/60 backdrop-blur p-3 text-xs text-slate-600">
            Tip: Replies is your shared inbox. Pin important threads, snooze until due, and assign to teammates.
          </div>
        </div>
      </div>
    </aside>
  );
}
