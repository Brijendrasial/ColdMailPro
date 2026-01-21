"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Modal, Pill } from "@/components/ui";

type WsRow = {
  workspaceId: string;
  workspaceName: string;
  role: string;
  joinedAt?: string;
  createdAt?: string;
};

function fmt(iso?: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function WorkspacesCard({ currentWorkspaceId }: { currentWorkspaceId: string }) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<WsRow[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const current = useMemo(() => rows.find((r) => r.workspaceId === currentWorkspaceId) || null, [rows, currentWorkspaceId]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/workspaces/list", { cache: "no-store" });
      const j = await r.json();
      if (!j?.ok) throw new Error("Failed");
      setRows((j.workspaces || []).map((w: any) => ({
        workspaceId: String(w.workspaceId),
        workspaceName: String(w.workspaceName),
        role: String(w.role || "member"),
        joinedAt: w.joinedAt ? String(w.joinedAt) : undefined,
        createdAt: w.createdAt ? String(w.createdAt) : undefined,
      })));
    } catch {
      setErr("Failed to load workspaces");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function doSwitch(workspaceId: string) {
    if (!workspaceId || workspaceId === currentWorkspaceId) return;
    setBusy(workspaceId);
    setErr(null);
    try {
      const r = await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error("Failed");
      window.location.href = "/app";
    } catch {
      setErr("Failed to switch workspace");
      setBusy(null);
    }
  }

  async function createWorkspace() {
    const name = newName.trim();
    if (!name) {
      setErr("Workspace name is required");
      return;
    }
    setBusy("__create__");
    setErr(null);
    try {
      const r = await fetch("/api/workspaces/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error("Failed");
      window.location.href = "/app";
    } catch {
      setErr("Failed to create workspace");
      setBusy(null);
    }
  }

  return (
    <>
      <Card
        title="Workspaces"
        subtitle="Create multiple isolated workspaces and switch between them (domains, mailboxes, leads, campaigns are isolated per workspace)."
        right={<Pill tone="info">Workspace</Pill>}
      >
        {err ? <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm">❌ {err}</div> : null}

        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="text-xs text-slate-600">
            Current: <span className="font-medium text-slate-900">{current?.workspaceName || "—"}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={load} disabled={loading || busy !== null}>
              Refresh
            </Button>
            <Button type="button" variant="primary" onClick={() => setCreateOpen(true)} disabled={busy !== null}>
              + New workspace
            </Button>
          </div>
        </div>

        <div className="grid gap-2">
          {rows.length === 0 ? (
            <div className="text-sm text-slate-600">{loading ? "Loading…" : "No workspaces yet."}</div>
          ) : (
            rows.map((r) => {
              const isCurrent = r.workspaceId === currentWorkspaceId;
              return (
                <div key={r.workspaceId} className="rounded-2xl border border-slate-200 bg-white/70 p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-medium text-slate-900 truncate">{r.workspaceName}</div>
                      {isCurrent ? <Pill tone="info">Current</Pill> : null}
                      <Pill tone={r.role === "owner" ? "success" : r.role === "admin" ? "info" : "neutral"}>{r.role}</Pill>
                    </div>
                    <div className="text-xs text-slate-600 mt-1 space-y-0.5">
                      <div>ID: <span className="font-mono">{r.workspaceId}</span></div>
                      {r.createdAt ? <div>Created: {fmt(r.createdAt)}</div> : null}
                      {r.joinedAt ? <div>Joined: {fmt(r.joinedAt)}</div> : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isCurrent ? (
                      <Button type="button" variant="ghost" onClick={() => window.location.href = "/app/settings?tab=account"}>
                        Rename
                      </Button>
                    ) : (
                      <Button type="button" variant="secondary" onClick={() => doSwitch(r.workspaceId)} disabled={busy !== null}>
                        {busy === r.workspaceId ? "Switching…" : "Switch"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {createOpen ? (
        <Modal
          title="Create workspace"
          onClose={() => {
            setCreateOpen(false);
            setNewName("");
          }}
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)} disabled={busy !== null}>
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={createWorkspace} disabled={busy !== null}>
                {busy === "__create__" ? "Creating…" : "Create & switch"}
              </Button>
            </div>
          }
        >
          <div className="grid gap-2">
            <div className="text-sm text-slate-700">Workspace name</div>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Client A" maxLength={80} />
            <div className="text-xs text-slate-600">Tip: use one workspace per client / brand to keep everything isolated.</div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
