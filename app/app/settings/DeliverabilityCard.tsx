"use client";

import React, { useState } from "react";
import { Button, Card, Input, Pill } from "@/components/ui";

type Props = { initial: any };

function get(obj: any, path: string, fallback: any) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return fallback;
    cur = cur[p];
  }
  return cur ?? fallback;
}

export default function DeliverabilityCard({ initial }: Props) {
  const init = initial || {};

  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [dailyLimitDefault, setDailyLimitDefault] = useState<number>(() => Number(get(init, "deliverability.dailyLimitDefault", 50)));
  const [quietStart, setQuietStart] = useState<string>(() => String(get(init, "deliverability.quietHours.start", "22:00")));
  const [quietEnd, setQuietEnd] = useState<string>(() => String(get(init, "deliverability.quietHours.end", "07:00")));
  const [quietEnabled, setQuietEnabled] = useState<boolean>(() => !!get(init, "deliverability.quietHours.enabled", true));

  const [rampEnabled, setRampEnabled] = useState<boolean>(() => !!get(init, "deliverability.rampUp.enabled", true));
  const [rampStart, setRampStart] = useState<number>(() => Number(get(init, "deliverability.rampUp.start", 10)));
  const [rampStep, setRampStep] = useState<number>(() => Number(get(init, "deliverability.rampUp.step", 5)));
  const [rampMax, setRampMax] = useState<number>(() => Number(get(init, "deliverability.rampUp.max", 50)));

  const [bounceProtect, setBounceProtect] = useState<boolean>(() => !!get(init, "deliverability.bounceProtection.enabled", true));
  const [bounceRatePct, setBounceRatePct] = useState<number>(() => Number(get(init, "deliverability.bounceProtection.pauseIfHardBouncePct", 5)));

  async function save() {
    setSaving(true);
    setOk(null);
    setErr(null);
    try {
      const payload = {
        deliverability: {
          dailyLimitDefault: Math.max(1, Math.min(1000, Number(dailyLimitDefault) || 50)),
          quietHours: { enabled: !!quietEnabled, start: quietStart, end: quietEnd },
          rampUp: { enabled: !!rampEnabled, start: Number(rampStart) || 10, step: Number(rampStep) || 5, max: Number(rampMax) || 50 },
          bounceProtection: { enabled: !!bounceProtect, pauseIfHardBouncePct: Number(bounceRatePct) || 5 },
        },
      };

      const r = await fetch("/api/settings/deliverability/update", {
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

  return (
    <Card
      title="Deliverability defaults"
      subtitle="Workspace-level defaults for pacing, quiet hours, ramp-up and protection."
      right={<Pill tone="success">Workspace</Pill>}
    >
      {err ? <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm">❌ {err}</div> : null}
      {ok ? <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">✅ {ok}</div> : null}

      <div className="grid gap-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <div className="text-sm mb-1 opacity-80">Default daily limit (new mailboxes)</div>
            <Input type="number" value={dailyLimitDefault} onChange={(e) => setDailyLimitDefault(Number(e.target.value))} min={1} max={1000} />
            <div className="text-xs text-slate-600 mt-1">Applied when creating new mailboxes. You can still override per mailbox.</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white/70 p-3">
            <div className="flex items-center justify-between">
              <div className="font-medium text-slate-900">Quiet hours</div>
              <input type="checkbox" checked={quietEnabled} onChange={(e) => setQuietEnabled(e.target.checked)} className="h-5 w-5 accent-slate-900" />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <div>
                <div className="text-xs text-slate-600 mb-1">Start</div>
                <Input value={quietStart} onChange={(e) => setQuietStart(e.target.value)} placeholder="22:00" />
              </div>
              <div>
                <div className="text-xs text-slate-600 mb-1">End</div>
                <Input value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} placeholder="07:00" />
              </div>
            </div>
            <div className="text-xs text-slate-600 mt-2">Campaign sends should pause in this window (local time).</div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-slate-900">Ramp-up rules</div>
              <div className="text-xs text-slate-600 mt-1">Start low and increase daily limits safely.</div>
            </div>
            <input type="checkbox" checked={rampEnabled} onChange={(e) => setRampEnabled(e.target.checked)} className="h-5 w-5 accent-slate-900" />
          </div>
          <div className="grid sm:grid-cols-3 gap-2 mt-3">
            <div>
              <div className="text-xs text-slate-600 mb-1">Start</div>
              <Input type="number" value={rampStart} onChange={(e) => setRampStart(Number(e.target.value))} />
            </div>
            <div>
              <div className="text-xs text-slate-600 mb-1">Step / day</div>
              <Input type="number" value={rampStep} onChange={(e) => setRampStep(Number(e.target.value))} />
            </div>
            <div>
              <div className="text-xs text-slate-600 mb-1">Max</div>
              <Input type="number" value={rampMax} onChange={(e) => setRampMax(Number(e.target.value))} />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-slate-900">Bounce protection</div>
              <div className="text-xs text-slate-600 mt-1">Safety switch when hard bounces spike.</div>
            </div>
            <input type="checkbox" checked={bounceProtect} onChange={(e) => setBounceProtect(e.target.checked)} className="h-5 w-5 accent-slate-900" />
          </div>
          <div className="mt-3">
            <div className="text-xs text-slate-600 mb-1">Pause if hard-bounce rate exceeds (%)</div>
            <Input type="number" value={bounceRatePct} onChange={(e) => setBounceRatePct(Number(e.target.value))} min={1} max={100} />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end mt-4">
        <Button type="button" variant="primary" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save defaults"}
        </Button>
      </div>
    </Card>
  );
}
