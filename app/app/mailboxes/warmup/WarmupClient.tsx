"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Pill } from "@/components/ui";

type WarmupProfileRow = {
  mailboxId: string;
  mailboxName: string;
  fromEmail: string;
  isActive: boolean;
  warmupEnabled: boolean;
  profile: {
    id: string;
    mode: "internal" | "seeds" | "hybrid";
    startPerDay: number;
    increasePerDay: number;
    maxPerDay: number;
    timezone: string;
    windowStartMin: number;
    windowEndMin: number;
    weekdaysOnly: boolean;
  } | null;
  stats: {
    sentToday: number;
    inbox7d: number;
    spam7d: number;
    unknown7d: number;
    lastPlacementAt: string | null;
  };
};

type SeedRow = {
  id: string;
  name: string;
  email: string;
  source?: "manual" | "system" | string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  isActive: boolean;
  lastCheckedAt: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean | null;
  smtpUser?: string | null;
  smtpConfigured?: boolean;
};

type TemplateRow = {
  id: string;
  type: "initial" | "reply";
  source?: "manual" | "system" | string;
  name: string;
  subject: string;
  text: string;
  isActive: boolean;
};

type AiTemplate = { name: string; subject: string; text: string };

function minsToHHMM(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function hhmmToMins(v: string) {
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 540;
  const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return hh * 60 + mm;
}

function sourcePill(source?: string) {
  if (!source) return <Pill tone="gray">—</Pill>;
  if (source === "system") return <Pill tone="gray">System</Pill>;
  if (source === "manual") return <Pill tone="green">Manual</Pill>;
  return <Pill tone="gray">{source}</Pill>;
}

export default function WarmupClient() {
  const [tab, setTab] = useState<"profiles" | "seeds" | "templates">("profiles");
  const [profiles, setProfiles] = useState<WarmupProfileRow[]>([]);
  const [seeds, setSeeds] = useState<SeedRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    try {
      const [p, s, t] = await Promise.all([
        fetch("/api/warmup/profiles/list").then((r) => r.json()),
        fetch("/api/warmup/seeds/list").then((r) => r.json()),
        fetch("/api/warmup/templates/list").then((r) => r.json()),
      ]);
      if (p?.profiles) setProfiles(p.profiles);
      if (s?.seeds) setSeeds(s.seeds);
      if (t?.templates) setTemplates(t.templates);
    } catch (e: any) {
      setMsg(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    const id = setInterval(() => loadAll(), 30000);
    return () => clearInterval(id);
  }, []);

  async function runNow(mailboxId?: string) {
    setMsg(null);
    const res = await fetch("/api/warmup/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mailboxId }),
    });
    const j = await res.json();
    if (!res.ok) setMsg(j?.error || "Failed");
    else setMsg("Warmup jobs enqueued.");
    await loadAll();
  }

  async function queueMailboxHealthcheck(mailboxId: string, mode: "smtp" | "imap" | "both" = "both") {
    setMsg(null);
    const res = await fetch("/api/mailboxes/healthcheck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mailboxId, mode }),
    });
    const j = await res.json();
    if (!res.ok) setMsg(j?.error || "Failed");
    else setMsg(`Healthcheck queued (${mode}).`);
  }

  async function saveProfile(row: WarmupProfileRow, patch: any) {
    setMsg(null);
    const body = {
      mailboxId: row.mailboxId,
      warmupEnabled: patch.warmupEnabled ?? row.warmupEnabled,
      profile: {
        mode: patch.mode ?? row.profile?.mode ?? "hybrid",
        startPerDay: patch.startPerDay ?? row.profile?.startPerDay ?? 2,
        increasePerDay: patch.increasePerDay ?? row.profile?.increasePerDay ?? 1,
        maxPerDay: patch.maxPerDay ?? row.profile?.maxPerDay ?? 10,
        timezone: patch.timezone ?? row.profile?.timezone ?? "UTC",
        windowStartMin: patch.windowStartMin ?? row.profile?.windowStartMin ?? 540,
        windowEndMin: patch.windowEndMin ?? row.profile?.windowEndMin ?? 1020,
        weekdaysOnly: patch.weekdaysOnly ?? row.profile?.weekdaysOnly ?? true,
        isActive: patch.isActive ?? true,
      },
    };
    const res = await fetch("/api/warmup/profiles/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!res.ok) setMsg(j?.error || "Failed");
    else setMsg("Saved.");
    await loadAll();
  }

  async function deleteProfile(mailboxId: string) {
    if (!confirm("Disable warmup and delete the warmup profile for this mailbox?")) return;
    setMsg(null);
    const res = await fetch("/api/warmup/profiles/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mailboxId }),
    });
    const j = await res.json();
    if (!res.ok) setMsg(j?.error || "Failed");
    else setMsg("Warmup profile removed.");
    await loadAll();
  }

  async function upsertSeed(seed: any) {
    setMsg(null);
    const res = await fetch("/api/warmup/seeds/upsert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(seed),
    });
    const j = await res.json();
    if (!res.ok) setMsg(j?.error || "Failed");
    else setMsg("Saved seed inbox.");
    await loadAll();
  }

  async function testSeed(id: string) {
    setMsg(null);
    const res = await fetch("/api/warmup/seeds/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const j = await res.json();
    if (!res.ok) {
      setMsg(j?.error || "Failed");
    } else {
      const parts = [
        `IMAP: ${j.imapOk ? "OK" : "FAIL"}`,
        j.smtpConfigured ? `SMTP: ${j.smtpOk ? "OK" : "FAIL"}` : "SMTP: (not configured)",
      ];
      if (j.imapError) parts.push(`IMAP_ERR: ${j.imapError}`);
      if (j.smtpError && j.smtpError !== "SMTP_NOT_CONFIGURED") parts.push(`SMTP_ERR: ${j.smtpError}`);
      setMsg(parts.join(" | "));
    }
    await loadAll();
  }

  async function deleteSeed(id: string) {
    if (!confirm("Delete this seed inbox?")) return;
    setMsg(null);
    const res = await fetch("/api/warmup/seeds/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const j = await res.json();
    if (!res.ok) setMsg(j?.error || "Failed");
    else setMsg("Deleted.");
    await loadAll();
  }

  async function deleteManualSeeds() {
    if (!confirm("Delete ALL manual seed inboxes in this workspace?")) return;
    setMsg(null);
    const res = await fetch("/api/warmup/seeds/delete-manual", { method: "POST" });
    const j = await res.json();
    if (!res.ok) setMsg(j?.error || "Failed");
    else setMsg(`Deleted manual seeds: ${j.deleted}`);
    await loadAll();
  }

  async function upsertTemplate(tpl: any) {
    setMsg(null);
    const res = await fetch("/api/warmup/templates/upsert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(tpl),
    });
    const j = await res.json();
    if (!res.ok) setMsg(j?.error || "Failed");
    else setMsg("Saved template.");
    await loadAll();
  }

  async function deleteTemplate(id: string) {
    if (!confirm("Delete this template?")) return;
    setMsg(null);
    const res = await fetch("/api/warmup/templates/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const j = await res.json();
    if (!res.ok) setMsg(j?.error || "Failed");
    else setMsg("Deleted.");
    await loadAll();
  }

  async function deleteManualTemplates() {
    if (!confirm("Delete ALL manual templates in this workspace?")) return;
    setMsg(null);
    const res = await fetch("/api/warmup/templates/delete-manual", { method: "POST" });
    const j = await res.json();
    if (!res.ok) setMsg(j?.error || "Failed");
    else setMsg(`Deleted manual templates: ${j.deleted}`);
    await loadAll();
  }

  async function seedDefaults() {
    setMsg(null);
    const res = await fetch("/api/warmup/templates/seed-defaults", { method: "POST" });
    const j = await res.json();
    if (!res.ok) setMsg(j?.error || "Failed");
    else setMsg(j?.skipped ? "Defaults already exist." : "Seeded defaults.");
    await loadAll();
  }

  async function cleanupManual() {
    if (!confirm("Delete ALL manual seeds + templates in this workspace?")) return;
    setMsg(null);
    const res = await fetch("/api/warmup/cleanup-manual", { method: "POST" });
    const j = await res.json();
    if (!res.ok) setMsg(j?.error || "Failed");
    else setMsg(`Deleted manual seeds: ${j.seedsDeleted}, manual templates: ${j.templatesDeleted}`);
    await loadAll();
  }

  const profilesView = (
    <Card
      title="Warmup profiles"
      subtitle="Enable warmup, set ramp plan and sending window. Placement is measured via seed inboxes."
      right={
        <div className="flex items-center gap-2">
          <Button onClick={() => runNow()} variant="secondary">
            Run warmup now
          </Button>
          <Button onClick={() => queueMailboxHealthcheck(profiles?.[0]?.mailboxId || "", "both")} variant="secondary" disabled>
            
          </Button>
          <Button onClick={() => loadAll()} variant="secondary">
            Refresh
          </Button>
        </div>
      }
    >
      <div className="mb-3 flex items-center gap-2">
        <Button onClick={() => setTab("profiles")} variant={tab === "profiles" ? "primary" : "secondary"}>
          Profiles
        </Button>
        <Button onClick={() => setTab("seeds")} variant={tab === "seeds" ? "primary" : "secondary"}>
          Seed inboxes
        </Button>
        <Button onClick={() => setTab("templates")} variant={tab === "templates" ? "primary" : "secondary"}>
          Templates
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1250px] w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-2">Mailbox</th>
              <th>Warmup</th>
              <th>Mode</th>
              <th>Ramp</th>
              <th>Window</th>
              <th>Placement (7d)</th>
              <th>Sent today</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((r) => {
              const p = r.profile;
              const placementTotal = r.stats.inbox7d + r.stats.spam7d + r.stats.unknown7d;
              const inboxRate = placementTotal ? Math.round((r.stats.inbox7d / placementTotal) * 100) : 0;
              return (
                <tr key={r.mailboxId} className="border-t border-slate-100 align-top">
                  <td className="py-3 pr-3">
                    <div className="font-medium">{r.mailboxName}</div>
                    <div className="text-slate-500">{r.fromEmail}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={r.warmupEnabled}
                        onChange={(e) => saveProfile(r, { warmupEnabled: e.target.checked })}
                      />
                      <span>{r.warmupEnabled ? "On" : "Off"}</span>
                    </label>
                    <div className="mt-2">
                      <Pill tone={r.isActive ? "green" : "gray"}>{r.isActive ? "Active" : "Disabled"}</Pill>
                    </div>
                  </td>
                  <td className="py-3 pr-3">
                    <select
                      className="rounded-xl border border-slate-200 px-2 py-1"
                      value={p?.mode || "hybrid"}
                      onChange={(e) => saveProfile(r, { mode: e.target.value })}
                    >
                      <option value="hybrid">hybrid</option>
                      <option value="internal">internal</option>
                      <option value="seeds">seeds</option>
                    </select>
                    <div className="mt-2 text-xs text-slate-500">
                      {seeds.length ? `${seeds.length} seed(s)` : "No seeds yet"}
                    </div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-2">
                      <Input
                        className="w-16"
                        value={String(p?.startPerDay ?? 2)}
                        onChange={(e) => saveProfile(r, { startPerDay: parseInt(e.target.value || "2", 10) })}
                      />
                      <span className="text-slate-500">+</span>
                      <Input
                        className="w-16"
                        value={String(p?.increasePerDay ?? 1)}
                        onChange={(e) => saveProfile(r, { increasePerDay: parseInt(e.target.value || "1", 10) })}
                      />
                      <span className="text-slate-500">/day max</span>
                      <Input
                        className="w-16"
                        value={String(p?.maxPerDay ?? 10)}
                        onChange={(e) => saveProfile(r, { maxPerDay: parseInt(e.target.value || "10", 10) })}
                      />
                    </div>
                    <div className="mt-2 text-xs text-slate-500">start + increase/day capped by max</div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-2">
                      <Input
                        className="w-24"
                        value={p?.timezone ?? "UTC"}
                        onChange={(e) => saveProfile(r, { timezone: e.target.value || "UTC" })}
                        placeholder="UTC"
                      />
                      <Input
                        className="w-20"
                        value={minsToHHMM(p?.windowStartMin ?? 540)}
                        onChange={(e) => saveProfile(r, { windowStartMin: hhmmToMins(e.target.value) })}
                      />
                      <span className="text-slate-500">-</span>
                      <Input
                        className="w-20"
                        value={minsToHHMM(p?.windowEndMin ?? 1020)}
                        onChange={(e) => saveProfile(r, { windowEndMin: hhmmToMins(e.target.value) })}
                      />
                    </div>
                    <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={p?.weekdaysOnly ?? true}
                        onChange={(e) => saveProfile(r, { weekdaysOnly: e.target.checked })}
                      />
                      Weekdays only
                    </label>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-2">
                      <Pill tone="green">Inbox {r.stats.inbox7d}</Pill>
                      <Pill tone="red">Spam {r.stats.spam7d}</Pill>
                      <Pill tone="gray">Unknown {r.stats.unknown7d}</Pill>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">Inbox rate: {placementTotal ? `${inboxRate}%` : "—"}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-semibold">{r.stats.sentToday}</div>
                    <div className="text-xs text-slate-500">
                      {r.stats.lastPlacementAt ? `Last: ${new Date(r.stats.lastPlacementAt).toLocaleString()}` : "—"}
                    </div>
                  </td>
                  <td className="py-3 text-right">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button variant="secondary" onClick={() => queueMailboxHealthcheck(r.mailboxId, "both")}>
                        Check SMTP/IMAP
                      </Button>
                      <Button variant="secondary" onClick={() => runNow(r.mailboxId)}>
                        Run now
                      </Button>
                      <Button variant="secondary" onClick={() => deleteProfile(r.mailboxId)}>
                        Remove profile
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!profiles.length && (
              <tr>
                <td colSpan={8} className="py-6 text-center text-slate-500">
                  No mailboxes found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {loading && <div className="mt-3 text-xs text-slate-400">Refreshing…</div>}
    </Card>
  );

  const seedsView = (
    <SeedsCard
      seeds={seeds}
      onUpsert={upsertSeed}
      onDelete={deleteSeed}
      onTest={testSeed}
      onDeleteManual={deleteManualSeeds}
      tab={tab}
      setTab={setTab}
    />
  );

  const templatesView = (
    <TemplatesCard
      templates={templates}
      onUpsert={upsertTemplate}
      onDelete={deleteTemplate}
      onSeedDefaults={seedDefaults}
      onDeleteManual={deleteManualTemplates}
      onCleanupManual={cleanupManual}
      tab={tab}
      setTab={setTab}
    />
  );

  return (
    <div className="space-y-4">
      {msg && <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm">{msg}</div>}
      {tab === "profiles" && profilesView}
      {tab === "seeds" && seedsView}
      {tab === "templates" && templatesView}
    </div>
  );
}

function SeedsCard({
  seeds,
  onUpsert,
  onDelete,
  onTest,
  onDeleteManual,
  tab,
  setTab,
}: {
  seeds: SeedRow[];
  onUpsert: (seed: any) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onTest: (id: string) => Promise<void>;
  onDeleteManual: () => Promise<void>;
  tab: any;
  setTab: any;
}) {
  const empty = {
    id: "",
    name: "",
    email: "",
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    imapUser: "",
    password: "",
    isActive: true,
    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: "",
    smtpPassword: "",
  };

  const [form, setForm] = useState<any>(empty);
  const isEditing = !!form.id;

  const activeCount = useMemo(() => seeds.filter((s) => s.isActive).length, [seeds]);

  return (
    <Card
      title="Seed inboxes (Gmail/Outlook)"
      subtitle={`Add external IMAP inboxes to measure inbox vs spam placement. Active: ${activeCount}/${seeds.length}. Passwords are encrypted at rest.`}
      right={
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setTab("profiles")} variant="secondary">
            Profiles
          </Button>
          <Button onClick={() => setTab("seeds")} variant={tab === "seeds" ? "primary" : "secondary"}>
            Seeds
          </Button>
          <Button onClick={() => setTab("templates")} variant="secondary">
            Templates
          </Button>
          <Button onClick={onDeleteManual} variant="secondary">
            Delete manual
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Input
          placeholder="IMAP Host (imap.gmail.com)"
          value={form.imapHost}
          onChange={(e) => setForm({ ...form, imapHost: e.target.value })}
        />
        <Input placeholder="IMAP User" value={form.imapUser} onChange={(e) => setForm({ ...form, imapUser: e.target.value })} />
        <Input
          placeholder={isEditing ? "Leave blank to keep existing" : "IMAP Password / App password"}
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="w-24"
            placeholder="Port"
            value={String(form.imapPort)}
            onChange={(e) => setForm({ ...form, imapPort: parseInt(e.target.value || "993", 10) })}
          />
          <label className="inline-flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={form.imapSecure} onChange={(e) => setForm({ ...form, imapSecure: e.target.checked })} />
            TLS
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={!!form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            Active
          </label>
          <Button
            onClick={async () => {
              const payload = { ...form };
              if (!payload.id) delete payload.id;
              await onUpsert(payload);
              setForm(empty);
            }}
          >
            {isEditing ? "Update" : "Add seed"}
          </Button>
          {isEditing && (
            <Button variant="secondary" onClick={() => setForm(empty)}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">SMTP (optional) — required for seed auto-replies</div>
          {isEditing && (
            <Button
              variant="secondary"
              onClick={async () => {
                // Clear SMTP for this seed
                await onUpsert({
                  id: form.id,
                  name: form.name,
                  email: form.email,
                  imapHost: form.imapHost,
                  imapPort: form.imapPort,
                  imapSecure: form.imapSecure,
                  imapUser: form.imapUser,
                  password: form.password,
                  isActive: form.isActive,
                  smtpHost: "", // special meaning: clear
                });
                setForm(empty);
              }}
            >
              Clear SMTP
            </Button>
          )}
        </div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2">
          <Input
            placeholder="SMTP Host (smtp.gmail.com / smtp.office365.com)"
            value={form.smtpHost}
            onChange={(e) => setForm({ ...form, smtpHost: e.target.value })}
          />
          <Input placeholder="SMTP User" value={form.smtpUser} onChange={(e) => setForm({ ...form, smtpUser: e.target.value })} />
          <Input
            placeholder={isEditing ? "Leave blank to keep existing" : "SMTP Password / App password"}
            type="password"
            value={form.smtpPassword}
            onChange={(e) => setForm({ ...form, smtpPassword: e.target.value })}
          />
          <div className="flex items-center gap-2">
            <Input
              className="w-24"
              placeholder="Port"
              value={String(form.smtpPort)}
              onChange={(e) => {
                const v = parseInt(e.target.value || "587", 10);
                const next: any = { ...form, smtpPort: v };
                // Auto-normalize common SMTP ports to prevent TLS mismatch errors:
                // - 465 => implicit TLS (secure)
                // - 587 => STARTTLS (not secure)
                if (v === 465) next.smtpSecure = true;
                if (v === 587) next.smtpSecure = false;
                setForm(next);
              }}
            />
            <label className="inline-flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={!!form.smtpSecure} onChange={(e) => setForm({ ...form, smtpSecure: e.target.checked })} />
              TLS (465)
            </label>
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Gmail: smtp.gmail.com (465 TLS or 587 STARTTLS). Outlook: smtp.office365.com:587.
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-[1050px] w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-2">Name</th>
              <th>Email</th>
              <th>Source</th>
              <th>IMAP</th>
              <th>SMTP</th>
              <th>Status</th>
              <th>Last checked</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {seeds.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="py-3 pr-3 font-medium">{s.name}</td>
                <td className="py-3 pr-3">{s.email}</td>
                <td className="py-3 pr-3">{sourcePill(s.source)}</td>
                <td className="py-3 pr-3 text-slate-500">
                  {s.imapHost}:{s.imapPort}
                </td>
                <td className="py-3 pr-3">{s.smtpConfigured ? <Pill tone="green">Configured</Pill> : <Pill tone="gray">—</Pill>}</td>
                <td className="py-3 pr-3">
                  <Pill tone={s.isActive ? "green" : "gray"}>{s.isActive ? "Active" : "Disabled"}</Pill>
                </td>
                <td className="py-3 pr-3 text-slate-500">{s.lastCheckedAt ? new Date(s.lastCheckedAt).toLocaleString() : "—"}</td>
                <td className="py-3 text-right">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setForm({
                          ...empty,
                          id: s.id,
                          name: s.name,
                          email: s.email,
                          imapHost: s.imapHost,
                          imapPort: s.imapPort,
                          imapSecure: s.imapSecure,
                          imapUser: s.imapUser,
                          isActive: s.isActive,
                          smtpHost: s.smtpHost || "",
                          smtpPort: s.smtpPort ?? 587,
                          smtpSecure: !!s.smtpSecure,
                          smtpUser: s.smtpUser || "",
                          password: "",
                          smtpPassword: "",
                        });
                      }}
                    >
                      Edit
                    </Button>
                    <Button variant="secondary" onClick={() => onTest(s.id)}>
                      Test
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        onUpsert({
                          id: s.id,
                          name: s.name,
                          email: s.email,
                          imapHost: s.imapHost,
                          imapPort: s.imapPort,
                          imapSecure: s.imapSecure,
                          imapUser: s.imapUser,
                          isActive: !s.isActive,
                        })
                      }
                    >
                      {s.isActive ? "Disable" : "Enable"}
                    </Button>
                    <Button variant="secondary" onClick={() => onDelete(s.id)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!seeds.length && (
              <tr>
                <td colSpan={8} className="py-6 text-center text-slate-500">
                  No seed inboxes yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function TemplatesCard({
  templates,
  onUpsert,
  onDelete,
  onSeedDefaults,
  onDeleteManual,
  onCleanupManual,
  tab,
  setTab,
}: {
  templates: TemplateRow[];
  onUpsert: (tpl: any) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSeedDefaults: () => Promise<void>;
  onDeleteManual: () => Promise<void>;
  onCleanupManual: () => Promise<void>;
  tab: any;
  setTab: any;
}) {
  const empty = { id: "", type: "initial", name: "", subject: "", text: "", isActive: true };
  const [form, setForm] = useState<any>(empty);
  const isEditing = !!form.id;

  const [ai, setAi] = useState<any>({ type: "initial", count: 6, tone: "friendly, casual, human", language: "English", context: "" });
  const [aiLoading, setAiLoading] = useState(false);
  const [candidates, setCandidates] = useState<AiTemplate[]>([]);

  async function generateAi() {
    setAiLoading(true);
    try {
      const res = await fetch("/api/warmup/templates/ai-generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ai),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Failed");
      setCandidates(Array.isArray(j.templates) ? j.templates : []);
    } catch (e: any) {
      alert(String(e?.message || e));
    } finally {
      setAiLoading(false);
    }
  }

  const counts = useMemo(() => {
    const init = templates.filter((t) => t.type === "initial").length;
    const rep = templates.filter((t) => t.type === "reply").length;
    return { init, rep };
  }, [templates]);

  return (
    <Card
      title="Warmup templates"
      subtitle={`Initial + reply templates used for warmup conversations. (${counts.init} initial, ${counts.rep} reply)`}
      right={
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setTab("profiles")} variant="secondary">
            Profiles
          </Button>
          <Button onClick={() => setTab("seeds")} variant="secondary">
            Seeds
          </Button>
          <Button onClick={() => setTab("templates")} variant={tab === "templates" ? "primary" : "secondary"}>
            Templates
          </Button>
          <Button onClick={onSeedDefaults} variant="secondary">
            Seed defaults
          </Button>
          <Button onClick={onDeleteManual} variant="secondary">
            Delete manual
          </Button>
          <Button onClick={onCleanupManual} variant="secondary">
            Cleanup manual (all)
          </Button>
        </div>
      }
    >
      <div className="rounded-2xl border border-slate-200 p-3">
        <div className="text-sm font-medium">Add / edit template</div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-5 gap-2">
          <select
            className="rounded-xl border border-slate-200 px-2 py-2"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            <option value="initial">initial</option>
            <option value="reply">reply</option>
          </select>
          <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          <label className="inline-flex items-center gap-2 text-sm text-slate-600 px-2">
            <input type="checkbox" checked={!!form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            Active
          </label>
          <div className="flex items-center gap-2">
            <Button
              onClick={async () => {
                const payload = { ...form };
                if (!payload.id) delete payload.id;
                await onUpsert(payload);
                setForm(empty);
              }}
            >
              {isEditing ? "Update" : "Add"}
            </Button>
            {isEditing && (
              <Button variant="secondary" onClick={() => setForm(empty)}>
                Cancel
              </Button>
            )}
          </div>
        </div>
        <div className="mt-2">
          <textarea
            className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
            rows={5}
            placeholder="Template text"
            value={form.text}
            onChange={(e) => setForm({ ...form, text: e.target.value })}
          />
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-medium">AI generator</div>
            <div className="text-xs text-slate-500">Generates realistic warmup templates (requires WARMUP_AI_ENABLED=1).</div>
          </div>
          <Button onClick={generateAi} variant="secondary" disabled={aiLoading}>
            {aiLoading ? "Generating…" : "Generate"}
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-5 gap-2">
          <select className="rounded-xl border border-slate-200 px-2 py-2" value={ai.type} onChange={(e) => setAi({ ...ai, type: e.target.value })}>
            <option value="initial">initial</option>
            <option value="reply">reply</option>
          </select>
          <Input placeholder="Count" value={String(ai.count)} onChange={(e) => setAi({ ...ai, count: parseInt(e.target.value || "6", 10) })} />
          <Input placeholder="Tone (friendly, casual…)" value={ai.tone} onChange={(e) => setAi({ ...ai, tone: e.target.value })} />
          <Input placeholder="Language" value={ai.language} onChange={(e) => setAi({ ...ai, language: e.target.value })} />
          <Input placeholder="Context (optional)" value={ai.context} onChange={(e) => setAi({ ...ai, context: e.target.value })} />
        </div>

        {!!candidates.length && (
          <div className="mt-4 space-y-3">
            {candidates.map((c, idx) => (
              <div key={idx} className="rounded-2xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{c.name || `AI template ${idx + 1}`}</div>
                    <div className="text-sm text-slate-500">{c.subject}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => setForm({ ...form, id: "", type: ai.type, name: c.name || "AI", subject: c.subject || "", text: c.text || "", isActive: true })}
                    >
                      Use in editor
                    </Button>
                    <Button
                      onClick={() => onUpsert({ type: ai.type, name: c.name || "AI", subject: c.subject || "", text: c.text || "", isActive: true })}
                    >
                      Save
                    </Button>
                  </div>
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{c.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {templates.map((t) => (
          <div key={t.id} className="rounded-2xl border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">
                  {t.name} <span className="text-slate-400">({t.type})</span>
                </div>
                <div className="text-sm text-slate-500">{t.subject}</div>
                <div className="mt-2">{sourcePill(t.source)}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() =>
                    setForm({
                      id: t.id,
                      type: t.type,
                      name: t.name,
                      subject: t.subject,
                      text: t.text,
                      isActive: t.isActive,
                    })
                  }
                >
                  Edit
                </Button>
                <Button variant="secondary" onClick={() => onUpsert({ ...t, isActive: !t.isActive })}>
                  {t.isActive ? "Disable" : "Enable"}
                </Button>
                <Button variant="secondary" onClick={() => onDelete(t.id)}>
                  Delete
                </Button>
              </div>
            </div>
            <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{t.text}</div>
          </div>
        ))}
        {!templates.length && <div className="text-sm text-slate-500">No templates yet. Click “Seed defaults”.</div>}
      </div>
    </Card>
  );
}
