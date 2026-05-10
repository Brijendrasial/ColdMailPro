"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button, Input, Pill, Select, TextArea, Modal, Kpi } from "@/components/ui";

type MailboxRow = {
  id: string;
  name: string;
  fromEmail: string;
  replyTo: string | null;
  isActive: boolean;
  warmupEnabled: boolean;
  dailyLimit: number;
  localAddress: string | null;
  smtpHost: string;
  smtpPort: number;

  sentToday: number;

  sent7d: number;
  bounced7d: number;
  replied7d: number;
  bounceRate7d: number; // 0..1
  replyRate7d: number; // 0..1

  sent24h: number;
  bounced24h: number;
  bounceRate24h: number;

  lastSentAt: string | null;

  cooldown: {
    active: boolean;
    until: string | null;
    count: number;
    reason: string | null;
  };

  needsAttention: boolean;
  attentionReasons: string[];
  healthFailCount24h: number;

  health: {
    pending: boolean;
    checkedAt: string | null;
    ok: boolean;
    smtp: { ok: boolean; ms?: number; error?: string } | null;
    imap: { ok: boolean; ms?: number; error?: string; skipped?: boolean } | null;
  };

  lastTest: {
    pending: boolean;
    at: string | null;
    ok: boolean | null;
    to: string | null;
    error: string | null;
    messageId: string | null;
  };

  created: number; // ms epoch
};

type MailboxDetails = {
  id: string;
  name: string;
  fromEmail: string;
  replyTo: string | null;
  isActive: boolean;
  warmupEnabled: boolean;
  dailyLimit: number;
  localAddress: string | null;

  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  hasSmtpPass: boolean;

  imapHost: string | null;
  imapPort: number;
  imapSecure: boolean;
  imapTlsSkipVerify: boolean;
  imapUser: string | null;
  hasImapPass: boolean;
  imapLastUid: number;

  createdAt: string;
  updatedAt: string;
};

type CampaignMini = { id: string; name: string; status: string };

type CooldownRow = {
  campaignId: string;
  campaignName: string;
  until: string;
  reason: string | null;
  createdAt: string;
};

type SortKey =
  | "created"
  | "name"
  | "fromEmail"
  | "status"
  | "needsAttention"
  | "cooldownUntil"
  | "warmup"
  | "dailyLimit"
  | "sentToday"
  | "bounceRate7d"
  | "replyRate7d"
  | "lastSentAt"
  | "healthCheckedAt"
  | "testAt";

function fmtPct(x: number) {
  if (!isFinite(x) || x < 0) return "0%";
  return `${Math.round(x * 1000) / 10}%`;
}

function fmtWhen(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function fmtRemaining(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = d.getTime() - Date.now();
  if (diffMs <= 0) return "ended";
  const mins = Math.ceil(diffMs / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.ceil(mins / 60);
  if (hrs < 48) return `in ${hrs}h`;
  const days = Math.ceil(hrs / 24);
  return `in ${days}d`;
}

function clampInt(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function clipText(s: string, n: number) {
  if (!s) return s;
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

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

export default function MailboxesClient() {
  const [rows, setRows] = useState<MailboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled" | "attention">("all");
  const [sortKey, setSortKey] = useState<SortKey>("created");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const selectedIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSaving, setDrawerSaving] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [editing, setEditing] = useState<MailboxRow | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    fromEmail: "",
    replyTo: "",
    isActive: true,
    warmupEnabled: false,
    dailyLimit: 50,
    localAddress: "",

    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: "",
    smtpPass: "", // optional; leave blank to keep

    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    imapTlsSkipVerify: false,
    imapUser: "",
    imapPass: "", // optional; leave blank to keep
  });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteInfo, setDeleteInfo] = useState<any | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  const [campaigns, setCampaigns] = useState<CampaignMini[]>([]);
  const [cooldowns, setCooldowns] = useState<CooldownRow[]>([]);
  const [cooldownLoading, setCooldownLoading] = useState(false);
  const [cooldownBusy, setCooldownBusy] = useState(false);
  const [cooldownForm, setCooldownForm] = useState({ campaignId: "", minutes: "60", reason: "" });

  const [bulkLimit, setBulkLimit] = useState<string>("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const [healthBusy, setHealthBusy] = useState<Record<string, boolean>>({});

  const [testOpen, setTestOpen] = useState(false);
  const [testMailbox, setTestMailbox] = useState<MailboxRow | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testSubject, setTestSubject] = useState("Test email");
  const [testText, setTestText] = useState("This is a test email from ColdMailPro.");
  const [testBusy, setTestBusy] = useState(false);

  // Allow deep-linking into a pre-filled search (e.g. from global search)
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const prefill = (sp.get("prefill") || "").trim();
      if (prefill) setQ(prefill);
    } catch {
      // ignore
    }
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Campaigns are needed for per-campaign cooldown management.
  useEffect(() => {
    fetch("/api/campaigns/list", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then((j) => setCampaigns((j?.campaigns || []) as CampaignMini[]))
      .catch(() => {
        // Non-blocking
      });
  }, []);

  async function refresh() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/mailboxes/list", { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { mailboxes: MailboxRow[] };
      setRows(data.mailboxes || []);
    } catch (e: any) {
      setError(String(e?.message || e || "FAILED"));
    } finally {
      setLoading(false);
    }
  }

  async function fetchDetails(id: string): Promise<MailboxDetails | null> {
    try {
      const res = await fetch(`/api/mailboxes/get?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const j = (await res.json()) as { mailbox?: MailboxDetails };
      return (j as any)?.mailbox || null;
    } catch {
      return null;
    }
  }

  async function fetchDeleteInfo(id: string) {
    try {
      const res = await fetch("/api/mailboxes/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, dryRun: true }),
      });
      if (!res.ok) throw new Error(await res.text());
      return await res.json();
    } catch {
      return null;
    }
  }

  async function loadCooldowns(mailboxId: string) {
    setCooldownLoading(true);
    try {
      const res = await fetch(`/api/mailboxes/throttles?mailboxId=${encodeURIComponent(mailboxId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const j = (await res.json()) as any;
      setCooldowns(Array.isArray(j?.throttles) ? (j.throttles as CooldownRow[]) : []);
    } catch {
      setCooldowns([]);
    } finally {
      setCooldownLoading(false);
    }
  }

  async function clearCooldown(args: { mailboxId: string; campaignId?: string } | { ids: string[] }) {
    setCooldownBusy(true);
    try {
      const res = await fetch("/api/mailboxes/throttle-clear", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok) throw new Error(await res.text());
      const j = (await res.json()) as any;
      const n = Number(j?.cleared || 0);
      setNotice(n ? `Cleared ${n} cooldown${n === 1 ? "" : "s"}.` : "No active cooldowns to clear.");
      setTimeout(() => setNotice(null), 2500);
      if ("mailboxId" in args) await loadCooldowns(args.mailboxId);
      setTimeout(() => refresh(), 800);
    } catch (e: any) {
      alert(String(e?.message || e || "COOLDOWN_CLEAR_FAILED"));
    } finally {
      setCooldownBusy(false);
    }
  }

  async function setCooldown(mailboxId: string) {
    if (!cooldownForm.campaignId) {
      alert("Pick a campaign");
      return;
    }
    setCooldownBusy(true);
    try {
      const res = await fetch("/api/mailboxes/throttle-set", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mailboxId,
          campaignId: cooldownForm.campaignId,
          minutes: clampInt(Number(cooldownForm.minutes), 1, 60 * 24 * 30),
          reason: cooldownForm.reason,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setCooldownForm((s) => ({ ...s, reason: "" }));
      await loadCooldowns(mailboxId);
      setTimeout(() => refresh(), 800);
      setNotice("Cooldown set.");
      setTimeout(() => setNotice(null), 2000);
    } catch (e: any) {
      alert(String(e?.message || e || "COOLDOWN_SET_FAILED"));
    } finally {
      setCooldownBusy(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // auto-refresh periodically so cooldown/health changes show up without manual refresh
  useEffect(() => {
    const t = setInterval(() => {
      refresh();
    }, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredSorted = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.slice();

    if (statusFilter === "active") out = out.filter((r) => r.isActive);
    if (statusFilter === "disabled") out = out.filter((r) => !r.isActive);
    if (statusFilter === "attention") out = out.filter((r) => r.needsAttention);

    if (needle) {
      out = out.filter((r) => {
        const hay = `${r.name} ${r.fromEmail} ${r.smtpHost} ${r.localAddress || ""}`.toLowerCase();
        return hay.includes(needle);
      });
    }

    const dir = sortDir === "asc" ? 1 : -1;
    out.sort((a, b) => {
      if (sortKey === "status") return ((a.isActive ? 1 : 0) - (b.isActive ? 1 : 0)) * dir;
      if (sortKey === "needsAttention") return ((a.needsAttention ? 1 : 0) - (b.needsAttention ? 1 : 0)) * dir;
      if (sortKey === "cooldownUntil") {
        const at = a.cooldown?.until ? new Date(a.cooldown.until).getTime() : 0;
        const bt = b.cooldown?.until ? new Date(b.cooldown.until).getTime() : 0;
        return (at - bt) * dir;
      }
      if (sortKey === "warmup") return ((a.warmupEnabled ? 1 : 0) - (b.warmupEnabled ? 1 : 0)) * dir;
      if (sortKey === "healthCheckedAt") {
        const at = a.health?.checkedAt ? new Date(a.health.checkedAt).getTime() : 0;
        const bt = b.health?.checkedAt ? new Date(b.health.checkedAt).getTime() : 0;
        return (at - bt) * dir;
      }
      if (sortKey === "testAt") {
        const at = a.lastTest?.at ? new Date(a.lastTest.at).getTime() : 0;
        const bt = b.lastTest?.at ? new Date(b.lastTest.at).getTime() : 0;
        return (at - bt) * dir;
      }
      if (sortKey === "lastSentAt") {
        const at = a.lastSentAt ? new Date(a.lastSentAt).getTime() : 0;
        const bt = b.lastSentAt ? new Date(b.lastSentAt).getTime() : 0;
        return (at - bt) * dir;
      }

      const av: any = (a as any)[sortKey];
      const bv: any = (b as any)[sortKey];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });

    return out;
  }, [rows, q, statusFilter, sortKey, sortDir]);

  async function runHealthcheck(ids: string[]) {
    if (!ids.length) return;
    const next: Record<string, boolean> = {};
    ids.forEach((id) => (next[id] = true));
    setHealthBusy((s) => ({ ...s, ...next }));
    try {
      const res = await fetch("/api/mailboxes/healthcheck", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ids.length === 1 ? { mailboxId: ids[0] } : { ids }),
      });
      if (!res.ok) throw new Error(await res.text());
      setNotice(`Queued health check${ids.length === 1 ? "" : "s"} for ${ids.length} mailbox${ids.length === 1 ? "" : "es"}.`);
      setTimeout(() => refresh(), 1200);
      setTimeout(() => refresh(), 4500);
    } catch (e: any) {
      alert(String(e?.message || e || "HEALTHCHECK_FAILED"));
    } finally {
      setHealthBusy((s) => {
        const copy = { ...s };
        ids.forEach((id) => delete copy[id]);
        return copy;
      });
    }
  }

  function openTestModal(r: MailboxRow) {
    setTestMailbox(r);
    setTestTo("");
    setTestSubject("Test email");
    setTestText("This is a test email from ColdMailPro.");
    setTestOpen(true);
  }

  async function sendTest() {
    if (!testMailbox) return;
    setTestBusy(true);
    try {
      const res = await fetch("/api/mailboxes/test-send-queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mailboxId: testMailbox.id,
          to: testTo,
          subject: testSubject,
          text: testText,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setNotice(`Queued test send from ${testMailbox.fromEmail} to ${testTo || "(recipient)"}.`);
      setTestOpen(false);
      setTestMailbox(null);
      setTimeout(() => refresh(), 1200);
      setTimeout(() => refresh(), 4500);
    } catch (e: any) {
      alert(String(e?.message || e || "TEST_SEND_FAILED"));
    } finally {
      setTestBusy(false);
    }
  }

  function toggleSort(k: SortKey) {
    if (sortKey !== k) {
      setSortKey(k);
      setSortDir(k === "name" || k === "fromEmail" ? "asc" : "desc");
      return;
    }
    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  }

  function openDrawer(r: MailboxRow) {
    setEditing(r);
    setEditForm({
      name: r.name,
      fromEmail: r.fromEmail,
      replyTo: r.replyTo || "",
      isActive: r.isActive,
      warmupEnabled: r.warmupEnabled,
      dailyLimit: r.dailyLimit,
      localAddress: r.localAddress || "",

      // Advanced values will be hydrated from /api/mailboxes/get
      smtpHost: r.smtpHost,
      smtpPort: r.smtpPort,
      smtpSecure: false,
      smtpUser: "",
      smtpPass: "",

      imapHost: "",
      imapPort: 993,
      imapSecure: true,
      imapTlsSkipVerify: false,
      imapUser: "",
      imapPass: "",
    });
    setDrawerOpen(true);

    // Load active per-campaign cooldowns for this mailbox
    if (!cooldownForm.campaignId && campaigns?.length) {
      setCooldownForm((s) => ({ ...s, campaignId: campaigns[0].id }));
    }
    loadCooldowns(r.id);

    // Hydrate advanced settings (smtpUser, imap config) without bloating /api/mailboxes/list
    setDrawerLoading(true);
    fetchDetails(r.id)
      .then((d) => {
        if (!d) return;
        setEditForm((s) => ({
          ...s,
          name: d.name,
          fromEmail: d.fromEmail,
          replyTo: d.replyTo || "",
          isActive: d.isActive,
          warmupEnabled: d.warmupEnabled,
          dailyLimit: d.dailyLimit,
          localAddress: d.localAddress || "",

          smtpHost: d.smtpHost,
          smtpPort: d.smtpPort,
          smtpSecure: !!d.smtpSecure,
          smtpUser: d.smtpUser || "",

          imapHost: d.imapHost || "",
          imapPort: d.imapPort || 993,
          imapSecure: d.imapSecure !== false,
          imapTlsSkipVerify: !!d.imapTlsSkipVerify,
          imapUser: d.imapUser || "",
        }));
      })
      .finally(() => setDrawerLoading(false));
  }

  async function saveDrawer() {
    if (!editing) return;
    setDrawerSaving(true);
    try {
      const data: any = {
        name: editForm.name,
        fromEmail: editForm.fromEmail,
        replyTo: editForm.replyTo || null,
        isActive: !!editForm.isActive,
        warmupEnabled: !!editForm.warmupEnabled,
        dailyLimit: clampInt(Number(editForm.dailyLimit), 1, 100000),
        localAddress: editForm.localAddress?.trim() ? editForm.localAddress.trim() : null,

        // Advanced
        smtpHost: editForm.smtpHost,
        smtpPort: clampInt(Number(editForm.smtpPort), 1, 65535),
        smtpSecure: !!editForm.smtpSecure,
        smtpUser: editForm.smtpUser,

        imapHost: editForm.imapHost,
        imapPort: clampInt(Number(editForm.imapPort), 1, 65535),
        imapSecure: !!editForm.imapSecure,
        imapTlsSkipVerify: !!editForm.imapTlsSkipVerify,
        imapUser: editForm.imapUser,
      };

      if (String(editForm.smtpPass || "").trim()) data.smtpPass = editForm.smtpPass;
      if (String(editForm.imapPass || "").trim()) data.imapPass = editForm.imapPass;

      const body = {
        id: editing.id,
        data,
      };
      const res = await fetch("/api/mailboxes/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
      setDrawerOpen(false);
      setEditing(null);
    } catch (e: any) {
      alert(String(e?.message || e || "SAVE_FAILED"));
    } finally {
      setDrawerSaving(false);
    }
  }

  function downloadCsv(rowsToExport: MailboxRow[]) {
    const cols = [
      "name",
      "fromEmail",
      "isActive",
      "warmupEnabled",
      "dailyLimit",
      "smtpHost",
      "smtpPort",
      "localAddress",
      "sentToday",
      "sent7d",
      "bounceRate7d",
      "replyRate7d",
      "lastSentAt",
    ];
    const esc = (v: any) => {
      const s = String(v ?? "");
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [cols.join(",")];
    for (const r of rowsToExport) {
      lines.push(
        cols
          .map((c) => {
            const v: any = (r as any)[c];
            if (c === "bounceRate7d" || c === "replyRate7d") return esc(fmtPct(Number(v) || 0));
            if (c === "lastSentAt") return esc(r.lastSentAt || "");
            return esc(v);
          })
          .join(",")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mailboxes-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function resetImapCursor() {
    if (!editing) return;
    setResetBusy(true);
    try {
      const res = await fetch("/api/mailboxes/reset-imap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: editing.id }),
      });
      if (!res.ok) throw new Error(await res.text());
      setNotice("Reset IMAP cursor (will rescan replies from UID 0)." );
      setTimeout(() => setNotice(null), 2500);
      // no need to refresh list
    } catch (e: any) {
      alert(String(e?.message || e || "RESET_FAILED"));
    } finally {
      setResetBusy(false);
    }
  }

  async function openDelete() {
    if (!editing) return;
    setDeleteOpen(true);
    setDeleteBusy(false);
    setDeleteInfo(null);
    const info = await fetchDeleteInfo(editing.id);
    setDeleteInfo(info);
  }

  async function confirmDelete() {
    if (!editing) return;
    setDeleteBusy(true);
    try {
      const res = await fetch("/api/mailboxes/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: editing.id }),
      });
      if (!res.ok) throw new Error(await res.text());
      setDeleteOpen(false);
      setDrawerOpen(false);
      setEditing(null);
      await refresh();
      setNotice("Mailbox deleted.");
      setTimeout(() => setNotice(null), 2500);
    } catch (e: any) {
      alert(String(e?.message || e || "DELETE_FAILED"));
    } finally {
      setDeleteBusy(false);
    }
  }

  function setAllSelected(on: boolean) {
    const next: Record<string, boolean> = {};
    for (const r of filteredSorted) next[r.id] = on;
    setSelected(next);
  }

  async function bulkUpdate(patch: { isActive?: boolean; warmupEnabled?: boolean; dailyLimit?: number }) {
    if (!selectedIds.length) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/mailboxes/bulk-update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, patch }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSelected({});
      setBulkLimit("");
      await refresh();
    } catch (e: any) {
      alert(String(e?.message || e || "BULK_FAILED"));
    } finally {
      setBulkBusy(false);
    }
  }

  const allChecked = filteredSorted.length > 0 && filteredSorted.every((r) => selected[r.id]);
  const anyChecked = selectedIds.length > 0;

  const attentionCount = useMemo(() => rows.filter((r) => r.needsAttention).length, [rows]);

  const kpis = useMemo(() => {
    const total = rows.length;
    const active = rows.filter((r) => r.isActive).length;
    const warmup = rows.filter((r) => r.warmupEnabled).length;
    const attention = rows.filter((r) => r.needsAttention).length;
    const sentToday = rows.reduce((a, r) => a + (Number(r.sentToday) || 0), 0);
    const avgBounce7d = (() => {
      const base = rows.filter((r) => (r.sent7d || 0) >= 20);
      if (!base.length) return 0;
      return base.reduce((a, r) => a + (Number(r.bounceRate7d) || 0), 0) / base.length;
    })();
    return { total, active, warmup, attention, sentToday, avgBounce7d };
  }, [rows]);

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
        <div className="xl:col-span-2 relative overflow-hidden rounded-[1.8rem] border border-slate-900/10 bg-slate-950 p-5 text-white shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
          <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-indigo-500/30 blur-3xl" />
          <div className="relative">
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400 font-semibold">Fleet health</div>
            <div className="mt-3 flex items-end gap-3">
              <div className="text-5xl font-semibold tracking-tight font-display">{kpis.total ? Math.max(0, Math.round(((kpis.total - kpis.attention) / kpis.total) * 100)) : 100}</div>
              <div className="pb-2 text-sm text-slate-300">/100</div>
            </div>
            <div className="mt-3 h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-indigo-400"
                style={{ width: `${kpis.total ? Math.max(8, Math.round(((kpis.total - kpis.attention) / kpis.total) * 100)) : 100}%` }}
              />
            </div>
            <div className="mt-3 text-xs leading-5 text-slate-300">
              {kpis.attention ? `${kpis.attention} sender${kpis.attention === 1 ? "" : "s"} need a check before scaling.` : "All visible senders look campaign-ready."}
            </div>
          </div>
        </div>
        <Kpi label="Mailboxes" value={kpis.total} />
        <Kpi label="Active" value={kpis.active} tone="info" />
        <Kpi label="Warmup on" value={kpis.warmup} tone="success" />
        <Kpi label="Needs attention" value={kpis.attention} tone={kpis.attention ? "danger" : "success"} hint={kpis.attention ? "Review health + bounce spikes" : "Clean"} />
        <Kpi label="Sent today" value={kpis.sentToday} tone="neutral" />
        <Kpi label="Avg bounce (7d)" value={fmtPct(kpis.avgBounce7d)} tone={kpis.avgBounce7d >= 0.1 ? "danger" : kpis.avgBounce7d >= 0.06 ? "warning" : "success"} hint="Mailboxes with ≥20 sent" />
      </div>

      <div className="rounded-[1.8rem] border border-white/70 bg-white/82 p-4 shadow-[0_18px_55px_rgba(15,23,42,0.07)] backdrop-blur-xl">
        <div className="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-4">
          <div className="grid grid-cols-1 md:grid-cols-[minmax(260px,1fr)_210px_190px_150px] gap-3 flex-1">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sender, email, SMTP host, bind IP…" />
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="text-sm">
              <option value="all">All mailboxes</option>
              <option value="active">Active only</option>
              <option value="disabled">Disabled only</option>
              <option value="attention">Needs attention ({attentionCount})</option>
            </Select>
            <Select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="text-sm">
              <option value="created">Newest first</option>
              <option value="name">Name</option>
              <option value="sentToday">Sent today</option>
              <option value="bounceRate7d">Bounce rate</option>
              <option value="replyRate7d">Reply rate</option>
              <option value="lastSentAt">Last sent</option>
              <option value="needsAttention">Needs attention</option>
            </Select>
            <Button type="button" variant="ghost" onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}>
              {sortDir === "asc" ? "Asc" : "Desc"}
            </Button>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button type="button" variant="ghost" onClick={refresh} disabled={loading}>Refresh</Button>
            <Button type="button" variant="ghost" onClick={() => downloadCsv(filteredSorted)} disabled={loading || filteredSorted.length === 0}>Export CSV</Button>
            <Button type="button" variant="secondary" onClick={() => runHealthcheck(filteredSorted.map((r) => r.id))} disabled={loading || filteredSorted.length === 0}>Run visible checks</Button>
          </div>
        </div>

        {anyChecked ? (
          <div className="mt-4 rounded-[1.4rem] border border-indigo-200 bg-indigo-50/80 p-3">
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Pill tone="info">{selectedIds.length} selected</Pill>
                <Button type="button" variant="ghost" disabled={bulkBusy} onClick={() => bulkUpdate({ isActive: true })}>Enable</Button>
                <Button type="button" variant="ghost" disabled={bulkBusy} onClick={() => bulkUpdate({ isActive: false })}>Disable</Button>
                <Button type="button" variant="ghost" disabled={bulkBusy} onClick={() => bulkUpdate({ warmupEnabled: true })}>Warmup on</Button>
                <Button type="button" variant="ghost" disabled={bulkBusy} onClick={() => bulkUpdate({ warmupEnabled: false })}>Warmup off</Button>
                <Button type="button" variant="ghost" disabled={bulkBusy} onClick={() => runHealthcheck(selectedIds)}>Run checks</Button>
                <Button type="button" variant="ghost" disabled={bulkBusy || cooldownBusy} onClick={() => clearCooldown({ ids: selectedIds })}>Clear cooldowns</Button>
              </div>
              <div className="flex items-center gap-2">
                <Input value={bulkLimit} onChange={(e) => setBulkLimit(e.target.value)} placeholder="Daily limit" type="number" min={1} className="w-[150px]" />
                <Button type="button" variant="secondary" disabled={bulkBusy || !bulkLimit.trim()} onClick={() => bulkUpdate({ dailyLimit: clampInt(Number(bulkLimit), 1, 100000) })}>Set limit</Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {notice ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div> : null}
      {loading ? <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-600">Loading sender fleet…</div> : null}

      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3 flex-wrap px-1">
          <div>
            <div className="text-sm font-semibold text-slate-950">{filteredSorted.length} sender{filteredSorted.length === 1 ? "" : "s"} visible</div>
            <div className="text-xs text-slate-500">Card view optimized for action: check, test, edit, and inspect health quickly.</div>
          </div>
          <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm">
            <input type="checkbox" checked={allChecked} onChange={(e) => setAllSelected(e.target.checked)} />
            Select visible
          </label>
        </div>

        <div className="grid gap-3">
          {filteredSorted.map((r) => {
            const healthErr = r.health?.smtp?.error || r.health?.imap?.error || "";
            const usage = r.dailyLimit ? Math.min(100, Math.round(((Number(r.sentToday) || 0) / r.dailyLimit) * 100)) : 0;
            const initials = (r.name || r.fromEmail || "M").split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("") || "M";
            return (
              <article key={r.id} className={cx("group relative overflow-hidden rounded-[1.8rem] border bg-white/86 p-4 shadow-[0_18px_55px_rgba(15,23,42,0.07)] transition hover:-translate-y-0.5 hover:shadow-[0_26px_80px_rgba(15,23,42,0.12)]", r.needsAttention ? "border-red-200" : "border-white/70")}>
                <div className={cx("absolute inset-x-0 top-0 h-1", r.needsAttention ? "bg-gradient-to-r from-red-500 via-orange-400 to-amber-400" : r.health?.ok ? "bg-gradient-to-r from-emerald-400 via-cyan-400 to-indigo-400" : "bg-gradient-to-r from-slate-300 to-slate-100")} />
                <div className="grid grid-cols-1 2xl:grid-cols-[minmax(280px,1.1fr)_minmax(440px,1.5fr)_minmax(300px,0.9fr)] gap-4 items-start">
                  <div className="flex items-start gap-3 min-w-0">
                    <input className="mt-5" type="checkbox" checked={!!selected[r.id]} onChange={(e) => setSelected((s) => ({ ...s, [r.id]: e.target.checked }))} />
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-cyan-500 text-sm font-bold text-white shadow-lg">{initials}</div>
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-950 truncate">{r.name}</div>
                      <div className="text-sm text-slate-600 truncate">{r.fromEmail}</div>
                      <div className="mt-1 text-xs text-slate-500 truncate">{r.smtpHost}:{r.smtpPort}{r.localAddress ? ` • bind ${r.localAddress}` : ""}</div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <Pill tone={r.isActive ? "success" : "neutral"}>{r.isActive ? "active" : "disabled"}</Pill>
                        <Pill tone={r.warmupEnabled ? "info" : "neutral"}>warmup {r.warmupEnabled ? "on" : "off"}</Pill>
                        {r.cooldown?.active && r.cooldown?.until ? <Pill tone="warning">cooldown {fmtRemaining(r.cooldown.until)}</Pill> : null}
                        {r.needsAttention ? <Pill tone="danger">needs attention</Pill> : null}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold">Daily usage</div>
                      <div className="mt-1 text-xl font-semibold text-slate-950">{r.sentToday}<span className="text-sm text-slate-400">/{r.dailyLimit}</span></div>
                      <div className="mt-2 h-2 rounded-full bg-slate-200 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${usage}%` }} /></div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold">Bounce 7d</div>
                      <div className={cx("mt-1 text-xl font-semibold", r.bounceRate7d >= 0.1 && r.sent7d >= 20 ? "text-red-600" : "text-slate-950")}>{fmtPct(r.bounceRate7d)}</div>
                      <div className="mt-1 text-xs text-slate-500">{r.bounced7d}/{r.sent7d || 0} • 24h {fmtPct(r.bounceRate24h)}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold">Reply 7d</div>
                      <div className={cx("mt-1 text-xl font-semibold", r.replyRate7d >= 0.03 && r.sent7d >= 20 ? "text-emerald-700" : "text-slate-950")}>{fmtPct(r.replyRate7d)}</div>
                      <div className="mt-1 text-xs text-slate-500">{r.replied7d}/{r.sent7d || 0}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold">Last sent</div>
                      <div className="mt-1 text-xl font-semibold text-slate-950">{fmtWhen(r.lastSentAt)}</div>
                      <div className="mt-1 text-xs text-slate-500">Created {fmtWhen(new Date(r.created).toISOString())}</div>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <div className="rounded-2xl border border-slate-200 bg-white/70 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Connection health</div>
                        <div className="flex flex-wrap gap-1 justify-end">
                          {r.health?.pending || healthBusy[r.id] ? <Pill tone="info">checking…</Pill> : null}
                          <Pill tone={r.health?.ok ? "success" : r.health?.checkedAt ? "danger" : "neutral"}>{r.health?.checkedAt ? (r.health.ok ? "healthy" : "unhealthy") : "not checked"}</Pill>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Pill tone={r.health?.smtp ? (r.health.smtp.ok ? "success" : "danger") : "neutral"}>SMTP {r.health?.smtp ? (r.health.smtp.ok ? "ok" : "fail") : "—"}</Pill>
                        <Pill tone={r.health?.imap ? (r.health.imap.skipped ? "neutral" : r.health.imap.ok ? "success" : "danger") : "neutral"}>IMAP {r.health?.imap ? (r.health.imap.skipped ? "n/a" : r.health.imap.ok ? "ok" : "fail") : "—"}</Pill>
                        <span className="px-2 py-1 text-xs text-slate-500">{fmtWhen(r.health?.checkedAt || null)}</span>
                      </div>
                      {healthErr ? (
                        <div className="mt-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                          <div>{clipText(healthErr, 120)}</div>
                          <button className="mt-1 underline" onClick={async () => { const ok = await copyToClipboard(healthErr); setNotice(ok ? "Copied error" : "Copy failed"); setTimeout(() => setNotice(null), 2000); }}>Copy error</button>
                        </div>
                      ) : null}
                    </div>

                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex flex-wrap gap-1.5">
                        {r.lastTest?.pending ? <Pill tone="info">test sending…</Pill> : typeof r.lastTest?.ok === "boolean" ? <Pill tone={r.lastTest.ok ? "success" : "danger"}>test {r.lastTest.ok ? "sent" : "failed"}</Pill> : <Pill tone="neutral">no test</Pill>}
                        <span className="px-2 py-1 text-xs text-slate-500">{r.lastTest?.to ? `to ${r.lastTest.to}` : "—"} • {fmtWhen(r.lastTest?.at || null)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button type="button" variant="ghost" onClick={() => runHealthcheck([r.id])} disabled={!!healthBusy[r.id]}>Check</Button>
                        <Button type="button" variant="ghost" onClick={() => openTestModal(r)}>Test</Button>
                        <Button type="button" variant="secondary" onClick={() => openDrawer(r)}>Edit</Button>
                      </div>
                    </div>
                  </div>
                </div>
                {r.attentionReasons?.length ? <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-800">{clipText(r.attentionReasons.join(" • "), 180)}</div> : null}
              </article>
            );
          })}

          {!loading && filteredSorted.length === 0 ? (
            <div className="rounded-[1.8rem] border border-dashed border-slate-300 bg-white/70 p-10 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg">📮</div>
              <div className="mt-4 text-lg font-semibold text-slate-950">No mailboxes found</div>
              <div className="mt-1 text-sm text-slate-600">Try clearing filters or add your first sender above.</div>
            </div>
          ) : null}
        </div>
      </div>

      {testOpen && testMailbox ? (
        <Modal
          title="Send a test email"
          onClose={() => {
            if (testBusy) return;
            setTestOpen(false);
          }}
          footer={
            <div className="flex items-center justify-between">
              <Button type="button" variant="ghost" onClick={() => setTestOpen(false)} disabled={testBusy}>
                Cancel
              </Button>
              <Button type="button" variant="secondary" onClick={sendTest} disabled={testBusy || !testTo.trim()}>
                {testBusy ? "Queuing…" : "Queue test send"}
              </Button>
            </div>
          }
        >
          <div className="text-sm text-slate-600 mb-4">From: <span className="font-medium text-slate-900">{testMailbox.fromEmail}</span></div>

          <div className="grid gap-4">
            <div>
              <div className="text-sm mb-1 text-slate-700">To</div>
              <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@domain.com" />
            </div>
            <div>
              <div className="text-sm mb-1 text-slate-700">Subject</div>
              <Input value={testSubject} onChange={(e) => setTestSubject(e.target.value)} />
            </div>
            <div>
              <div className="text-sm mb-1 text-slate-700">Message</div>
              <TextArea value={testText} onChange={(e) => setTestText(e.target.value)} />
            </div>
            <div className="text-xs text-slate-500">
              Tip: if this fails with TLS/cert errors, run a health check and review the SMTP/IMAP error.
            </div>
          </div>
        </Modal>
      ) : null}

      {drawerOpen && editing ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => !drawerSaving && setDrawerOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl border-l border-slate-200">
            <div className="p-5 flex items-start justify-between gap-3 border-b border-slate-100">
              <div>
                <div className="text-lg font-semibold text-slate-900">Edit mailbox</div>
                <div className="text-sm text-slate-600 mt-0.5">{editing.fromEmail}</div>
                {editing.needsAttention ? (
                  <div className="text-xs text-red-600 mt-1">{clipText(editing.attentionReasons.join(" • "), 120)}</div>
                ) : null}
              </div>
              <button
                className="text-slate-500 hover:text-slate-900"
                onClick={() => !drawerSaving && setDrawerOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="p-5 grid gap-4 overflow-auto h-[calc(100%-132px)]">
              {drawerLoading ? (
                <div className="text-sm text-slate-600">Loading mailbox settings…</div>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-sm mb-1 text-slate-700">Display name</div>
                  <Input value={editForm.name} onChange={(e) => setEditForm((s) => ({ ...s, name: e.target.value }))} />
                </div>
                <div>
                  <div className="text-sm mb-1 text-slate-700">From email</div>
                  <Input
                    value={editForm.fromEmail}
                    onChange={(e) => setEditForm((s) => ({ ...s, fromEmail: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <div className="text-sm mb-1 text-slate-700">Reply-to (optional)</div>
                <Input
                  value={editForm.replyTo}
                  onChange={(e) => setEditForm((s) => ({ ...s, replyTo: e.target.value }))}
                  placeholder="reply@yourdomain.com"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-sm mb-1 text-slate-700">Daily limit</div>
                  <Input
                    type="number"
                    min={1}
                    value={String(editForm.dailyLimit)}
                    onChange={(e) => setEditForm((s) => ({ ...s, dailyLimit: Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <div className="text-sm mb-1 text-slate-700">Bind IP (optional)</div>
                  <Input
                    value={editForm.localAddress}
                    onChange={(e) => setEditForm((s) => ({ ...s, localAddress: e.target.value }))}
                    placeholder="15.204.x.x"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <Input
                    type="checkbox"
                    checked={!!editForm.isActive}
                    onChange={(e) => setEditForm((s) => ({ ...s, isActive: e.target.checked }))}
                  />
                  Active
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <Input
                    type="checkbox"
                    checked={!!editForm.warmupEnabled}
                    onChange={(e) => setEditForm((s) => ({ ...s, warmupEnabled: e.target.checked }))}
                  />
                  Warmup enabled
                </label>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <div className="text-sm font-semibold text-slate-900">SMTP</div>
                <div className="text-xs text-slate-600 mt-1">Update connection settings. Leave password blank to keep current.</div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <div className="text-sm mb-1 text-slate-700">Host</div>
                    <Input value={editForm.smtpHost} onChange={(e) => setEditForm((s) => ({ ...s, smtpHost: e.target.value }))} placeholder="smtp.yourdomain.com" />
                  </div>
                  <div>
                    <div className="text-sm mb-1 text-slate-700">Port</div>
                    <Input type="number" min={1} value={String(editForm.smtpPort)} onChange={(e) => setEditForm((s) => ({ ...s, smtpPort: Number(e.target.value) }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <div className="text-sm mb-1 text-slate-700">User</div>
                    <Input value={editForm.smtpUser} onChange={(e) => setEditForm((s) => ({ ...s, smtpUser: e.target.value }))} placeholder="john@yourdomain.com" />
                  </div>
                  <div>
                    <div className="text-sm mb-1 text-slate-700">Password (optional)</div>
                    <Input type="password" value={editForm.smtpPass} onChange={(e) => setEditForm((s) => ({ ...s, smtpPass: e.target.value }))} placeholder="Leave blank to keep" />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700 mt-3">
                  <Input type="checkbox" checked={!!editForm.smtpSecure} onChange={(e) => setEditForm((s) => ({ ...s, smtpSecure: e.target.checked }))} />
                  SMTP SSL (secure)
                </label>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">IMAP (reply detection)</div>
                    <div className="text-xs text-slate-600 mt-1">Optional. Clear host to disable IMAP polling.</div>
                  </div>
                  <Button type="button" variant="ghost" onClick={resetImapCursor} disabled={resetBusy}>
                    {resetBusy ? "Resetting…" : "Reset cursor"}
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <div className="text-sm mb-1 text-slate-700">Host</div>
                    <Input value={editForm.imapHost} onChange={(e) => setEditForm((s) => ({ ...s, imapHost: e.target.value }))} placeholder="imap.gmail.com" />
                  </div>
                  <div>
                    <div className="text-sm mb-1 text-slate-700">Port</div>
                    <Input type="number" min={1} value={String(editForm.imapPort)} onChange={(e) => setEditForm((s) => ({ ...s, imapPort: Number(e.target.value) }))} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <div className="text-sm mb-1 text-slate-700">User</div>
                    <Input value={editForm.imapUser} onChange={(e) => setEditForm((s) => ({ ...s, imapUser: e.target.value }))} placeholder="same as fromEmail" />
                  </div>
                  <div>
                    <div className="text-sm mb-1 text-slate-700">Password (optional)</div>
                    <Input type="password" value={editForm.imapPass} onChange={(e) => setEditForm((s) => ({ ...s, imapPass: e.target.value }))} placeholder="Leave blank to keep" />
                  </div>
                </div>

                <div className="grid gap-2 mt-3">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <Input type="checkbox" checked={!!editForm.imapSecure} onChange={(e) => setEditForm((s) => ({ ...s, imapSecure: e.target.checked }))} />
                    IMAP SSL (secure)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <Input type="checkbox" checked={!!editForm.imapTlsSkipVerify} onChange={(e) => setEditForm((s) => ({ ...s, imapTlsSkipVerify: e.target.checked }))} />
                    Skip TLS certificate verification (TEMP)
                  </label>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Cooldowns (per campaign)</div>
                    <div className="text-xs text-slate-600 mt-1">View and clear active throttles. You can also add a manual cooldown for a specific campaign.</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="ghost" onClick={() => loadCooldowns(editing.id)} disabled={cooldownLoading || cooldownBusy}>
                      {cooldownLoading ? "Refreshing…" : "Refresh"}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => clearCooldown({ mailboxId: editing.id })} disabled={cooldownBusy}>
                      Clear all
                    </Button>
                  </div>
                </div>

                {cooldownLoading ? <div className="text-sm text-slate-600 mt-3">Loading cooldowns…</div> : null}

                {!cooldownLoading && cooldowns.length ? (
                  <div className="mt-3 grid gap-2">
                    {cooldowns.map((c) => (
                      <div key={`${c.campaignId}:${c.until}`} className="rounded-xl border border-slate-200 bg-white/60 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-slate-900">{c.campaignName}</div>
                            <div className="text-xs text-slate-600 mt-1">
                              Until: <span className="font-medium text-slate-900">{new Date(c.until).toLocaleString()}</span> ({fmtRemaining(c.until)})
                            </div>
                            {c.reason ? <div className="text-xs text-slate-600 mt-1">Reason: {clipText(c.reason, 180)}</div> : null}
                          </div>
                          <div className="flex items-center gap-2">
                            <a className="text-xs underline text-slate-700 hover:text-slate-900" href={`/app/campaigns/${c.campaignId}/deliverability`}>
                              Open
                            </a>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => clearCooldown({ mailboxId: editing.id, campaignId: c.campaignId })}
                              disabled={cooldownBusy}
                            >
                              Clear
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {!cooldownLoading && !cooldowns.length ? <div className="text-sm text-slate-600 mt-3">No active cooldowns.</div> : null}

                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/50 p-3">
                  <div className="text-sm font-semibold text-slate-900">Add manual cooldown</div>
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                      <div className="text-sm mb-1 text-slate-700">Campaign</div>
                      <Select
                        className="w-full text-sm"
                        value={cooldownForm.campaignId}
                        onChange={(e) => setCooldownForm((s) => ({ ...s, campaignId: e.target.value }))}
                      >
                        <option value="">Select…</option>
                        {campaigns.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.status})
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <div className="text-sm mb-1 text-slate-700">Minutes</div>
                      <Input
                        type="number"
                        min={1}
                        max={60 * 24 * 30}
                        value={cooldownForm.minutes}
                        onChange={(e) => setCooldownForm((s) => ({ ...s, minutes: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-sm mb-1 text-slate-700">Reason (optional)</div>
                    <Input value={cooldownForm.reason} onChange={(e) => setCooldownForm((s) => ({ ...s, reason: e.target.value }))} placeholder="e.g. bounce spike from ESP" />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-xs text-slate-600">Tip: use this if you want to pause a sender for a specific campaign without disabling the mailbox globally.</div>
                    <Button type="button" variant="secondary" onClick={() => setCooldown(editing.id)} disabled={cooldownBusy || !cooldownForm.campaignId}>
                      {cooldownBusy ? "Saving…" : "Set cooldown"}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <div className="text-sm font-semibold text-slate-900">Danger zone</div>
                <div className="text-xs text-slate-600 mt-1">This will remove the mailbox and unlink it from pools/campaigns (historical messages remain).</div>
                <div className="mt-3">
                  <Button type="button" variant="ghost" onClick={openDelete}>
                    Delete mailbox…
                  </Button>
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-slate-100 flex items-center justify-between">
              <Button type="button" variant="ghost" onClick={() => setDrawerOpen(false)} disabled={drawerSaving}>
                Cancel
              </Button>
              <Button type="button" variant="secondary" onClick={saveDrawer} disabled={drawerSaving}>
                {drawerSaving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteOpen && editing ? (
        <Modal
          title="Delete mailbox"
          onClose={() => !deleteBusy && setDeleteOpen(false)}
          footer={
            <div className="flex items-center justify-between">
              <Button type="button" variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleteBusy}>
                Cancel
              </Button>
              <Button type="button" variant="secondary" onClick={confirmDelete} disabled={deleteBusy}>
                {deleteBusy ? "Deleting…" : "Delete"}
              </Button>
            </div>
          }
        >
          <div className="text-sm text-slate-700">
            This will permanently delete <span className="font-medium text-slate-900">{editing.fromEmail}</span>.
          </div>
          <div className="text-xs text-slate-600 mt-2">Historical messages remain (mailboxId becomes null). Pools/campaign links are removed.</div>

          <div className="mt-4">
            {deleteInfo?.counts ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs text-slate-600">Campaign links</div>
                  <div className="font-semibold text-slate-900">{deleteInfo.counts.campaignLinks}</div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs text-slate-600">Pool memberships</div>
                  <div className="font-semibold text-slate-900">{deleteInfo.counts.poolLinks}</div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs text-slate-600">Throttles</div>
                  <div className="font-semibold text-slate-900">{deleteInfo.counts.throttles}</div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs text-slate-600">Messages</div>
                  <div className="font-semibold text-slate-900">{deleteInfo.counts.messages}</div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-600">Loading usage…</div>
            )}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Th({ label, onClick, active, dir }: { label: string; onClick: () => void; active: boolean; dir: "asc" | "desc" }) {
  return (
    <th className="table-cell text-left cursor-pointer select-none" onClick={onClick}>
      <div className="inline-flex items-center gap-1">
        <span>{label}</span>
        {active ? <span className="text-xs text-slate-500">{dir === "asc" ? "▲" : "▼"}</span> : null}
      </div>
    </th>
  );
}
