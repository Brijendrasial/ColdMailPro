"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";

export default function MobileNav(props: { items: { href: string; label: string }[] }) {
  const { items } = props;
  const router = useRouter();
  const pathname = usePathname();

  const activeHref = React.useMemo(() => {
    const p = pathname || "/app";
    // choose the most specific matching prefix
    let best = items[0]?.href || "/app";
    for (const it of items) {
      if (p === it.href || (it.href !== "/app" && p.startsWith(it.href + "/"))) best = it.href;
    }
    return best;
  }, [pathname, items]);

  return (
    <select
      className="md:hidden px-3 py-2 rounded-2xl border border-slate-200 bg-white/70 text-sm max-w-[60vw] focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
      value={activeHref}
      onChange={(e) => router.push(e.target.value)}
    >
      {items.map((it) => (
        <option key={it.href} value={it.href}>
          {it.label}
        </option>
      ))}
    </select>
  );
}
