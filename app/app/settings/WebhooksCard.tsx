"use client";

import React, { useEffect, useState } from "react";
import { Button, Card, Input, Pill } from "@/components/ui";

type Webhook = {
  id: string;
  url: string;
  events: string;
  isActive: boolean;
  createdAt: string;
  secret: string;
};

export default function WebhooksCard() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [items, setItems] = useState<Webhook[]>([]);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState("sent,open,click,bounce,reply,unsubscribe");

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/settings/webhooks", { cache: "no-store" });
      const j = await r.json();
      if (!j?.ok) throw new Error("Failed");
      setItems(j.webhooks || []);
    } catch {
      setErr("Failed to load webhooks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    setOk(null);
    setErr(null);
    setLoading(true);
    try {
      const r = await fetch("/api/settings/webhooks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, events }),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error("Failed");
      setUrl("");
      setOk("Webhook created (secret shown in list).");
      await load();
    } catch {
      setErr("Failed to create webhook");
    } finally {
      setLoading(false);
    }
  }

  async function toggle(id: string, isActive: boolean) {
    setErr(null);
    setOk(null);
    try {
      const r = await fetch(`/api/settings/webhooks/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error("Failed");
      await load();
    } catch {
      setErr("Failed to update webhook");
    }
  }

  async function rotate(id: string) {
    if (!confirm("Rotate secret? You must update the receiver to use the new secret.")) return;
    setErr(null);
    setOk(null);
    try {
      const r = await fetch(`/api/settings/webhooks/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rotateSecret: true }),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error("Failed");
      setOk("Secret rotated.");
      await load();
    } catch {
      setErr("Failed to rotate secret");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this webhook?")) return;
    setErr(null);
    setOk(null);
    try {
      const r = await fetch(`/api/settings/webhooks/${id}`, { method: "DELETE" });
      const j = await r.json();
      if (!j?.ok) throw new Error("Failed");
      await load();
    } catch {
      setErr("Failed to delete webhook");
    }
  }

  return (
    <Card
      title="Integrations — Webhooks"
      subtitle="Send events (sent/open/click/bounce/reply) to your own endpoints."
      right={<Pill tone="info">Integrations</Pill>}
    >
      {err ? <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm">❌ {err}</div> : null}
      {ok ? <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">✅ {ok}</div> : null}

      <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 mb-4">
        <div className="font-medium text-slate-900">Add webhook</div>
        <div className="grid sm:grid-cols-2 gap-2 mt-3">
          <div>
            <div className="text-xs text-slate-600 mb-1">URL</div>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/webhooks/coldmail" />
          </div>
          <div>
            <div className="text-xs text-slate-600 mb-1">Events (comma-separated)</div>
            <Input value={events} onChange={(e) => setEvents(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end mt-3">
          <Button type="button" variant="primary" disabled={loading || !url} onClick={create}>
            {loading ? "Working..." : "Create webhook"}
          </Button>
        </div>
      </div>

      <div className="grid gap-2">
        {items.length === 0 ? (
          <div className="text-sm text-slate-600">No webhooks yet.</div>
        ) : (
          items.map((w) => (
            <div key={w.id} className="rounded-2xl border border-slate-200 bg-white/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 break-all">{w.url}</div>
                  <div className="text-xs text-slate-600 mt-1">
                    Events: <span className="font-mono">{w.events}</span>
                  </div>
                  <div className="text-xs text-slate-600 mt-1">
                    Secret: <span className="font-mono">{w.secret}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <Button type="button" variant="ghost" onClick={() => rotate(w.id)}>Rotate secret</Button>
                  <Button type="button" variant={w.isActive ? "ghost" : "primary"} onClick={() => toggle(w.id, !w.isActive)}>
                    {w.isActive ? "Disable" : "Enable"}
                  </Button>
                  <Button type="button" variant="danger" onClick={() => remove(w.id)}>Delete</Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
