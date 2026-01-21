"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type SearchItem = {
  type: "campaign" | "lead" | "domain" | "mailbox" | "tenant";
  id: string;
  title: string;
  subtitle?: string | null;
  href: string;
  icon: string;
};

type SearchResponse = {
  ok: boolean;
  q: string;
  items: SearchItem[];
};

function isTypingTarget(el: EventTarget | null) {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = (node.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if ((node as any).isContentEditable) return true;
  return false;
}

export default function SearchBar() {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SearchItem[]>([]);

  const trimmed = q.trim();

  // Focus shortcut: press "/" anywhere to focus search.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isTypingTarget(e.target)) return;
        e.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Close popover on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(t)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  // Debounced fetch
  useEffect(() => {
    const needle = trimmed;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      if (!needle) {
        setItems([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(needle)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as SearchResponse;
        setItems(Array.isArray(data.items) ? data.items : []);
      } catch {
        if (!controller.signal.aborted) setItems([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [trimmed]);

  // Clear and close on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const grouped = useMemo(() => {
    const by: Record<string, SearchItem[]> = {
      campaign: [],
      lead: [],
      domain: [],
      mailbox: [],
      tenant: [],
    };
    for (const it of items) by[it.type]?.push(it);
    return by;
  }, [items]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const needle = trimmed;
    if (!needle) return;
    setOpen(false);
    router.push(`/app/search?q=${encodeURIComponent(needle)}`);
  }

  const showDropdown = open && (loading || !!trimmed);

  return (
    <div ref={wrapRef} className="relative">
      <form onSubmit={onSubmit}>
        <div className="relative">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            className="w-full px-4 py-2 rounded-2xl border border-slate-200 bg-white/70 outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 placeholder:text-slate-400"
            placeholder="Search campaigns, leads, domains…"
            aria-label="Search"
            autoComplete="off"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 border border-slate-200 bg-white/70 rounded-lg px-2 py-1 select-none">
            /
          </div>
        </div>
      </form>

      {showDropdown ? (
        <div className="absolute mt-2 w-full rounded-2xl border border-slate-200 bg-white/95 shadow-lg backdrop-blur overflow-hidden">
          <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200/70 flex items-center justify-between">
            <span>{loading ? "Searching…" : items.length ? "Results" : "No results"}</span>
            {trimmed ? (
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  setItems([]);
                  inputRef.current?.focus();
                }}
                className="text-slate-500 hover:text-slate-700"
              >
                Clear
              </button>
            ) : null}
          </div>

          {!loading && trimmed && items.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-600">Try a different keyword.</div>
          ) : null}

          <div className="max-h-[360px] overflow-auto">
            {(
              [
                ["campaign", "📣 Campaigns"],
                ["lead", "👥 Leads"],
                ["domain", "🌐 Domains"],
                ["mailbox", "📮 Mailboxes"],
                ["tenant", "🛠️ Mailstack"],
              ] as const
            ).map(([k, label]) => {
              const arr = grouped[k] || [];
              if (!arr.length) return null;
              return (
                <div key={k} className="py-1">
                  <div className="px-4 py-2 text-xs font-semibold text-slate-700">{label}</div>
                  <div className="px-2">
                    {arr.map((it) => (
                      <Link
                        key={`${it.type}:${it.id}`}
                        href={it.href}
                        className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-100 transition"
                        onClick={() => setOpen(false)}
                      >
                        <div className="h-9 w-9 rounded-xl border border-slate-200 bg-white grid place-items-center">
                          {it.icon}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-900 truncate">{it.title}</div>
                          {it.subtitle ? (
                            <div className="text-xs text-slate-600 truncate">{it.subtitle}</div>
                          ) : null}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}

            {trimmed ? (
              <div className="p-2 border-t border-slate-200/70">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    router.push(`/app/search?q=${encodeURIComponent(trimmed)}`);
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-100 transition text-sm text-slate-700"
                >
                  View all results for <span className="font-medium text-slate-900">“{trimmed}”</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
