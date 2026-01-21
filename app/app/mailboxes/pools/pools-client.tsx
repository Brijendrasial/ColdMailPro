"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button, Input, Pill } from "@/components/ui";

type PoolRow = {
  id: string;
  name: string;
  memberCount: number;
  updatedAt: string;
};

type MailboxBasic = {
  id: string;
  name: string;
  fromEmail: string;
  isActive: boolean;
  warmupEnabled: boolean;
  dailyLimit: number;
  localAddress: string | null;
};

type MemberRow = {
  id: string;
  mailboxId: string;
  weight: number;
  isActive: boolean;
  mailbox: MailboxBasic;
};

type PoolDetail = {
  pool: { id: string; name: string };
  members: MemberRow[];
  mailboxes: MailboxBasic[];
};

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function clampInt(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function clip(s: string, n: number) {
  if (!s) return s;
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export default function PoolsClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [pools, setPools] = useState<PoolRow[]>([]);
  const [activePoolId, setActivePoolId] = useState<string | null>(null);

  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<PoolDetail | null>(null);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  // Rename/delete
  const [renameName, setRenameName] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Member edits (local working copy)
  const [memberEdits, setMemberEdits] = useState<Record<string, { weight: number; isActive: boolean }>>({});
  const [memberAdds, setMemberAdds] = useState<Array<{ mailboxId: string; weight: number }>>([]);
  const [memberRemoves, setMemberRemoves] = useState<Record<string, boolean>>({});
  const [saveBusy, setSaveBusy] = useState(false);

  const [addMailboxId, setAddMailboxId] = useState("");
  const [addWeight, setAddWeight] = useState("1");

  async function refreshPools(selectFirst = false) {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/mailbox-pools/list", { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { pools: PoolRow[] };
      const ps = data.pools || [];
      setPools(ps);
      if (selectFirst) {
        const id = ps[0]?.id || null;
        setActivePoolId((cur) => cur || id);
      }
    } catch (e: any) {
      setError(String(e?.message || e || "FAILED"));
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(poolId: string) {
    setDetailLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/mailbox-pools/detail?poolId=${encodeURIComponent(poolId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as PoolDetail;
      setDetail(data);
      setRenameName(data.pool.name);
      setMemberEdits({});
      setMemberAdds([]);
      setMemberRemoves({});
      setAddMailboxId("");
      setAddWeight("1");
    } catch (e: any) {
      setError(String(e?.message || e || "FAILED"));
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    refreshPools(true);
  }, []);

  useEffect(() => {
    if (activePoolId) loadDetail(activePoolId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePoolId]);

  const activePool = useMemo(() => pools.find((p) => p.id === activePoolId) || null, [pools, activePoolId]);

  const membersView = useMemo(() => {
    const base = detail?.members || [];
    const out: Array<
      (MemberRow & { removed?: boolean }) | { id: string; mailboxId: string; weight: number; isActive: boolean; mailbox: MailboxBasic; isNew: true }
    > = [];

    for (const m of base) {
      const removed = !!memberRemoves[m.id];
      const edit = memberEdits[m.id];
      out.push({
        ...m,
        removed,
        weight: edit?.weight ?? m.weight,
        isActive: edit?.isActive ?? m.isActive,
      });
    }

    const mailboxes = detail?.mailboxes || [];
    for (const a of memberAdds) {
      const mb = mailboxes.find((x) => x.id === a.mailboxId);
      if (!mb) continue;
      out.push({
        id: `new:${a.mailboxId}`,
        mailboxId: a.mailboxId,
        weight: a.weight,
        isActive: true,
        mailbox: mb,
        isNew: true,
      });
    }

    // sort: active first, then by email
    out.sort((aa: any, bb: any) => {
      const a = aa as any;
      const b = bb as any;
      const ar = a.removed ? 1 : 0;
      const br = b.removed ? 1 : 0;
      if (ar !== br) return ar - br;
      const ai = a.isActive ? 0 : 1;
      const bi = b.isActive ? 0 : 1;
      if (ai !== bi) return ai - bi;
      return String(a.mailbox?.fromEmail || "").localeCompare(String(b.mailbox?.fromEmail || ""));
    });

    return out;
  }, [detail, memberAdds, memberEdits, memberRemoves]);

  const dirty = useMemo(() => {
    return (
      Object.keys(memberEdits).length > 0 ||
      memberAdds.length > 0 ||
      Object.keys(memberRemoves).some((k) => memberRemoves[k])
    );
  }, [memberEdits, memberAdds, memberRemoves]);

  const availableMailboxes = useMemo(() => {
    const mailboxes = detail?.mailboxes || [];
    const memberIds = new Set((detail?.members || []).map((m) => m.mailboxId));
    for (const a of memberAdds) memberIds.add(a.mailboxId);
    return mailboxes.filter((m) => !memberIds.has(m.id)).sort((a, b) => a.fromEmail.localeCompare(b.fromEmail));
  }, [detail, memberAdds]);

  function markEdit(memberId: string, patch: Partial<{ weight: number; isActive: boolean }>) {
    setMemberEdits((cur) => {
      const prev = cur[memberId] || null;
      return { ...cur, [memberId]: { weight: patch.weight ?? prev?.weight ?? 1, isActive: patch.isActive ?? prev?.isActive ?? true } };
    });
  }

  async function createPool() {
    const name = createName.trim();
    if (!name) return;
    setCreateBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/mailbox-pools/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { id: string };
      setCreateOpen(false);
      setCreateName("");
      await refreshPools();
      setActivePoolId(data.id);
      setNotice("Pool created.");
    } catch (e: any) {
      setError(String(e?.message || e || "FAILED"));
    } finally {
      setCreateBusy(false);
    }
  }

  async function renamePool() {
    if (!activePoolId) return;
    const name = renameName.trim();
    if (!name) return;
    setRenameBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/mailbox-pools/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: activePoolId, name }),
      });
      if (!res.ok) throw new Error(await res.text());
      await refreshPools();
      setNotice("Pool renamed.");
    } catch (e: any) {
      setError(String(e?.message || e || "FAILED"));
    } finally {
      setRenameBusy(false);
    }
  }

  async function deletePool() {
    if (!activePoolId) return;
    if (!confirm("Delete this pool? Campaigns using it will fall back to other sender options.")) return;
    setDeleteBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/mailbox-pools/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: activePoolId }),
      });
      if (!res.ok) throw new Error(await res.text());
      setDetail(null);
      setActivePoolId(null);
      await refreshPools(true);
      setNotice("Pool deleted.");
    } catch (e: any) {
      setError(String(e?.message || e || "FAILED"));
    } finally {
      setDeleteBusy(false);
    }
  }

  function addMemberLocal() {
    const mbid = addMailboxId;
    if (!mbid) return;
    const w = clampInt(Number(addWeight || "1"), 1, 100);
    setMemberAdds((cur) => {
      if (cur.some((x) => x.mailboxId === mbid)) return cur;
      return [...cur, { mailboxId: mbid, weight: w }];
    });
    setAddMailboxId("");
    setAddWeight("1");
  }

  function removeMemberLocal(member: any) {
    if (String(member.id).startsWith("new:")) {
      const mbid = String(member.mailboxId);
      setMemberAdds((cur) => cur.filter((x) => x.mailboxId !== mbid));
      return;
    }
    setMemberRemoves((cur) => ({ ...cur, [member.id]: true }));
  }

  function undoRemove(member: any) {
    setMemberRemoves((cur) => ({ ...cur, [member.id]: false }));
  }

  async function saveMembers() {
    if (!activePoolId) return;
    setSaveBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updates = Object.entries(memberEdits).map(([id, v]) => ({ id, weight: v.weight, isActive: v.isActive }));
      const removes = Object.keys(memberRemoves).filter((id) => memberRemoves[id]);
      const adds = memberAdds.slice();
      const res = await fetch("/api/mailbox-pools/members/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ poolId: activePoolId, updates, adds, removes }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as PoolDetail;
      setDetail(data);
      setRenameName(data.pool.name);
      setMemberEdits({});
      setMemberAdds([]);
      setMemberRemoves({});
      setNotice("Saved.");
      await refreshPools();
    } catch (e: any) {
      setError(String(e?.message || e || "FAILED"));
    } finally {
      setSaveBusy(false);
    }
  }

  const membersCount = (detail?.members?.length || 0) + memberAdds.length - Object.keys(memberRemoves).filter((k) => memberRemoves[k]).length;
  const totalActiveWeight = useMemo(() => {
    let sum = 0;
    for (const m of membersView as any[]) {
      if ((m as any).removed) continue;
      if (!(m as any).isActive) continue;
      sum += clampInt(Number((m as any).weight || 1), 1, 100);
    }
    return sum;
  }, [membersView]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Left: pool list */}
      <div className="lg:col-span-1">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-sm font-medium text-slate-700">Your pools</div>
          <Button type="button" onClick={() => setCreateOpen(true)}>
            + New pool
          </Button>
        </div>

        {error ? <div className="mb-3 text-sm text-red-700">{clip(error, 200)}</div> : null}
        {notice ? <div className="mb-3 text-sm text-emerald-700">{notice}</div> : null}

        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="text-left px-3 py-2">Pool</th>
                  <th className="text-right px-3 py-2">Members</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={2} className="px-3 py-6 text-center text-slate-600">
                      Loading…
                    </td>
                  </tr>
                ) : pools.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-3 py-6 text-center text-slate-600">
                      No pools yet.
                    </td>
                  </tr>
                ) : (
                  pools.map((p) => (
                    <tr
                      key={p.id}
                      className={cx(
                        "border-t border-slate-100 hover:bg-slate-50 cursor-pointer",
                        p.id === activePoolId && "bg-indigo-50"
                      )}
                      onClick={() => setActivePoolId(p.id)}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900">{p.name}</div>
                        <div className="text-xs text-slate-600">Updated {new Date(p.updatedAt).toLocaleString()}</div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Pill tone={p.memberCount > 0 ? "info" : "neutral"}>{p.memberCount}</Pill>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="text-xs text-slate-600 mt-3">
          Tip: In campaign settings, choose <span className="font-medium">Sender mode → Pool</span> and select one of these pools.
        </div>
      </div>

      {/* Right: pool editor */}
      <div className="lg:col-span-2">
        <div className="rounded-2xl border border-slate-200 bg-white">
          <div className="p-4 border-b border-slate-100">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-slate-700">Selected pool</div>
                <div className="text-lg font-semibold text-slate-900">
                  {activePool ? activePool.name : "—"}
                </div>
                {activePool ? (
                  <div className="text-xs text-slate-600 mt-0.5">
                    Members: <span className="font-medium">{membersCount}</span> · Active weight: <span className="font-medium">{totalActiveWeight}</span>
                  </div>
                ) : null}
              </div>
              {activePool ? (
                <div className="flex items-center gap-2">
                  <Button type="button" variant="ghost" onClick={renamePool} disabled={renameBusy || !renameName.trim()}>
                    {renameBusy ? "Saving…" : "Rename"}
                  </Button>
                  <Button type="button" variant="danger" onClick={deletePool} disabled={deleteBusy}>
                    {deleteBusy ? "Deleting…" : "Delete"}
                  </Button>
                </div>
              ) : null}
            </div>

            {activePool ? (
              <div className="mt-3">
                <div className="text-xs text-slate-600 mb-1">Pool name</div>
                <Input value={renameName} onChange={(e) => setRenameName(e.target.value)} placeholder="Pool name" />
              </div>
            ) : null}
          </div>

          <div className="p-4">
            {!activePool ? (
              <div className="text-sm text-slate-600">Select a pool on the left or create a new one.</div>
            ) : detailLoading ? (
              <div className="text-sm text-slate-600">Loading pool…</div>
            ) : !detail ? (
              <div className="text-sm text-slate-600">Unable to load pool.</div>
            ) : (
              <>
                {/* Add member */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">Add mailbox to pool</div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
                    <div className="md:col-span-3">
                      <div className="text-xs text-slate-600 mb-1">Mailbox</div>
                      <select
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white"
                        value={addMailboxId}
                        onChange={(e) => setAddMailboxId(e.target.value)}
                      >
                        <option value="">Select mailbox…</option>
                        {availableMailboxes.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.fromEmail} {m.isActive ? "" : "(disabled)"}
                          </option>
                        ))}
                      </select>
                      <div className="text-xs text-slate-500 mt-1">Only mailboxes not already in this pool are shown.</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-600 mb-1">Weight</div>
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        value={addWeight}
                        onChange={(e) => setAddWeight(e.target.value)}
                      />
                      <div className="text-xs text-slate-500 mt-1">1–100</div>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button type="button" variant="secondary" onClick={addMemberLocal} disabled={!addMailboxId}>
                      Add
                    </Button>
                  </div>
                </div>

                {/* Members table */}
                <div className="mt-4 rounded-2xl border border-slate-200 bg-white overflow-hidden">
                  <div className="max-h-[520px] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-700">
                        <tr>
                          <th className="text-left px-3 py-2">Mailbox</th>
                          <th className="text-center px-3 py-2">Pool active</th>
                          <th className="text-center px-3 py-2">Weight</th>
                          <th className="text-right px-3 py-2">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {membersView.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-3 py-6 text-center text-slate-600">
                              No members yet.
                            </td>
                          </tr>
                        ) : (
                          membersView.map((m: any) => {
                            const removed = !!m.removed;
                            const mb = m.mailbox as MailboxBasic;
                            return (
                              <tr key={m.id} className={cx("border-t border-slate-100", removed && "opacity-50")}> 
                                <td className="px-3 py-2">
                                  <div className="font-medium text-slate-900">{mb.fromEmail}</div>
                                  <div className="text-xs text-slate-600">
                                    {mb.name || "—"}
                                    {mb.isActive ? "" : " · mailbox disabled"}
                                    {mb.warmupEnabled ? " · warmup on" : ""}
                                    {mb.localAddress ? ` · bind ${mb.localAddress}` : ""}
                                  </div>
                                  {m.isNew ? <div className="text-xs text-indigo-700 mt-0.5">New</div> : null}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <input
                                    type="checkbox"
                                    checked={!!m.isActive}
                                    disabled={removed}
                                    onChange={(e) => {
                                      if (m.isNew) {
                                        // new entries are always active initially
                                        return;
                                      }
                                      markEdit(m.id, { isActive: e.target.checked });
                                    }}
                                  />
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <Input
                                    type="number"
                                    min={1}
                                    max={100}
                                    value={String(m.weight)}
                                    disabled={removed}
                                    onChange={(e) => {
                                      const w = clampInt(Number(e.target.value || "1"), 1, 100);
                                      if (m.isNew) {
                                        setMemberAdds((cur) =>
                                          cur.map((x) => (x.mailboxId === m.mailboxId ? { ...x, weight: w } : x))
                                        );
                                      } else {
                                        markEdit(m.id, { weight: w });
                                      }
                                    }}
                                    className="w-24 text-center"
                                  />
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {removed ? (
                                    <Button type="button" variant="ghost" onClick={() => undoRemove(m)}>
                                      Undo
                                    </Button>
                                  ) : (
                                    <Button type="button" variant="ghost" onClick={() => removeMemberLocal(m)}>
                                      Remove
                                    </Button>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <div className="text-xs text-slate-600">
                    Routing strategy is configured per-campaign. Weights are used only for <span className="font-medium">weighted</span> mode.
                  </div>
                  <div className="flex items-center gap-2">
                    {dirty ? <Pill tone="warning">Unsaved changes</Pill> : <Pill tone="success">Up to date</Pill>}
                    <Button type="button" variant="secondary" onClick={saveMembers} disabled={!dirty || saveBusy}>
                      {saveBusy ? "Saving…" : "Save changes"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Create modal */}
      {createOpen ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => !createBusy && setCreateOpen(false)} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200">
              <div className="p-5 flex items-start justify-between gap-3 border-b border-slate-100">
                <div>
                  <div className="text-lg font-semibold text-slate-900">Create mailbox pool</div>
                  <div className="text-sm text-slate-600 mt-0.5">Pools help you scale by routing campaigns across groups of mailboxes.</div>
                </div>
                <button
                  className="text-slate-500 hover:text-slate-900"
                  onClick={() => !createBusy && setCreateOpen(false)}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="p-5">
                <div className="text-sm mb-1 text-slate-700">Pool name</div>
                <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="e.g. Gmail warm" />
                <div className="text-xs text-slate-500 mt-2">
                  Example pools: <span className="font-medium">Gmail</span>, <span className="font-medium">Outlook</span>, <span className="font-medium">High-trust</span>, <span className="font-medium">New mailboxes</span>
                </div>
              </div>

              <div className="p-5 border-t border-slate-100 flex items-center justify-between">
                <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)} disabled={createBusy}>
                  Cancel
                </Button>
                <Button type="button" variant="secondary" onClick={createPool} disabled={createBusy || !createName.trim()}>
                  {createBusy ? "Creating…" : "Create"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
