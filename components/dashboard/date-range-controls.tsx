"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Input, Button } from "@/components/ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function hrefWith(path: string, params: URLSearchParams) {
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}

export default function DateRangeControls() {
  const sp = useSearchParams();
  const params = sp ?? new URLSearchParams();
  const pathname = usePathname() || "/app/analytics";
  const router = useRouter();

  const range = params.get("range") || "7d";
  const fromQ = params.get("from") || "";
  const toQ = params.get("to") || "";

  const [customOpen, setCustomOpen] = useState(range === "custom");
  const [from, setFrom] = useState(fromQ);
  const [to, setTo] = useState(toQ);

  const presets = useMemo(
    () => [
      { key: "24h", label: "24h" },
      { key: "7d", label: "7d" },
      { key: "30d", label: "30d" },
    ],
    []
  );

  function presetHref(key: string) {
    const p = new URLSearchParams(params.toString());
    p.set("range", key);
    p.delete("from");
    p.delete("to");
    return hrefWith(pathname, p);
  }

  function applyCustom() {
    if (!from || !to) return;
    const p = new URLSearchParams(params.toString());
    p.set("range", "custom");
    p.set("from", from);
    p.set("to", to);
    router.push(hrefWith(pathname, p));
    setCustomOpen(false);
  }

  const pillBase = "inline-flex items-center px-3 py-1.5 rounded-xl border text-sm transition";
  const active = "bg-indigo-600 text-white border-indigo-700/30";
  const idle = "bg-white text-slate-700 border-slate-200 hover:bg-slate-50";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-1">
        {presets.map((p) => (
          <Link key={p.key} href={presetHref(p.key)} className={`${pillBase} ${range === p.key ? active : idle}`}>
            {p.label}
          </Link>
        ))}
        <button
          type="button"
          className={`${pillBase} ${range === "custom" ? active : idle}`}
          onClick={() => setCustomOpen((v) => !v)}
        >
          Custom
        </button>
      </div>

      {customOpen ? (
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2">
          <div className="text-xs text-slate-600 px-1">From</div>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[150px]" />
          <div className="text-xs text-slate-600 px-1">To</div>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[150px]" />
          <Button type="button" onClick={applyCustom}>
            Apply
          </Button>
          <Link href={presetHref("7d")} className="text-sm text-slate-600 hover:underline px-1">
            Reset
          </Link>
        </div>
      ) : null}
    </div>
  );
}
