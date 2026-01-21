"use client";

import React, { useEffect, useState } from "react";
import { Button, Card, Pill, Select } from "@/components/ui";

type Item = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  createdAt: string;
  actor: { id: string; email: string; name: string | null } | null;
  meta: any;
};

const COMMON_ACTIONS = [
  "team.invite.create",
  "team.invite.regenerate",
  "team.invite.revoke",
  "team.invite.accept",
  "team.member.add_existing",
  "team.member.role_change",
  "team.member.remove",
  "security.password.change",
  "security.2fa.enable",
  "security.2fa.disable",
  "security.sessions.revoke_all",
];

export default function AuditLogCard() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [action, setAction] = useState<string>("");

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams();
      qs.set("limit", "75");
      if (action) qs.set("action", action);
      const r = await fetch(`/api/settings/audit?${qs.toString()}`, { cache: "no-store" });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "Failed");
      setItems(j.items || []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  return (
    <Card
      title="Audit log"
      subtitle="Who changed what — critical actions across security, team, and integrations."
      right={<Pill tone="info">Security</Pill>}
    >
      {err ? (
        <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm">❌ {err}</div>
      ) : null}

      <div className="flex flex-col sm:flex-row sm:items-end gap-2">
        <div className="flex-1">
          <div className="text-xs text-slate-600 mb-1">Filter by action</div>
          <Select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {COMMON_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </div>
        <Button type="button" variant="ghost" onClick={load} disabled={loading}>
          Refresh
        </Button>
      </div>

      <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 bg-white/60">
        <table className="min-w-full text-sm">
          <thead className="text-xs text-slate-600">
            <tr className="border-b border-slate-200">
              <th className="text-left p-3">Time</th>
              <th className="text-left p-3">Actor</th>
              <th className="text-left p-3">Action</th>
              <th className="text-left p-3">Target</th>
              <th className="text-left p-3">IP</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td className="p-3 text-slate-600" colSpan={5}>
                  No audit entries.
                </td>
              </tr>
            ) : (
              items.map((x) => (
                <tr key={x.id} className="border-b border-slate-100 last:border-b-0">
                  <td className="p-3 text-slate-700 whitespace-nowrap">{new Date(x.createdAt).toLocaleString()}</td>
                  <td className="p-3 text-slate-700">
                    {x.actor ? (
                      <div className="min-w-0">
                        <div className="font-medium truncate">{x.actor.name || x.actor.email}</div>
                        <div className="text-xs text-slate-500 truncate">{x.actor.email}</div>
                      </div>
                    ) : (
                      <span className="text-slate-500">System</span>
                    )}
                  </td>
                  <td className="p-3">
                    <span className="font-mono text-xs">{x.action}</span>
                  </td>
                  <td className="p-3 text-slate-700">
                    {x.targetType ? (
                      <span className="text-xs">
                        <span className="font-medium">{x.targetType}</span>
                        {x.targetId ? <span className="text-slate-500"> • {x.targetId.slice(0, 8)}</span> : null}
                      </span>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="p-3 text-slate-600 whitespace-nowrap">{x.ip || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-2 text-xs text-slate-500">
        Tip: keep this for compliance and to debug “who changed my campaign settings?”.
      </div>
    </Card>
  );
}
