"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button, Card, Pill } from "@/components/ui";

type Sess = {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
};

function fmt(iso?: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function uaShort(ua?: string | null) {
  if (!ua) return "Unknown device";
  const s = ua;
  // simple heuristic
  const isMobile = /Android|iPhone|iPad|Mobile/i.test(s);
  const browser =
    /Chrome\//i.test(s) ? "Chrome" :
    /Firefox\//i.test(s) ? "Firefox" :
    /Safari\//i.test(s) && !/Chrome\//i.test(s) ? "Safari" :
    /Edg\//i.test(s) ? "Edge" :
    "Browser";
  const os =
    /Windows NT/i.test(s) ? "Windows" :
    /Mac OS X/i.test(s) ? "macOS" :
    /Linux/i.test(s) ? "Linux" :
    /Android/i.test(s) ? "Android" :
    /iPhone|iPad/i.test(s) ? "iOS" :
    "OS";
  return `${browser} on ${os}${isMobile ? " (mobile)" : ""}`;
}

export default function SessionsCard() {
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Sess[]>([]);
  const [currentSid, setCurrentSid] = useState<string>("");

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/settings/sessions", { cache: "no-store" });
      const j = await r.json();
      if (!j?.ok) throw new Error("Failed");
      setRows(j.sessions || []);
      setCurrentSid(String(j.currentSid || ""));
    } catch (e: any) {
      setErr("Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // periodic refresh
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  async function revoke(id: string) {
    setBusyId(id);
    setErr(null);
    try {
      const r = await fetch("/api/settings/sessions/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error("Failed");
      if (j.loggedOut) {
        window.location.href = "/login";
        return;
      }
      await load();
    } catch {
      setErr("Failed to revoke session");
    } finally {
      setBusyId(null);
    }
  }

  async function revokeAll() {
    if (!confirm("Sign out everywhere? This will log you out on all devices.")) return;
    setBusyId("__all__");
    setErr(null);
    try {
      const r = await fetch("/api/settings/sessions/revoke-all", {
        method: "POST",
      });
      const j = await r.json();
      if (!j?.ok) throw new Error("Failed");
      window.location.href = "/login";
    } catch {
      setErr("Failed to sign out everywhere");
      setBusyId(null);
    }
  }

  return (
    <Card
      title="Sessions (Devices)"
      subtitle="See where your account is signed in. Revoke any device instantly."
      right={<Pill tone="warning">Security</Pill>}
    >
      {err ? <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm">❌ {err}</div> : null}

      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-xs text-slate-600">
          Tip: revoke anything you don&apos;t recognize.
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={load} disabled={loading || busyId !== null}>
            Refresh
          </Button>
          <Button type="button" variant="danger" onClick={revokeAll} disabled={busyId !== null}>
            Sign out everywhere
          </Button>
        </div>
      </div>

      <div className="grid gap-2">
        {rows.length === 0 ? (
          <div className="text-sm text-slate-600">No sessions found.</div>
        ) : (
          rows.map((s) => {
            const isCurrent = s.id === currentSid;
            const revoked = !!s.revokedAt;
            return (
              <div key={s.id} className="rounded-2xl border border-slate-200 bg-white/70 p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-medium text-slate-900 truncate">{uaShort(s.userAgent)}</div>
                    {isCurrent ? <Pill tone="info">Current</Pill> : null}
                    {revoked ? <Pill tone="neutral">Revoked</Pill> : <Pill tone="success">Active</Pill>}
                  </div>
                  <div className="text-xs text-slate-600 mt-1 space-y-0.5">
                    <div>IP: <span className="font-mono">{s.ip || "unknown"}</span></div>
                    <div>Created: {fmt(s.createdAt)}</div>
                    <div>Last seen: {fmt(s.lastSeenAt)}</div>
                    {revoked ? <div>Revoked: {fmt(s.revokedAt)} {s.revokedReason ? `(reason: ${s.revokedReason})` : ""}</div> : null}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!revoked ? (
                    <Button
                      type="button"
                      variant={isCurrent ? "danger" : "ghost"}
                      onClick={() => revoke(s.id)}
                      disabled={busyId !== null}
                    >
                      {busyId === s.id ? "Working..." : isCurrent ? "Log out" : "Revoke"}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
