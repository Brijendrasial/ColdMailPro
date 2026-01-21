"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, Modal, Input, Pill } from "@/components/ui";

function linkButtonClass(variant: "primary" | "secondary" | "ghost" | "danger" = "secondary") {
  const base =
    "inline-flex items-center justify-center px-4 py-2 rounded-xl text-sm font-medium transition border focus:outline-none focus:ring-2 focus:ring-indigo-200/70";
  const v =
    variant === "primary"
      ? "bg-indigo-600 text-white border-indigo-700/30 hover:bg-indigo-700"
      : variant === "secondary"
        ? "bg-slate-900 text-white border-slate-900/20 hover:bg-slate-800"
        : variant === "danger"
          ? "bg-red-600 text-white border-red-700/30 hover:bg-red-700"
          : "bg-white/70 text-slate-700 border-slate-200 hover:bg-white";
  return `${base} ${v}`;
}

type WsRow = {
  workspaceId: string;
  workspaceName: string;
  role: string;
  createdAt?: string;
};

export default function WorkspaceSwitcher({
  currentWorkspaceId,
  currentWorkspaceName,
}: {
  currentWorkspaceId: string;
  currentWorkspaceName: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<WsRow[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const current = useMemo(() => {
    return rows.find((r) => r.workspaceId === currentWorkspaceId) || null;
  }, [rows, currentWorkspaceId]);

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
        createdAt: w.createdAt ? String(w.createdAt) : undefined,
      })));
    } catch {
      setErr("Failed to load workspaces");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    load();
  }, [open]);

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
      // Hard reload the CURRENT page so server components re-render under the new wid cookie.
      // This keeps the user on the same screen (eg Mailstack) after switching.
      window.location.href = window.location.href;
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
      // create route switches into the new workspace
      window.location.href = window.location.href;
    } catch {
      setErr("Failed to create workspace");
      setBusy(null);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="w-full justify-between"
        onClick={() => setOpen(true)}
      >
        <span className="truncate">🏢 Switch workspace</span>
        <span className="opacity-60">▾</span>
      </Button>

      {open ? (
        <Modal
          title="Workspaces"
          onClose={() => {
            setOpen(false);
            setCreateOpen(false);
            setNewName("");
            setErr(null);
            setBusy(null);
          }}
          footer={
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-xs text-slate-600 min-w-0">
                Current:{" "}
                <span className="font-medium text-slate-900 truncate inline-block max-w-[22rem] align-bottom">
                  {current?.workspaceName || currentWorkspaceName}
                </span>
              </div>
              <div className="flex items-center gap-2 sm:justify-end">
                <Button type="button" variant="ghost" onClick={load} disabled={loading || busy !== null} className="h-10">
                  Refresh
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => setCreateOpen(true)}
                  disabled={busy !== null}
                  className="h-10"
                >
                  + New workspace
                </Button>
              </div>
            </div>
          }
        >
          {err ? (
            <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm">❌ {err}</div>
          ) : null}

          <div className="grid gap-2">
            {rows.length === 0 ? (
              <div className="text-sm text-slate-600">{loading ? "Loading…" : "No workspaces found."}</div>
            ) : (
              rows.map((r) => {
                const isCurrent = r.workspaceId === currentWorkspaceId;
                return (
                  <div
                    key={r.workspaceId}
                    className="rounded-2xl border border-slate-200 bg-white/70 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-medium text-slate-900 truncate">{r.workspaceName}</div>
                        {isCurrent ? <Pill tone="info">Current</Pill> : null}
                        <Pill tone={r.role === "owner" ? "success" : r.role === "admin" ? "info" : "neutral"}>
                          {r.role}
                        </Pill>
                      </div>
                      <div className="text-xs text-slate-600 mt-1">
                        <span className="font-mono">{r.workspaceId.slice(0, 8)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:justify-end">
                      {isCurrent ? (
                        <Link
                          href="/app/settings?tab=account"
                          className={`${linkButtonClass("ghost")} h-10`}
                        >
                          Settings
                        </Link>
                      ) : (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => doSwitch(r.workspaceId)}
                          disabled={busy !== null}
                          className="h-10"
                        >
                          {busy === r.workspaceId ? "Switching…" : "Switch"}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {createOpen ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900">Create a workspace</div>
                  <div className="text-xs text-slate-600 mt-1">
                    Each workspace is isolated: domains, mailboxes, leads, campaigns.
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 w-9 px-0"
                  onClick={() => {
                    setCreateOpen(false);
                    setNewName("");
                    setErr(null);
                  }}
                  disabled={busy !== null}
                  title="Close"
                >
                  ✕
                </Button>
              </div>

              <div className="mt-4 grid gap-3">
                <div className="grid gap-2">
                  <div className="text-xs font-medium text-slate-700">Workspace name</div>
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Opticals99, Agency - Client A"
                    maxLength={80}
                    className="h-11"
                  />
                </div>

                <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setCreateOpen(false);
                      setNewName("");
                      setErr(null);
                    }}
                    disabled={busy !== null}
                    className="h-11"
                  >
                    Cancel
                  </Button>
                  <Button type="button" variant="primary" onClick={createWorkspace} disabled={busy !== null} className="h-11">
                    {busy === "__create__" ? "Creating…" : "Create & switch"}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}
