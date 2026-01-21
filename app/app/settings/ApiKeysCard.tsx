"use client";

import React, { useMemo, useState } from "react";
import { Button, Input, Pill } from "@/components/ui";

type ApiKeyRow = { id: string; name: string; createdAt: string };

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function ApiKeysCard({ initialKeys }: { initialKeys: ApiKeyRow[] }) {
  const [keys, setKeys] = useState<ApiKeyRow[]>(initialKeys);
  const [name, setName] = useState("My key");
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  const canCreate = useMemo(() => name.trim().length >= 2 && keys.length < 25, [name, keys.length]);

  async function createKey() {
    setError(null);
    setNotice(null);
    setNewKey(null);
    if (!canCreate) return;
    setCreating(true);
    try {
      const res = await fetch("/api/settings/apikeys/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Failed to create key");
      setKeys((prev) => [{ id: j.id, name: j.name, createdAt: j.createdAt }, ...prev]);
      setNewKey(String(j.apiKey || ""));
      setNotice("API key created. Copy it now — it will not be shown again.");
    } catch (e: any) {
      setError(e?.message || "Failed to create key");
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey(id: string) {
    setError(null);
    setNotice(null);
    setNewKey(null);
    setRevoking((p) => ({ ...p, [id]: true }));
    try {
      const res = await fetch("/api/settings/apikeys/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Failed to revoke key");
      setKeys((prev) => prev.filter((k) => k.id !== id));
      setNotice("API key revoked.");
    } catch (e: any) {
      setError(e?.message || "Failed to revoke key");
    } finally {
      setRevoking((p) => ({ ...p, [id]: false }));
    }
  }

  return (
    <div className="grid gap-3">
      {notice ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm">✅ {notice}</div> : null}
      {error ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm">❌ {error}</div> : null}

      <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
        <div>
          <div className="text-sm mb-1 opacity-80">Key name</div>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Zapier / internal tool" />
          <div className="mt-1 text-xs text-slate-600">Tip: Create one key per integration so you can revoke safely.</div>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="primary" disabled={!canCreate || creating} onClick={createKey}>
            {creating ? "Creating…" : "Create key"}
          </Button>
        </div>
      </div>

      {newKey ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="font-medium">New API key</div>
            <Pill tone="warning">Shown once</Pill>
          </div>
          <div className="mt-2 flex gap-2 items-stretch">
            <Input readOnly value={newKey} className="font-mono" />
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                const ok = await copyToClipboard(newKey);
                setNotice(ok ? "Copied." : "Copy failed. Select the key and copy manually.");
              }}
            >
              Copy
            </Button>
          </div>
          <div className="mt-2 text-xs text-slate-700">
            Store this key securely (password manager / secrets vault). If you lose it, create a new one.
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white/60">
        <div className="px-4 py-3 text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200/70">Existing keys</div>
        <div className="divide-y divide-slate-200/70">
          {keys.length === 0 ? (
            <div className="px-4 py-4 text-sm text-slate-600">No API keys yet.</div>
          ) : (
            keys.map((k) => (
              <div key={k.id} className="px-4 py-3 flex items-center gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 truncate">{k.name}</div>
                  <div className="text-xs text-slate-600">Created {fmtDate(k.createdAt)}</div>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    type="button"
                    variant="danger"
                    disabled={!!revoking[k.id]}
                    onClick={() => {
                      if (confirm(`Revoke API key “${k.name}”? This cannot be undone.`)) revokeKey(k.id);
                    }}
                  >
                    {revoking[k.id] ? "Revoking…" : "Revoke"}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
