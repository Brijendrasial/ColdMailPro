"use client";

import React, { useMemo, useState } from "react";
import { Button, Card, Pill } from "@/components/ui";

type Props = {
  initial: any;
};

function get(obj: any, path: string, fallback: any) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return fallback;
    cur = cur[p];
  }
  return cur ?? fallback;
}

export default function NotificationsCard({ initial }: Props) {
  const init = initial || {};
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [prefs, setPrefs] = useState(() => ({
    warmupIssues: !!get(init, "notifications.email.warmupIssues", true),
    campaignIssues: !!get(init, "notifications.email.campaignIssues", true),
    dnsIssues: !!get(init, "notifications.email.dnsIssues", true),
    dailyLimitHit: !!get(init, "notifications.email.dailyLimitHit", true),
  }));

  async function save() {
    setSaving(true);
    setOk(null);
    setErr(null);
    try {
      const payload = {
        notifications: {
          email: {
            warmupIssues: prefs.warmupIssues,
            campaignIssues: prefs.campaignIssues,
            dnsIssues: prefs.dnsIssues,
            dailyLimitHit: prefs.dailyLimitHit,
          },
        },
      };
      const r = await fetch("/api/settings/notifications/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error("Failed");
      setOk("Saved");
    } catch {
      setErr("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function ToggleRow(props: { label: string; desc: string; k: keyof typeof prefs }) {
    const { label, desc, k } = props;
    const v = prefs[k];
    return (
      <label className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 cursor-pointer">
        <div className="min-w-0">
          <div className="font-medium text-slate-900">{label}</div>
          <div className="text-xs text-slate-600 mt-1">{desc}</div>
        </div>
        <input
          type="checkbox"
          checked={v}
          onChange={(e) => setPrefs((p) => ({ ...p, [k]: e.target.checked }))}
          className="mt-1 h-5 w-5 accent-slate-900"
        />
      </label>
    );
  }

  return (
    <Card
      title="Notifications"
      subtitle="Control when we alert you about issues and limits."
      right={<Pill tone="info">Preferences</Pill>}
    >
      {err ? <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm">❌ {err}</div> : null}
      {ok ? <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">✅ {ok}</div> : null}

      <div className="grid gap-2">
        <ToggleRow k="warmupIssues" label="Warmup issues" desc="IMAP/SMTP failures, stalled warmup activity, auth errors." />
        <ToggleRow k="campaignIssues" label="Campaign issues" desc="Campaign paused, errors while sending, unexpected failures." />
        <ToggleRow k="dnsIssues" label="DNS & domain issues" desc="Domain verification missing/failed (SPF/DKIM/DMARC), invalid records." />
        <ToggleRow k="dailyLimitHit" label="Daily limit reached" desc="When a mailbox hits its daily send cap (useful for pacing)." />
      </div>

      <div className="flex items-center justify-end mt-4">
        <Button type="button" variant="primary" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save preferences"}
        </Button>
      </div>
    </Card>
  );
}
