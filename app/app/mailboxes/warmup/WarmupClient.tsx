"use client";

import React, { useEffect, useMemo, useState, useRef } from "react";
import { Button, Card, Input, Pill, Select, Kpi, Divider } from "@/components/ui";

type WarmupProfileRow = {
  mailboxId: string;
  mailboxName: string;
  fromEmail: string;
  isActive: boolean;
  warmupEnabled: boolean;
  profile: {
    id: string;
    mode: "internal" | "seeds" | "hybrid";
    startedAt: string;
    updatedAt: string;
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
    targetToday?: number | null;
    tz?: string;
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

type WarmupActivityMessage = {
  id: string;
  direction: "outbound" | "inbound" | string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  sentAt: string | null;
  receivedAt: string | null;
  placement: "inbox" | "spam" | "unknown" | string;
  placementFolder: string | null;
  error: string | null;
  mailbox?: { name: string; fromEmail: string } | null;
  seedInbox?: { name: string; email: string } | null;
};

type WarmupActivityResponse = {
  summary: { sent7d: number; placement7d: { inbox: number; spam: number; unknown: number } };
  byMailbox: { mailboxId: string; mailboxName: string; fromEmail: string; sent7d: number; inbox7d: number; spam7d: number; unknown7d: number }[];
  messages: WarmupActivityMessage[];
};

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
  const [tab, setTab] = useState<"profiles" | "seeds" | "templates" | "activity" | "ramp" | "threads">("profiles");
  const [profiles, setProfiles] = useState<WarmupProfileRow[]>([]);
  const [seeds, setSeeds] = useState<SeedRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Profiles UX
  const [profileQuery, setProfileQuery] = useState<string>("");
  const [profileFilter, setProfileFilter] = useState<string>("");
  const [selectedMailboxIds, setSelectedMailboxIds] = useState<string[]>([]);
  const [bulkWarmupEnabled, setBulkWarmupEnabled] = useState<string>("");
  const [bulkMode, setBulkMode] = useState<string>("");
  const [bulkStartPerDay, setBulkStartPerDay] = useState<string>("");
  const [bulkIncreasePerDay, setBulkIncreasePerDay] = useState<string>("");
  const [bulkMaxPerDay, setBulkMaxPerDay] = useState<string>("");
  const [bulkTimezone, setBulkTimezone] = useState<string>("");
  const [bulkWindowStart, setBulkWindowStart] = useState<string>("");
  const [bulkWindowEnd, setBulkWindowEnd] = useState<string>("");
  const [bulkWeekdaysOnly, setBulkWeekdaysOnly] = useState<string>("");
  const [bulkIsActive, setBulkIsActive] = useState<string>("");
  const [bulkCopyFromMailboxId, setBulkCopyFromMailboxId] = useState<string>("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);

  // Presets (local + built-in) for bulk editing
  const [presetKey, setPresetKey] = useState<string>("");
  const [presetName, setPresetName] = useState<string>("");
  const [customPresets, setCustomPresets] = useState<any[]>([]);


  // Activity (analytics + recent messages)
  const [activity, setActivity] = useState<WarmupActivityResponse | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityMailboxId, setActivityMailboxId] = useState<string>("");
  const [activityPlacement, setActivityPlacement] = useState<string>("");
  const [activityDirection, setActivityDirection] = useState<string>("");
  const [activityQuery, setActivityQuery] = useState<string>("");
  const [recheckLoading, setRecheckLoading] = useState(false);
  const [recheckMsg, setRecheckMsg] = useState<string | null>(null);

  const BUILTIN_PRESETS: { key: string; name: string; patch: any }[] = [
    {
      key: "gmail_safe",
      name: "Gmail safe ramp (recommended)",
      patch: {
        mode: "hybrid",
        startPerDay: 2,
        increasePerDay: 1,
        maxPerDay: 8,
        timezone: "UTC",
        windowStart: "09:00",
        windowEnd: "17:00",
        weekdaysOnly: true,
        isActive: true,
        warmupEnabled: true,
      },
    },
    {
      key: "office_hours",
      name: "Office hours (09:00–17:00 weekdays)",
      patch: { timezone: "UTC", windowStart: "09:00", windowEnd: "17:00", weekdaysOnly: true },
    },
    {
      key: "aggressive",
      name: "Aggressive ramp (use carefully)",
      patch: { startPerDay: 5, increasePerDay: 3, maxPerDay: 20, mode: "hybrid" },
    },
    {
      key: "conservative",
      name: "Conservative ramp (lowest risk)",
      patch: { startPerDay: 1, increasePerDay: 1, maxPerDay: 5, mode: "hybrid" },
    },
    {
      key: "internal_only",
      name: "Internal only (no seeds)",
      patch: { mode: "internal" },
    },
  ];

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("coldmail:warmupPresets");
      if (raw) setCustomPresets(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  function persistCustomPresets(next: any[]) {
    setCustomPresets(next);
    try {
      window.localStorage.setItem("coldmail:warmupPresets", JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  function applyPresetByKey(key: string) {
    const built = BUILTIN_PRESETS.find((p) => p.key === key);
    const custom = customPresets.find((p) => p.key === key);
    const patch = built?.patch || custom?.patch;
    if (!patch) return;

    if (patch.warmupEnabled === true) setBulkWarmupEnabled("on");
    if (patch.warmupEnabled === false) setBulkWarmupEnabled("off");
    if (patch.mode) setBulkMode(String(patch.mode));
    if (patch.startPerDay != null) setBulkStartPerDay(String(patch.startPerDay));
    if (patch.increasePerDay != null) setBulkIncreasePerDay(String(patch.increasePerDay));
    if (patch.maxPerDay != null) setBulkMaxPerDay(String(patch.maxPerDay));
    if (patch.timezone) setBulkTimezone(String(patch.timezone));
    if (patch.windowStart) setBulkWindowStart(String(patch.windowStart));
    if (patch.windowEnd) setBulkWindowEnd(String(patch.windowEnd));
    if (patch.weekdaysOnly != null) setBulkWeekdaysOnly(String(!!patch.weekdaysOnly));
    if (patch.isActive != null) setBulkIsActive(String(!!patch.isActive));

    setMsg(`Preset applied: ${built?.name || custom?.name || key}`);
  }

  function buildPresetPatchFromBulkForm() {
    const patch: any = {};
    if (bulkWarmupEnabled === "on") patch.warmupEnabled = true;
    if (bulkWarmupEnabled === "off") patch.warmupEnabled = false;
    if (bulkMode) patch.mode = bulkMode;
    if (bulkStartPerDay) patch.startPerDay = parseInt(bulkStartPerDay, 10);
    if (bulkIncreasePerDay) patch.increasePerDay = parseInt(bulkIncreasePerDay, 10);
    if (bulkMaxPerDay) patch.maxPerDay = parseInt(bulkMaxPerDay, 10);
    if (bulkTimezone) patch.timezone = bulkTimezone;
    if (bulkWindowStart) patch.windowStart = bulkWindowStart;
    if (bulkWindowEnd) patch.windowEnd = bulkWindowEnd;
    if (bulkWeekdaysOnly) patch.weekdaysOnly = bulkWeekdaysOnly === "true";
    if (bulkIsActive) patch.isActive = bulkIsActive === "true";
    return patch;
  }

  function saveCurrentAsPreset() {
    const name = presetName.trim();
    if (!name) {
      setMsg("Preset name is required.");
      return;
    }
    const patch = buildPresetPatchFromBulkForm();
    if (!Object.keys(patch).length) {
      setMsg("Nothing to save yet — set some bulk fields first.");
      return;
    }

    const key = `custom_${Date.now()}`;
    const next = [{ key, name, patch }, ...customPresets].slice(0, 50);
    persistCustomPresets(next);
    setPresetKey(key);
    setPresetName("");
    setMsg(`Saved preset: ${name}`);
  }

  function deleteSelectedPreset() {
    const key = presetKey;
    if (!key || !key.startsWith("custom_")) return;
    const cur = customPresets.find((p) => p.key === key);
    if (!cur) return;
    if (!confirm(`Delete preset “${cur.name}”?`)) return;
    const next = customPresets.filter((p) => p.key !== key);
    persistCustomPresets(next);
    setPresetKey("");
    setMsg(`Deleted preset: ${cur.name}`);
  }

  // Ramp calendar
  const [rampDays, setRampDays] = useState<number>(14);
  const [rampData, setRampData] = useState<any>(null);
  const [rampLoading, setRampLoading] = useState(false);

  // Thread viewer
  const [threads, setThreads] = useState<any[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsMailboxId, setThreadsMailboxId] = useState<string>("");
  const [threadsQuery, setThreadsQuery] = useState<string>("");
  const [selectedThreadId, setSelectedThreadId] = useState<string>("");
  const [selectedThread, setSelectedThread] = useState<any>(null);
  const [threadLoading, setThreadLoading] = useState(false);

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

  async function loadActivity() {
    setMsg(null);
    setActivityLoading(true);
    try {
      const params = new URLSearchParams();
      if (activityMailboxId) params.set("mailboxId", activityMailboxId);
      if (activityPlacement) params.set("placement", activityPlacement);
      if (activityDirection) params.set("direction", activityDirection);
      if (activityQuery.trim()) params.set("q", activityQuery.trim());
      params.set("take", "120");

      const res = await fetch(`/api/warmup/activity?${params.toString()}`);
      const j = await res.json();
      if (!res.ok) setMsg(j?.error || "Failed");
      else setActivity(j as any);
    } catch (e: any) {
      setMsg(String(e?.message || e));
    } finally {
      setActivityLoading(false);
    }
  }

  async function recheckPlacementNow() {
    setMsg(null);
    setRecheckMsg(null);
    setRecheckLoading(true);
    try {
      const body: any = {};
      if (activityMailboxId) body.mailboxId = activityMailboxId;
      const res = await fetch("/api/warmup/recheck-placement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(j?.error || "Failed to enqueue placement check");
      } else {
        setRecheckMsg(
          activityMailboxId
            ? "Re-check queued for this mailbox. Placement will update shortly."
            : "Re-check queued for all mailboxes. Placement will update shortly."
        );
        // Optimistically refresh after a short delay
        setTimeout(() => loadActivity(), 2000);
      }
    } catch (e: any) {
      setMsg(String(e?.message || e));
    } finally {
      setRecheckLoading(false);
    }
  }

  useEffect(() => {
    if (tab !== "activity") return;
    const t = setTimeout(() => loadActivity(), 250);
    return () => clearTimeout(t);
  }, [tab, activityMailboxId, activityPlacement, activityDirection, activityQuery]);

  async function loadRamp() {
    setRampLoading(true);
    try {
      const res = await fetch(`/api/warmup/ramp?days=${rampDays}`);
      const j = await res.json();
      if (!res.ok) setMsg(j?.error || "Failed");
      else setRampData(j);
    } catch (e: any) {
      setMsg(String(e?.message || e));
    } finally {
      setRampLoading(false);
    }
  }

  useEffect(() => {
    if (tab !== "ramp") return;
    const t = setTimeout(() => loadRamp(), 200);
    return () => clearTimeout(t);
  }, [tab, rampDays]);

  async function loadThreads() {
    setThreadsLoading(true);
    try {
      const params = new URLSearchParams();
      if (threadsMailboxId) params.set("mailboxId", threadsMailboxId);
      if (threadsQuery.trim()) params.set("q", threadsQuery.trim());
      params.set("take", "120");

      const res = await fetch(`/api/warmup/threads/list?${params.toString()}`);
      const j = await res.json();
      if (!res.ok) setMsg(j?.error || "Failed");
      else setThreads(j?.threads || []);
    } catch (e: any) {
      setMsg(String(e?.message || e));
    } finally {
      setThreadsLoading(false);
    }
  }

  async function openThread(id: string) {
    setSelectedThreadId(id);
    setThreadLoading(true);
    try {
      const res = await fetch(`/api/warmup/threads/get?id=${encodeURIComponent(id)}`);
      const j = await res.json();
      if (!res.ok) setMsg(j?.error || "Failed");
      else setSelectedThread(j?.thread);
    } catch (e: any) {
      setMsg(String(e?.message || e));
    } finally {
      setThreadLoading(false);
    }
  }

  useEffect(() => {
    if (tab !== "threads") return;
    const t = setTimeout(() => loadThreads(), 200);
    return () => clearTimeout(t);
  }, [tab, threadsMailboxId, threadsQuery]);

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

  const filteredProfiles = useMemo(() => {
    const q = profileQuery.trim().toLowerCase();
    return (profiles || []).filter((r) => {
      if (profileFilter === "enabled" && !r.warmupEnabled) return false;
      if (profileFilter === "disabled" && r.warmupEnabled) return false;
      if (!q) return true;
      return (r.mailboxName || "").toLowerCase().includes(q) || (r.fromEmail || "").toLowerCase().includes(q);
    });
  }, [profiles, profileQuery, profileFilter]);

  // prune stale selections when mailboxes refresh
  useEffect(() => {
    setSelectedMailboxIds((prev) => prev.filter((id) => (profiles || []).some((p) => p.mailboxId === id)));
  }, [profiles]);

  const selectedSet = useMemo(() => new Set(selectedMailboxIds), [selectedMailboxIds]);
  const allFilteredSelected = filteredProfiles.length > 0 && filteredProfiles.every((r) => selectedSet.has(r.mailboxId));
  const someFilteredSelected = filteredProfiles.some((r) => selectedSet.has(r.mailboxId));

  useEffect(() => {
    if (!headerCheckboxRef.current) return;
    headerCheckboxRef.current.indeterminate = !allFilteredSelected && someFilteredSelected;
  }, [allFilteredSelected, someFilteredSelected]);

  function toggleSelect(mailboxId: string, checked: boolean) {
    setSelectedMailboxIds((prev) => {
      const set = new Set(prev);
      if (checked) set.add(mailboxId);
      else set.delete(mailboxId);
      return Array.from(set);
    });
  }

  function selectAllFiltered() {
    setSelectedMailboxIds((prev) => {
      const set = new Set(prev);
      filteredProfiles.forEach((r) => set.add(r.mailboxId));
      return Array.from(set);
    });
  }

  function clearSelection() {
    setSelectedMailboxIds([]);
  }

  async function bulkUpdate(payload: any) {
    setBulkSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/warmup/profiles/bulk-update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) setMsg(j?.error || "Bulk update failed");
      else setMsg(`Updated ${j?.updated || payload.mailboxIds?.length || 0} profile(s).`);
    } catch (e: any) {
      setMsg(String(e?.message || e));
    } finally {
      setBulkSaving(false);
      await loadAll();
    }
  }

  async function applyBulkForm() {
    if (!selectedMailboxIds.length) return;
    const profilePatch: any = {};
    if (bulkMode) profilePatch.mode = bulkMode;
    if (bulkStartPerDay.trim() !== "") profilePatch.startPerDay = Number(bulkStartPerDay);
    if (bulkIncreasePerDay.trim() !== "") profilePatch.increasePerDay = Number(bulkIncreasePerDay);
    if (bulkMaxPerDay.trim() !== "") profilePatch.maxPerDay = Number(bulkMaxPerDay);
    if (bulkTimezone.trim() !== "") profilePatch.timezone = bulkTimezone.trim();
    if (bulkWindowStart.trim() !== "") profilePatch.windowStartMin = hhmmToMins(bulkWindowStart.trim());
    if (bulkWindowEnd.trim() !== "") profilePatch.windowEndMin = hhmmToMins(bulkWindowEnd.trim());
    if (bulkWeekdaysOnly) profilePatch.weekdaysOnly = bulkWeekdaysOnly;
    if (bulkIsActive) profilePatch.isActive = bulkIsActive;

    const payload: any = { mailboxIds: selectedMailboxIds };
    if (bulkWarmupEnabled === "on") payload.warmupEnabled = true;
    if (bulkWarmupEnabled === "off") payload.warmupEnabled = false;
    if (bulkCopyFromMailboxId) payload.copyFromMailboxId = bulkCopyFromMailboxId;
    if (Object.keys(profilePatch).length) payload.profilePatch = profilePatch;

    await bulkUpdate(payload);
  }

  async function bulkEnable() {
    if (!selectedMailboxIds.length) return;
    await bulkUpdate({ mailboxIds: selectedMailboxIds, warmupEnabled: true });
  }

  async function bulkDisable() {
    if (!selectedMailboxIds.length) return;
    await bulkUpdate({ mailboxIds: selectedMailboxIds, warmupEnabled: false });
  }

  async function bulkRunNow() {
    if (!selectedMailboxIds.length) return;
    setMsg(null);
    try {
      // one request per mailbox to keep behavior identical
      for (const id of selectedMailboxIds) {
        await fetch("/api/warmup/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mailboxId: id }),
        });
      }
      setMsg(`Warmup jobs enqueued for ${selectedMailboxIds.length} mailbox(es).`);
    } catch (e: any) {
      setMsg(String(e?.message || e));
    } finally {
      await loadAll();
    }
  }

  async function bulkRecheckPlacement() {
    if (!selectedMailboxIds.length) return;
    setMsg(null);
    setBulkSaving(true);
    try {
      const res = await fetch("/api/warmup/recheck-placement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mailboxIds: selectedMailboxIds }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(j?.error || "Failed to enqueue placement checks");
      else setMsg(`Placement re-check queued for ${selectedMailboxIds.length} mailbox(es).`);
    } catch (e: any) {
      setMsg(String(e?.message || e));
    } finally {
      setBulkSaving(false);
      // Placement updates asynchronously; keep UI responsive
      await loadAll();
    }
  }

  async function recheckPlacementForMailbox(mailboxId: string) {
    setMsg(null);
    try {
      const res = await fetch("/api/warmup/recheck-placement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mailboxId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(j?.error || "Failed to enqueue placement check");
      else setMsg("Placement re-check queued. It will update shortly.");
    } catch (e: any) {
      setMsg(String(e?.message || e));
    }
  }

  async function recheckPlacementForWorkspace() {
    setMsg(null);
    try {
      const res = await fetch("/api/warmup/recheck-placement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(j?.error || "Failed to enqueue placement check");
      else setMsg("Placement re-check queued for all warmup mailboxes. It will update shortly.");
    } catch (e: any) {
      setMsg(String(e?.message || e));
    }
  }

  async function bulkHealthcheck() {
    if (!selectedMailboxIds.length) return;
    setMsg(null);
    try {
      for (const id of selectedMailboxIds) {
        await queueMailboxHealthcheck(id, "both");
      }
      setMsg(`Healthchecks queued for ${selectedMailboxIds.length} mailbox(es).`);
    } catch (e: any) {
      setMsg(String(e?.message || e));
    }
  }

  async function bulkDeleteProfiles() {
    if (!selectedMailboxIds.length) return;
    if (!confirm(`Disable warmup and delete warmup profiles for ${selectedMailboxIds.length} mailbox(es)?`)) return;
    setMsg(null);
    setBulkSaving(true);
    try {
      const res = await fetch("/api/warmup/profiles/bulk-delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mailboxIds: selectedMailboxIds }),
      });
      const j = await res.json();
      if (!res.ok) setMsg(j?.error || "Bulk delete failed");
      else setMsg(`Deleted ${j?.deleted || 0} profile(s).`);
    } catch (e: any) {
      setMsg(String(e?.message || e));
    } finally {
      setBulkSaving(false);
      clearSelection();
      await loadAll();
    }
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
          <Button onClick={() => recheckPlacementForWorkspace()} variant="secondary">
            Re-check placement
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
        <Button onClick={() => setTab("activity")} variant={tab === "activity" ? "primary" : "secondary"}>
          Activity
        </Button>
        <Button onClick={() => setTab("ramp")} variant={tab === "ramp" ? "primary" : "secondary"}>
          Ramp
        </Button>
        <Button onClick={() => setTab("threads")} variant={tab === "threads" ? "primary" : "secondary"}>
          Threads
        </Button>
      </div>


      <div className="mb-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <Input className="w-72" placeholder="Search mailboxes…" value={profileQuery} onChange={(e) => setProfileQuery(e.target.value)} />
            <Select className="w-44" value={profileFilter} onChange={(e) => setProfileFilter(e.target.value)}>
              <option value="">All</option>
              <option value="enabled">Warmup enabled</option>
              <option value="disabled">Warmup disabled</option>
            </Select>
            {selectedMailboxIds.length ? (
              <Pill tone="info">{selectedMailboxIds.length} selected</Pill>
            ) : (
              <Pill tone="gray">{filteredProfiles.length} mailbox(es)</Pill>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => (selectedMailboxIds.length ? clearSelection() : selectAllFiltered())}>
              {selectedMailboxIds.length ? "Clear selection" : "Select all"}
            </Button>
            <Button variant="secondary" onClick={() => loadAll()} disabled={loading}>Refresh</Button>
          </div>
        </div>

        {selectedMailboxIds.length ? (
          <div className="glass p-3 sm:p-4 ring-1 ring-indigo-200/50">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">Bulk actions</div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={bulkEnable} disabled={bulkSaving}>Enable warmup</Button>
                <Button variant="secondary" onClick={bulkDisable} disabled={bulkSaving}>Disable warmup</Button>
                <Button variant="secondary" onClick={bulkRecheckPlacement} disabled={bulkSaving}>Re-check placement</Button>
                <Button variant="secondary" onClick={bulkHealthcheck} disabled={bulkSaving}>Check SMTP/IMAP</Button>
                <Button variant="secondary" onClick={bulkRunNow} disabled={bulkSaving}>Run now</Button>
                <Button variant="danger" onClick={bulkDeleteProfiles} disabled={bulkSaving}>Delete profiles</Button>
              </div>
            </div>

            <Divider className="my-3" />

            <div className="flex flex-col lg:flex-row lg:items-end gap-2 mb-3">
              <div className="min-w-[240px]">
                <div className="text-xs text-slate-500 mb-1">Presets</div>
                <Select
                  value={presetKey}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPresetKey(v);
                    if (v) applyPresetByKey(v);
                  }}
                >
                  <option value="">(optional)</option>
                  <optgroup label="Built-in">
                    {BUILTIN_PRESETS.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                  {customPresets.length ? (
                    <optgroup label="Saved">
                      {customPresets.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </Select>
              </div>

              <div className="flex-1">
                <div className="text-xs text-slate-500 mb-1">Save current bulk settings as preset</div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input className="w-64" placeholder="Preset name" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
                  <Button variant="secondary" onClick={saveCurrentAsPreset} disabled={bulkSaving}>Save preset</Button>
                  <Button variant="secondary" onClick={deleteSelectedPreset} disabled={bulkSaving || !presetKey.startsWith("custom_")}>Delete preset</Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
              <div className="lg:col-span-2">
                <div className="text-xs text-slate-500 mb-1">Warmup</div>
                <Select value={bulkWarmupEnabled} onChange={(e) => setBulkWarmupEnabled(e.target.value)}>
                  <option value="">No change</option>
                  <option value="on">Enable</option>
                  <option value="off">Disable</option>
                </Select>
              </div>
              <div className="lg:col-span-2">
                <div className="text-xs text-slate-500 mb-1">Mode</div>
                <Select value={bulkMode} onChange={(e) => setBulkMode(e.target.value)}>
                  <option value="">No change</option>
                  <option value="hybrid">hybrid</option>
                  <option value="internal">internal</option>
                  <option value="seeds">seeds</option>
                </Select>
              </div>
              <div className="lg:col-span-3">
                <div className="text-xs text-slate-500 mb-1">Ramp</div>
                <div className="flex items-center gap-2">
                  <Input className="w-16" placeholder="start" value={bulkStartPerDay} onChange={(e) => setBulkStartPerDay(e.target.value)} />
                  <span className="text-slate-400">+</span>
                  <Input className="w-16" placeholder="inc" value={bulkIncreasePerDay} onChange={(e) => setBulkIncreasePerDay(e.target.value)} />
                  <span className="text-slate-400">max</span>
                  <Input className="w-16" placeholder="max" value={bulkMaxPerDay} onChange={(e) => setBulkMaxPerDay(e.target.value)} />
                </div>
              </div>
              <div className="lg:col-span-3">
                <div className="text-xs text-slate-500 mb-1">Window</div>
                <div className="flex items-center gap-2">
                  <Input className="w-24" placeholder="TZ (UTC)" value={bulkTimezone} onChange={(e) => setBulkTimezone(e.target.value)} />
                  <Input className="w-20" placeholder="09:00" value={bulkWindowStart} onChange={(e) => setBulkWindowStart(e.target.value)} />
                  <span className="text-slate-400">-</span>
                  <Input className="w-20" placeholder="17:00" value={bulkWindowEnd} onChange={(e) => setBulkWindowEnd(e.target.value)} />
                </div>
              </div>
              <div className="lg:col-span-2">
                <div className="text-xs text-slate-500 mb-1">Weekdays only</div>
                <Select value={bulkWeekdaysOnly} onChange={(e) => setBulkWeekdaysOnly(e.target.value)}>
                  <option value="">No change</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </Select>
              </div>
              <div className="lg:col-span-2">
                <div className="text-xs text-slate-500 mb-1">Profile active</div>
                <Select value={bulkIsActive} onChange={(e) => setBulkIsActive(e.target.value)}>
                  <option value="">No change</option>
                  <option value="true">Active</option>
                  <option value="false">Paused</option>
                </Select>
              </div>
              <div className="lg:col-span-3">
                <div className="text-xs text-slate-500 mb-1">Copy settings from</div>
                <Select value={bulkCopyFromMailboxId} onChange={(e) => setBulkCopyFromMailboxId(e.target.value)}>
                  <option value="">(optional)</option>
                  {profiles.map((p) => (
                    <option key={p.mailboxId} value={p.mailboxId}>
                      {p.mailboxName} ({p.fromEmail})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="lg:col-span-2 flex items-end">
                <Button onClick={applyBulkForm} disabled={bulkSaving}>
                  {bulkSaving ? "Applying…" : "Apply changes"}
                </Button>
              </div>
            </div>
            <div className="mt-2 text-xs text-slate-500">Tip: Use “Copy settings from” to clone a known-good warmup config to many mailboxes in one click.</div>
          </div>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[1250px] w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-2 w-10"><input ref={headerCheckboxRef} type="checkbox" checked={allFilteredSelected} onChange={(e) => (e.target.checked ? selectAllFiltered() : clearSelection())} /></th>
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
            {filteredProfiles.map((r) => {
              const p = r.profile;
              const placementTotal = r.stats.inbox7d + r.stats.spam7d + r.stats.unknown7d;
              const inboxRate = placementTotal ? Math.round((r.stats.inbox7d / placementTotal) * 100) : 0;
              return (
                <tr key={r.mailboxId} className="border-t border-slate-100 align-top hover:bg-white/30">
                  <td className="py-3 pr-3 w-10">
                    <input type="checkbox" checked={selectedSet.has(r.mailboxId)} onChange={(e) => toggleSelect(r.mailboxId, e.target.checked)} />
                  </td>
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
                    <div className="font-semibold">
                      {r.stats.sentToday}{typeof r.stats.targetToday === "number" ? ` / ${r.stats.targetToday}` : ""}
                    </div>
                    {typeof r.stats.targetToday === "number" && r.stats.targetToday > 0 && (
                      <div className="mt-1 h-2 w-32 rounded bg-slate-200">
                        <div
                          className="h-2 rounded bg-slate-900"
                          style={{ width: `${Math.min(100, Math.round((r.stats.sentToday / r.stats.targetToday) * 100))}%` }}
                        />
                      </div>
                    )}
                    <div className="mt-1 text-xs text-slate-500">
                      {r.stats.tz ? `Local day (${r.stats.tz})` : "Local day"}
                      {r.stats.lastPlacementAt ? ` · Last: ${new Date(r.stats.lastPlacementAt).toLocaleString()}` : ""}
                    </div>
                  </td>
                  <td className="py-3 text-right">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setBulkCopyFromMailboxId(r.mailboxId);
                          if (!selectedSet.has(r.mailboxId)) {
                            toggleSelect(r.mailboxId, true);
                          }
                          setMsg("Copied as template — now select other mailboxes and click Apply changes.");
                        }}
                      >
                        Copy profile
                      </Button>
                      <Button variant="secondary" onClick={() => recheckPlacementForMailbox(r.mailboxId)}>
                        Re-check placement
                      </Button>
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
            {!filteredProfiles.length && (
              <tr>
                <td colSpan={9} className="py-6 text-center text-slate-500">
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

  const activityView = (
    <Card
      title="Warmup activity"
      subtitle="Live analytics from warmup messages (last 7d) + recent message log."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setTab("profiles")} variant="secondary">Profiles</Button>
          <Button onClick={() => setTab("seeds")} variant="secondary">Seeds</Button>
          <Button onClick={() => setTab("templates")} variant="secondary">Templates</Button>
          <Button onClick={() => setTab("activity")} variant={tab === "activity" ? "primary" : "secondary"}>Activity</Button>
          <Button onClick={() => setTab("ramp")} variant="secondary">Ramp</Button>
          <Button onClick={() => setTab("threads")} variant="secondary">Threads</Button>
          <Button onClick={() => recheckPlacementNow()} variant="secondary" disabled={recheckLoading}>
            {recheckLoading ? "Re-checking…" : "Re-check placement"}
          </Button>
          <Button onClick={() => loadActivity()} variant="secondary" disabled={activityLoading}>Refresh</Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-2">
        <Select value={activityMailboxId} onChange={(e) => setActivityMailboxId(e.target.value)}>
          <option value="">All mailboxes</option>
          {profiles.map((p) => (
            <option key={p.mailboxId} value={p.mailboxId}>
              {p.mailboxName} ({p.fromEmail})
            </option>
          ))}
        </Select>
        <Select value={activityPlacement} onChange={(e) => setActivityPlacement(e.target.value)}>
          <option value="">Any placement</option>
          <option value="inbox">Inbox</option>
          <option value="spam">Spam</option>
          <option value="unknown">Unknown</option>
        </Select>
        <Select value={activityDirection} onChange={(e) => setActivityDirection(e.target.value)}>
          <option value="">Any direction</option>
          <option value="outbound">Outbound</option>
          <option value="inbound">Inbound</option>
        </Select>
        <Input placeholder="Search subject/email/folder" value={activityQuery} onChange={(e) => setActivityQuery(e.target.value)} />
      </div>

      <div className="mt-2 text-xs text-slate-500">
        Placement is detected by checking mailbox folders (Inbox + Spam/Junk). After sending warmup, it may take 1–2 minutes for placement to update.
      </div>

      {recheckMsg && <div className="mt-2 text-xs text-emerald-700">{recheckMsg}</div>}

      <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <Kpi label="Sent (7d)" value={activity?.summary?.sent7d ?? "—"} />
        <Kpi
          label="Inbox (7d)"
          value={activity ? activity.summary.placement7d.inbox : "—"}
          hint={activity ? `${Math.round((activity.summary.placement7d.inbox / Math.max(1, (activity.summary.placement7d.inbox + activity.summary.placement7d.spam + activity.summary.placement7d.unknown))) * 100)}%` : undefined}
          tone="success"
        />
        <Kpi
          label="Spam (7d)"
          value={activity ? activity.summary.placement7d.spam : "—"}
          hint={activity ? `${Math.round((activity.summary.placement7d.spam / Math.max(1, (activity.summary.placement7d.inbox + activity.summary.placement7d.spam + activity.summary.placement7d.unknown))) * 100)}%` : undefined}
          tone="danger"
        />
        <Kpi label="Unknown (7d)" value={activity ? activity.summary.placement7d.unknown : "—"} tone="warning" />
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <div className="font-medium">By mailbox (7d)</div>
          {activityLoading && <div className="text-xs text-slate-400">Refreshing…</div>}
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-[900px] w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-2">Mailbox</th>
                <th>Sent</th>
                <th>Inbox</th>
                <th>Spam</th>
                <th>Unknown</th>
                <th>Inbox rate</th>
              </tr>
            </thead>
            <tbody>
              {(activity?.byMailbox || []).map((r) => {
                const total = r.inbox7d + r.spam7d + r.unknown7d;
                const rate = total ? Math.round((r.inbox7d / total) * 100) : 0;
                return (
                  <tr key={r.mailboxId} className="border-t border-slate-100">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{r.mailboxName}</div>
                      <div className="text-xs text-slate-500">{r.fromEmail}</div>
                    </td>
                    <td className="py-2">{r.sent7d}</td>
                    <td className="py-2"><Pill tone="green">{r.inbox7d}</Pill></td>
                    <td className="py-2"><Pill tone="red">{r.spam7d}</Pill></td>
                    <td className="py-2"><Pill tone="amber">{r.unknown7d}</Pill></td>
                    <td className="py-2">{rate}%</td>
                  </tr>
                );
              })}
              {!activity?.byMailbox?.length && (
                <tr>
                  <td className="py-3 text-slate-500" colSpan={6}>
                    No warmup activity yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Divider className="my-6" />

      <div>
        <div className="font-medium">Recent warmup messages (14d)</div>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-[1100px] w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-2">When</th>
                <th>Mailbox</th>
                <th>To</th>
                <th>Subject</th>
                <th>Direction</th>
                <th>Placement</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {(activity?.messages || []).map((m) => {
                const when = m.receivedAt || m.sentAt;
                const dt = when ? new Date(when).toLocaleString() : "—";
                const placeTone = m.placement === "inbox" ? "green" : m.placement === "spam" ? "red" : "amber";
                return (
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="py-2 pr-3 whitespace-nowrap text-xs text-slate-600">{dt}</td>
                    <td className="py-2 pr-3">
                      <div className="font-medium">{m.mailbox?.name || "—"}</div>
                      <div className="text-xs text-slate-500">{m.mailbox?.fromEmail || m.fromEmail}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="text-slate-700">{m.seedInbox?.email || m.toEmail}</div>
                      {m.seedInbox?.name ? <div className="text-xs text-slate-500">{m.seedInbox.name}</div> : null}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="max-w-[420px] truncate" title={m.subject}>{m.subject}</div>
                    </td>
                    <td className="py-2 pr-3"><Pill tone={m.direction === "outbound" ? "gray" : "info"}>{m.direction}</Pill></td>
                    <td className="py-2 pr-3"><Pill tone={placeTone as any}>{m.placement}</Pill></td>
                    <td className="py-2 pr-3">
                      {m.error ? <span className="text-xs text-red-600">{m.error}</span> : <span className="text-xs text-slate-400">—</span>}
                    </td>
                  </tr>
                );
              })}
              {!activity?.messages?.length && (
                <tr>
                  <td className="py-3 text-slate-500" colSpan={7}>
                    No messages yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );

  const rampHeaderDays = useMemo(() => {
    // Backend returns { days: number, byMailbox: [...] }.
    // Older UI expected `days` to be an array; normalize so header rendering is always safe.
    if (!rampData) return [];
    if (Array.isArray((rampData as any).days)) return (rampData as any).days;
    const firstSchedule = (rampData as any)?.byMailbox?.[0]?.schedule;
    return Array.isArray(firstSchedule) ? firstSchedule : [];
  }, [rampData]);


  const rampView = (
    <Card
      title="Warmup ramp calendar"
      subtitle="Projected daily warmup volume based on each mailbox's ramp plan (uses WarmupProfile.startedAt + weekdays-only rules)."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setTab("profiles")} variant="secondary">Profiles</Button>
          <Button onClick={() => setTab("seeds")} variant="secondary">Seeds</Button>
          <Button onClick={() => setTab("templates")} variant="secondary">Templates</Button>
          <Button onClick={() => setTab("activity")} variant="secondary">Activity</Button>
          <Button onClick={() => setTab("ramp")} variant={tab === "ramp" ? "primary" : "secondary"}>Ramp</Button>
          <Button onClick={() => setTab("threads")} variant="secondary">Threads</Button>
          <Select value={String(rampDays)} onChange={(e) => setRampDays(parseInt(e.target.value, 10) || 14)}>
            <option value="14">14 days</option>
            <option value="21">21 days</option>
            <option value="30">30 days</option>
          </Select>
          <Button onClick={() => loadRamp()} variant="secondary" disabled={rampLoading}>Refresh</Button>
        </div>
      }
    >
      <div className="text-xs text-slate-500">Tip: if a mailbox is "weekdays only", Saturdays/Sundays will show 0 in the plan.</div>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-[1100px] w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-2 w-10"><input ref={headerCheckboxRef} type="checkbox" checked={allFilteredSelected} onChange={(e) => (e.target.checked ? selectAllFiltered() : clearSelection())} /></th>
              <th className="py-2">Mailbox</th>
              {(rampHeaderDays || []).map((d: any) => (
                <th key={d.date} className="py-2 whitespace-nowrap">{d.date.slice(5)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(rampData?.byMailbox || []).map((r: any) => (
              <tr key={r.mailboxId} className="border-t border-slate-100 align-top hover:bg-white/30">
                <td className="py-2 pr-3 w-10">
                  <input type="checkbox" checked={selectedSet.has(r.mailboxId)} onChange={(e) => toggleSelect(r.mailboxId, e.target.checked)} />
                </td>
                <td className="py-2 pr-3">
                  <div className="font-medium">{r.mailboxName}</div>
                  <div className="text-xs text-slate-500">{r.fromEmail}</div>
                  <div className="text-xs text-slate-500">Start: {r.startPerDay} → +{r.increasePerDay}/day, cap {r.maxPerDay}{r.weekdaysOnly ? " (weekdays)" : ""}</div>
                </td>
                {(r.schedule || []).map((s: any) => (
                  <td key={s.date} className="py-2">
                    <Pill tone={s.target === r.maxPerDay ? "green" : s.target === 0 ? "gray" : "info"}>{s.target}</Pill>
                  </td>
                ))}
              </tr>
            ))}
            {!rampData?.byMailbox?.length && (
              <tr>
                <td colSpan={rampHeaderDays.length + 2} className="py-6 text-center text-slate-500">
                  No warmup profiles enabled yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rampLoading && <div className="mt-3 text-xs text-slate-400">Refreshing…</div>}
    </Card>
  );

  const threadsView = (
    <Card
      title="Warmup threads"
      subtitle="Browse warmup conversations (internal + seed). Useful for debugging replies, placement and errors."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setTab("profiles")} variant="secondary">Profiles</Button>
          <Button onClick={() => setTab("seeds")} variant="secondary">Seeds</Button>
          <Button onClick={() => setTab("templates")} variant="secondary">Templates</Button>
          <Button onClick={() => setTab("activity")} variant="secondary">Activity</Button>
          <Button onClick={() => setTab("ramp")} variant="secondary">Ramp</Button>
          <Button onClick={() => setTab("threads")} variant={tab === "threads" ? "primary" : "secondary"}>Threads</Button>
          <Button onClick={() => loadThreads()} variant="secondary" disabled={threadsLoading}>Refresh</Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Select value={threadsMailboxId} onChange={(e) => setThreadsMailboxId(e.target.value)}>
          <option value="">All mailboxes</option>
          {profiles.map((p) => (
            <option key={p.mailboxId} value={p.mailboxId}>
              {p.mailboxName} ({p.fromEmail})
            </option>
          ))}
        </Select>
        <Input placeholder="Search subject / email" value={threadsQuery} onChange={(e) => setThreadsQuery(e.target.value)} />
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-[1100px] w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-2">Last activity</th>
              <th>From</th>
              <th>To</th>
              <th>Subject</th>
              <th>Msgs</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {threads.map((t: any) => (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="py-2 pr-3 whitespace-nowrap text-xs text-slate-600">{t.lastActivityAt ? new Date(t.lastActivityAt).toLocaleString() : "—"}</td>
                <td className="py-2 pr-3">
                  <div className="font-medium">{t.fromMailbox?.name || "—"}</div>
                  <div className="text-xs text-slate-500">{t.fromMailbox?.fromEmail || ""}</div>
                </td>
                <td className="py-2 pr-3">
                  {t.toMailbox ? (
                    <>
                      <div className="font-medium">{t.toMailbox.name}</div>
                      <div className="text-xs text-slate-500">{t.toMailbox.fromEmail}</div>
                    </>
                  ) : t.toSeedInbox ? (
                    <>
                      <div className="font-medium">{t.toSeedInbox.name}</div>
                      <div className="text-xs text-slate-500">{t.toSeedInbox.email}</div>
                    </>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <div className="max-w-[520px] truncate" title={t.subject}>{t.subject}</div>
                  <div className="text-xs text-slate-500">{t.status}</div>
                </td>
                <td className="py-2 pr-3">{t.messageCount}</td>
                <td className="py-2 text-right">
                  <Button variant="secondary" onClick={() => openThread(t.id)} disabled={threadLoading && selectedThreadId === t.id}>
                    Open
                  </Button>
                </td>
              </tr>
            ))}
            {!threads.length && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-500">No threads found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {threadsLoading && <div className="mt-3 text-xs text-slate-400">Refreshing…</div>}

      {selectedThread && (
        <div className="mt-6 rounded-2xl border border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Thread detail</div>
              <div className="mt-1 text-xs text-slate-500">{selectedThread.subject}</div>
            </div>
            <Button variant="secondary" onClick={() => { setSelectedThread(null); setSelectedThreadId(""); }}>Close</Button>
          </div>
          <div className="mt-3 space-y-3">
            {(selectedThread.messages || []).map((m: any) => {
              const when = m.receivedAt || m.sentAt || m.createdAt;
              const dt = when ? new Date(when).toLocaleString() : "—";
              const tone = m.placement === "inbox" ? "green" : m.placement === "spam" ? "red" : "amber";
              return (
                <div key={m.id} className="rounded-2xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs text-slate-500">{dt}</div>
                    <div className="flex items-center gap-2">
                      <Pill tone={m.direction === "outbound" ? "gray" : "info"}>{m.direction}</Pill>
                      <Pill tone={tone as any}>{m.placement}</Pill>
                      {m.error ? <Pill tone="red">Error</Pill> : null}
                      {m.rescuedToInboxAt ? <Pill tone="green">Rescued</Pill> : null}
                      {m.starredAt ? <Pill tone="amber">Starred</Pill> : null}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">From: {m.fromEmail} → To: {m.toEmail}</div>
                  <div className="mt-2 font-medium">{m.subject}</div>
                  <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{(m.text || "").slice(0, 5000)}</div>
                  {m.error ? <div className="mt-2 text-xs text-red-600">{m.error}</div> : null}
                </div>
              );
            })}
            {!selectedThread.messages?.length && <div className="text-sm text-slate-500">No messages in this thread yet.</div>}
          </div>
        </div>
      )}
    </Card>
  );

  return (
    <div className="space-y-4">
      {msg && <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm">{msg}</div>}
      {tab === "profiles" && profilesView}
      {tab === "seeds" && seedsView}
      {tab === "templates" && templatesView}
      {tab === "activity" && activityView}
      {tab === "ramp" && rampView}
      {tab === "threads" && threadsView}
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

  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkDone, setBulkDone] = useState(0);
  const [bulkTotal, setBulkTotal] = useState(0);
  const [bulkResults, setBulkResults] = useState<Record<string, any>>({});

  const smtpConfiguredCount = useMemo(
    () => seeds.filter((s) => s.isActive && !!(s.smtpHost && s.smtpPort && s.smtpUser)).length,
    [seeds]
  );

  async function bulkTestActive() {
    const list = seeds.filter((s) => s.isActive);
    setBulkRunning(true);
    setBulkDone(0);
    setBulkTotal(list.length);
    const next: Record<string, any> = { ...bulkResults };

    try {
      for (let i = 0; i < list.length; i++) {
        const seed = list[i];
        try {
          const res = await fetch("/api/warmup/seeds/test", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: seed.id }),
          });
          const j = await res.json();
          next[seed.id] = { ...(j || {}), at: new Date().toISOString() };
          setBulkResults({ ...next });
        } catch (e: any) {
          next[seed.id] = { ok: false, imapOk: false, smtpOk: null, smtpConfigured: null, imapError: String(e?.message || e), at: new Date().toISOString() };
          setBulkResults({ ...next });
        } finally {
          setBulkDone((v) => v + 1);
        }
      }
    } finally {
      setBulkRunning(false);
    }
  }

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
          <Button onClick={() => setTab("activity")} variant="secondary">
            Activity
          </Button>
          <Button onClick={() => setTab("ramp")} variant="secondary">
            Ramp
          </Button>
          <Button onClick={() => setTab("threads")} variant="secondary">
            Threads
          </Button>
          <Button onClick={onDeleteManual} variant="secondary">
            Delete manual
          </Button>
        </div>
      }
    >
      <div className="rounded-2xl border border-slate-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Seed health dashboard</div>
            <div className="text-xs text-slate-500">Run a bulk connectivity test (IMAP + optional SMTP) for your active seeds.</div>
          </div>
          <div className="flex items-center gap-2">
            <Pill tone="info">Active {activeCount}</Pill>
            <Pill tone="gray">SMTP configured {smtpConfiguredCount}</Pill>
            <Button variant="primary" onClick={bulkTestActive} disabled={bulkRunning || !activeCount}>
              Bulk test active
            </Button>
          </div>
        </div>
        {bulkRunning || bulkDone ? (
          <div className="mt-2 text-xs text-slate-600">
            {bulkRunning ? "Running…" : "Done."} {bulkTotal ? `${bulkDone}/${bulkTotal}` : ""}
          </div>
        ) : null}
      </div>

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
              <th>Last test</th>
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
                <td className="py-3 pr-3">
                  {bulkResults[s.id] ? (
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill tone={bulkResults[s.id].imapOk ? "green" : "red"}>IMAP {bulkResults[s.id].imapOk ? "OK" : "FAIL"}</Pill>
                        {bulkResults[s.id].smtpConfigured ? (
                          <Pill tone={bulkResults[s.id].smtpOk ? "green" : "red"}>SMTP {bulkResults[s.id].smtpOk ? "OK" : "FAIL"}</Pill>
                        ) : (
                          <Pill tone="gray">SMTP n/a</Pill>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{bulkResults[s.id].at ? new Date(bulkResults[s.id].at).toLocaleString() : ""}</div>
                    </div>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
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
                <td colSpan={9} className="py-6 text-center text-slate-500">
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
          <Button onClick={() => setTab("activity")} variant="secondary">
            Activity
          </Button>
          <Button onClick={() => setTab("ramp")} variant="secondary">
            Ramp
          </Button>
          <Button onClick={() => setTab("threads")} variant="secondary">
            Threads
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
