"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Pill, Select } from "@/components/ui";

type Role = "owner" | "admin" | "member";

type Member = {
  id: string;
  role: Role;
  createdAt: string;
  user: { id: string; email: string; name: string | null };
};

type Invite = {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  expiresAt: string | null;
  createdByUserId: string | null;
};

export default function TeamCard({ currentUserId }: { currentUserId: string }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [meRole, setMeRole] = useState<Role>("member");
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("member");
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);

  const canManage = meRole === "owner" || meRole === "admin";
  const isOwner = meRole === "owner";

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/settings/team", { cache: "no-store" });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "Failed");
      setMeRole(j.meRole);
      setMembers(j.members || []);
      setInvites(j.invites || []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load team");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const sortedMembers = useMemo(() => {
    const rank = (r: Role) => (r === "owner" ? 0 : r === "admin" ? 1 : 2);
    return [...members].sort((a, b) => rank(a.role) - rank(b.role));
  }, [members]);

  async function invite() {
    setOk(null);
    setErr(null);
    setLastInviteUrl(null);
    setLoading(true);
    try {
      const r = await fetch("/api/settings/team", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "Failed");
      if (j.mode === "invite") {
        setLastInviteUrl(j.inviteUrl);
        setOk("Invite created. Copy the link and send it to the teammate.");
      } else {
        setOk(j.message || "Member added.");
      }
      setInviteEmail("");
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed to invite");
    } finally {
      setLoading(false);
    }
  }

  async function changeRole(memberId: string, role: Role) {
    setErr(null);
    setOk(null);
    try {
      const r = await fetch(`/api/settings/team/members/${memberId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "Failed");
      setOk("Role updated.");
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed to update role");
    }
  }

  async function removeMember(memberId: string) {
    if (!confirm("Remove this member from the workspace?")) return;
    setErr(null);
    setOk(null);
    try {
      const r = await fetch(`/api/settings/team/members/${memberId}`, { method: "DELETE" });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "Failed");
      setOk("Member removed.");
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed to remove");
    }
  }

  async function revokeInvite(inviteId: string) {
    if (!confirm("Revoke this invite?")) return;
    setErr(null);
    setOk(null);
    try {
      const r = await fetch(`/api/settings/team/invites/${inviteId}`, { method: "DELETE" });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "Failed");
      setOk("Invite revoked.");
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed to revoke invite");
    }
  }

  async function regenerateInvite(inviteId: string) {
    setErr(null);
    setOk(null);
    setLastInviteUrl(null);
    try {
      const r = await fetch(`/api/settings/team/invites/${inviteId}`, { method: "POST" });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "Failed");
      setLastInviteUrl(j.inviteUrl);
      setOk("Invite link regenerated. Copy the new link.");
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed to regenerate invite");
    }
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text).catch(() => null);
    setOk("Copied to clipboard.");
  }

  return (
    <Card
      title="Team"
      subtitle="Invite teammates, manage roles, and control access to this workspace."
      right={<Pill tone="info">Team</Pill>}
    >
      {err ? (
        <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm">❌ {err}</div>
      ) : null}
      {ok ? (
        <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">✅ {ok}</div>
      ) : null}

      {/* Invite */}
      <div className="rounded-2xl border border-slate-200 bg-white/60 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium text-slate-900">Invite member</div>
            <div className="text-xs text-slate-600 mt-0.5">
              Create an invite link (7 days) or instantly add if the user already exists.
            </div>
          </div>
          <Pill tone={canManage ? "success" : "warning"}>{canManage ? "Admin" : "Read-only"}</Pill>
        </div>

        <div className="mt-3 grid sm:grid-cols-[1fr_160px_140px] gap-2 items-end">
          <div>
            <div className="text-xs text-slate-600 mb-1">Email</div>
            <Input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teammate@company.com"
              disabled={!canManage || loading}
            />
          </div>
          <div>
            <div className="text-xs text-slate-600 mb-1">Role</div>
            <Select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Role)}
              disabled={!canManage || loading}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
          </div>
          <Button
            type="button"
            variant="primary"
            onClick={invite}
            disabled={!canManage || loading || !inviteEmail.trim()}
          >
            Invite
          </Button>
        </div>

        {lastInviteUrl ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-white/70 p-3">
            <div className="text-xs text-slate-600">Invite link (share with teammate)</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <div className="font-mono text-xs break-all flex-1">{lastInviteUrl}</div>
              <Button type="button" variant="ghost" onClick={() => copy(lastInviteUrl)}>
                Copy
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Members */}
      <div className="mt-4">
        <div className="text-sm font-medium text-slate-900">Members</div>
        <div className="mt-2 grid gap-2">
          {sortedMembers.map((m) => {
            const isMe = m.user.id === currentUserId;
            const isTargetOwner = m.role === "owner";
            const canEditTarget = canManage && !isMe && (!isTargetOwner || isOwner);
            return (
              <div
                key={m.id}
                className="rounded-2xl border border-slate-200 bg-white/70 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 truncate">{m.user.name || m.user.email}</div>
                  <div className="text-xs text-slate-600 mt-1">{m.user.email}</div>
                  <div className="text-xs text-slate-500 mt-1">Joined: {new Date(m.createdAt).toLocaleString()}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2 justify-end">
                  <Pill tone={m.role === "owner" ? "success" : m.role === "admin" ? "info" : "neutral"}>{m.role}</Pill>
                  {isMe ? <Pill tone="warning">You</Pill> : null}
                  {canEditTarget ? (
                    <>
                      <Select
                        value={m.role}
                        onChange={(e) => changeRole(m.id, e.target.value as Role)}
                        disabled={loading}
                      >
                        {isOwner ? <option value="owner">Owner</option> : null}
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                      </Select>
                      <Button type="button" variant="danger" onClick={() => removeMember(m.id)}>
                        Remove
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Invites */}
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-slate-900">Pending invites</div>
          <Button type="button" variant="ghost" onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>
        <div className="mt-2 grid gap-2">
          {invites.length === 0 ? (
            <div className="text-sm text-slate-600">No pending invites.</div>
          ) : (
            invites.map((i) => (
              <div
                key={i.id}
                className="rounded-2xl border border-slate-200 bg-white/70 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 truncate">{i.email}</div>
                  <div className="text-xs text-slate-600 mt-1">
                    Role: <span className="font-medium">{i.role}</span>
                    {i.expiresAt ? (
                      <>
                        {" "}• Expires: {new Date(i.expiresAt).toLocaleString()}
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 justify-end">
                  <Pill tone="info">Pending</Pill>
                  {canManage ? (
                    <>
                      <Button type="button" variant="ghost" onClick={() => regenerateInvite(i.id)}>
                        Regenerate link
                      </Button>
                      <Button type="button" variant="danger" onClick={() => revokeInvite(i.id)}>
                        Revoke
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="mt-2 text-xs text-slate-500">
          For security, invite links are shown only when created or regenerated.
        </div>
      </div>
    </Card>
  );
}
