"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, IconButton, Input, Pill, TextArea } from "@/components/ui";
import { formatDateTimeUTC, formatMonthDayUTC } from "@/lib/date";
import { toast } from "react-toastify";

type MailboxOpt = { id: string; name: string; fromEmail: string; isActive: boolean };
type CampaignOpt = { id: string; name: string; status: string };
type MemberOpt = { id: string; name: string | null; email: string; role: string };

type ThreadRow = {
  leadId: string;
  leadEmail: string;
  leadFirstName: string | null;
  leadLastName: string | null;
  leadCompany: string | null;
  lastReplyAt: string;
  lastMeta: string | null;
  mailboxId: string | null;
  mailboxFromEmail: string | null;
  mailboxName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  replyCount: number;
  unreadCount: number;
  stateStatus: string;
  isPinned: boolean;
  isStarred: boolean;
  snoozeUntil: string | null;
  labels: any;
  assignedToUserId: string | null;
  assignedToName: string | null;
  assignedToEmail: string | null;
};

type TimelineItem =
  | {
      kind: "inbound";
      createdAt: string;
      subject: string | null;
      from: string | null;
      bodyText: string | null;
      bodyHtml: string | null;
      snippet: string | null;
    }
  | {
      kind: "outbound";
      createdAt: string;
      subject: string | null;
      fromMailbox: string | null;
      bodyText: string | null;
      bodyHtml: string | null;
      status: string;
    };



type AiAction = {
  id: string;
  sentiment: string;
  intent: string | null;
  confidence: number;
  action: string;
  draftSubject: string | null;
  draftBodyText: string | null;
  replyEventId: string;
  scheduledEventId?: string | null;
  scheduledMeetLink?: string | null;
  createdAt: string;
  updatedAt: string;
} | null;
type ThreadDetail = {
  lead: { id: string; email: string; firstName: string | null; lastName: string | null; company: string | null };
  target: {
    replyToMessageDbId: string;
    mailboxId: string | null;
    mailboxFromEmail: string | null;
    inReplyTo: string | null;
    references: string | null;
    subjectHint: string | null;
  } | null;
  timeline: TimelineItem[];
  ai: AiAction;
  state: {
    status: string;
    isPinned: boolean;
    isStarred: boolean;
    snoozeUntil: string | null;
    labels: string[];
    assignedToUserId: string | null;
  };
};

function safeHtml(html: string) {
  // Lightweight guardrails (not a full sanitizer)
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/on\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/on\w+\s*=\s*'[^']*'/gi, "");
}

function parseMeta(meta: string | null) {
  if (!meta) return {} as any;
  try {
    return JSON.parse(meta);
  } catch {
    return {} as any;
  }
}

function leadDisplayName(t: ThreadRow) {
  const n = `${t.leadFirstName || ""} ${t.leadLastName || ""}`.trim();
  return n || t.leadEmail;
}

function initialsFromName(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  const a = (parts[0] || name || "?")[0] || "?";
  const b = (parts[1] || "")[0] || "";
  return (a + b).toUpperCase();
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "open") return "info";
  if (status === "follow_up") return "warning";
  if (status === "closed") return "success";
  if (status === "spam") return "danger";
  if (status === "unsubscribe") return "danger";
  return "neutral";
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const oneDay = 24 * 60 * 60 * 1000;
  if (diff < oneDay) return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(d);
  return formatMonthDayUTC(d);
}

export default function TeamRepliesInbox(props: {
  mailboxes: MailboxOpt[];
  campaigns: CampaignOpt[];
  members: MemberOpt[];
}) {
  const { mailboxes, campaigns, members } = props;

  const [view, setView] = useState<
    "all" | "unread" | "starred" | "pinned" | "snoozed" | "due" | "mine" | "open" | "follow_up" | "closed" | "spam" | "unsubscribe"
  >("all");
  const [sort, setSort] = useState<"priority" | "latest" | "oldest">("priority");
  const [mailboxId, setMailboxId] = useState<string>("");
  const [campaignId, setCampaignId] = useState<string>("");
  const [q, setQ] = useState<string>("");

  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncingInbox, setSyncingInbox] = useState(false);

  const [selectedLeadId, setSelectedLeadId] = useState<string>("");
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [bulk, setBulk] = useState<string[]>([]);
  const bulkMode = bulk.length > 0;

  const [composerOpen, setComposerOpen] = useState(false);
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeSending, setComposeSending] = useState(false);

  const debounceRef = useRef<any>(null);
  const refreshTimerRef = useRef<any>(null);

  const memberOptions = useMemo(() => {
    return [{ id: "", label: "Unassigned" }].concat(
      members.map((m) => ({ id: m.id, label: m.name ? `${m.name} (${m.email})` : m.email }))
    );
  }, [members]);

  const selectedThread = threads.find((t) => t.leadId === selectedLeadId) || null;

  const lastInbound = useMemo(() => {
    if (!detail?.timeline?.length) return null;
    for (let i = detail.timeline.length - 1; i >= 0; i--) {
      if (detail.timeline[i].kind === "inbound") return detail.timeline[i] as Extract<TimelineItem, { kind: "inbound" }>;
    }
    return null;
  }, [detail]);

  const suggested = useMemo(() => {
    const text = `${lastInbound?.subject || ""} ${lastInbound?.bodyText || ""} ${lastInbound?.snippet || ""}`.toLowerCase();
    const out: { key: string; label: string; patch: any }[] = [];
    if (!text.trim()) return out;
    if (/(unsubscribe|remove me|take me off|opt\s*out|stop emailing)/i.test(text)) {
      out.push({ key: "unsubscribe", label: "Mark Unsubscribe", patch: { status: "unsubscribe" } });
    }
    if (/(spam|report\s+spam)/i.test(text)) {
      out.push({ key: "spam", label: "Mark Spam", patch: { status: "spam" } });
    }
    if (/(not interested|no thanks|don't contact|do not contact)/i.test(text)) {
      out.push({ key: "closed", label: "Close Thread", patch: { status: "closed" } });
    }
    if (/(call|schedule|meeting|zoom|calendar|availability)/i.test(text)) {
      out.push({ key: "follow", label: "Needs Follow-up", patch: { status: "follow_up" } });
    }
    return out.slice(0, 3);
  }, [lastInbound]);

  const templates = useMemo(
    () =>
      [
        {
          id: "thanks",
          label: "Thanks + question",
          body: "Thanks for getting back to me. Quick question: what would be the best next step on your side?",
        },
        {
          id: "followup",
          label: "Short follow-up",
          body: "Got it — thanks. If it helps, I can share a 2‑minute overview and a couple of examples. Interested?",
        },
        {
          id: "close",
          label: "Polite close",
          body: "Understood. I won’t follow up again. If anything changes, feel free to reply anytime.",
        },
      ],
    []
  );

  const [aiSettings, setAiSettings] = useState<any>(null);
  const [googleStatus, setGoogleStatus] = useState<any>(null);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  function renderAiPanel() {
    if (!aiSettingsOpen) return null;
    return (
      <div className="mb-4 p-3 rounded-2xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">AI Replies</div>
          <Button variant="ghost" onClick={() => setAiSettingsOpen(false)}>
            Close
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(aiSettings?.enabled)}
              onChange={(e) => saveAiSettings({ enabled: e.target.checked })}
            />
            Enabled
          </label>

          <div>
            <div className="text-xs opacity-70 mb-1">Mode</div>
            <select
              className="w-full px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-transparent text-sm"
              value={String(aiSettings?.mode || "suggest")}
              onChange={(e) => saveAiSettings({ mode: e.target.value })}
            >
              <option value="suggest">Suggest only</option>
              <option value="autopilot">Autopilot (worker auto-send)</option>
            </select>
          </div>

          <div>
            <div className="text-xs opacity-70 mb-1">Min confidence (autopilot)</div>
            <Input
              value={String(aiSettings?.minConfidence ?? 0.75)}
              onChange={(e) => setAiSettings({ ...(aiSettings || {}), minConfidence: e.target.value })}
              onBlur={(e) => {
                const n = Math.max(0, Math.min(1, Number(e.target.value || 0.75)));
                saveAiSettings({ minConfidence: n });
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
          <div>
            <div className="text-xs opacity-70 mb-1">Booking link (optional)</div>
            <Input
              value={String(aiSettings?.bookingLink || "")}
              onChange={(e) => setAiSettings({ ...(aiSettings || {}), bookingLink: e.target.value })}
              onBlur={(e) => saveAiSettings({ bookingLink: e.target.value })}
              placeholder="https://calendly.com/your-name/15min"
            />
          </div>
          <div>
            <div className="text-xs opacity-70 mb-1">Language</div>
            <Input
              value={String(aiSettings?.language || "English")}
              onChange={(e) => setAiSettings({ ...(aiSettings || {}), language: e.target.value })}
              onBlur={(e) => saveAiSettings({ language: e.target.value })}
              placeholder="English"
            />
          </div>
        </div>

        <div className="mt-4 p-3 rounded-2xl border border-black/10 dark:border-white/10 bg-transparent">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Google Calendar (optional)</div>
              <div className="text-xs opacity-70 mt-0.5">Connect to auto-create Meet invites when a reply contains an exact time.</div>
            </div>
            {googleStatus?.oauthConfigured ? (
              googleStatus?.connected ? (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await fetch("/api/integrations/google/disconnect", { method: "POST" });
                      toast.success("Google disconnected");
                      loadGoogleStatus();
                    } catch {
                      toast.error("Failed to disconnect");
                    }
                  }}
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  onClick={() => {
                    window.location.href = "/api/integrations/google/start?next=/app/replies";
                  }}
                >
                  Connect
                </Button>
              )
            ) : (
              <span className="text-xs opacity-60">OAuth not configured (.env)</span>
            )}
          </div>

          {googleStatus?.connected ? (
            <div className="text-xs opacity-70 mt-2">Connected as: {googleStatus?.googleEmail || "(unknown)"}</div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(aiSettings?.googleCalendar?.enabled)}
                onChange={(e) => saveAiSettings({ googleCalendar: { enabled: e.target.checked } })}
              />
              Enable scheduling
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(aiSettings?.googleCalendar?.autoCreate)}
                onChange={(e) => saveAiSettings({ googleCalendar: { autoCreate: e.target.checked } })}
              />
              Auto-create when time detected
            </label>
            <div>
              <div className="text-xs opacity-70 mb-1">Min time confidence</div>
              <Input
                value={String(aiSettings?.googleCalendar?.minTimeConfidence ?? 0.8)}
                onChange={(e) =>
                  setAiSettings({
                    ...(aiSettings || {}),
                    googleCalendar: { ...(aiSettings?.googleCalendar || {}), minTimeConfidence: e.target.value },
                  })
                }
                onBlur={(e) => {
                  const n = Math.max(0, Math.min(1, Number(e.target.value || 0.8)));
                  saveAiSettings({ googleCalendar: { minTimeConfidence: n } });
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
            <div>
              <div className="text-xs opacity-70 mb-1">Default duration (minutes)</div>
              <Input
                value={String(aiSettings?.googleCalendar?.defaultDurationMin ?? 30)}
                onChange={(e) =>
                  setAiSettings({
                    ...(aiSettings || {}),
                    googleCalendar: { ...(aiSettings?.googleCalendar || {}), defaultDurationMin: e.target.value },
                  })
                }
                onBlur={(e) => {
                  const n = Math.max(10, Math.min(180, Number(e.target.value || 30)));
                  saveAiSettings({ googleCalendar: { defaultDurationMin: n } });
                }}
              />
            </div>
            <div>
              <div className="text-xs opacity-70 mb-1">Timezone (fallback)</div>
              <Input
                value={String(aiSettings?.googleCalendar?.timezone || "Asia/Kolkata")}
                onChange={(e) =>
                  setAiSettings({
                    ...(aiSettings || {}),
                    googleCalendar: { ...(aiSettings?.googleCalendar || {}), timezone: e.target.value },
                  })
                }
                onBlur={(e) => saveAiSettings({ googleCalendar: { timezone: e.target.value } })}
                placeholder="Asia/Kolkata"
              />
            </div>
          </div>
        </div>

        <div className="text-xs opacity-60 mt-3">
          Autopilot runs in the worker when new replies arrive. It will only send for **positive** replies (and will ignore negatives/OOO/unsub).
        </div>
      </div>
    );
  }

  async function loadAiSettings() {
    try {
      const r = await fetch("/api/replies/ai/settings", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      setAiSettings(
        j?.repliesAi || {
          enabled: false,
          mode: "suggest",
          minConfidence: 0.75,
          bookingLink: "",
          language: "English",
          closeNegative: true,
          googleCalendar: { enabled: false, autoCreate: false, minTimeConfidence: 0.8, defaultDurationMin: 30, timezone: "Asia/Kolkata" },
        }
      );
    } catch {}
  }



  async function loadGoogleStatus() {
    try {
      const r = await fetch("/api/integrations/google/status", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      setGoogleStatus(j);
    } catch {
      setGoogleStatus(null);
    }
  }
  async function saveAiSettings(patch: any) {
    const next: any = { ...(aiSettings || {}) };
    const p: any = patch || {};

    // shallow merge + special-case nested googleCalendar
    for (const k of Object.keys(p)) {
      if (k === "googleCalendar" && p.googleCalendar && typeof p.googleCalendar === "object") {
        next.googleCalendar = { ...(next.googleCalendar || {}), ...(p.googleCalendar || {}) };
      } else {
        next[k] = p[k];
      }
    }

    setAiSettings(next);
    try {
      await fetch("/api/replies/ai/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repliesAi: next }),
      });
      toast.success("AI settings saved");
    } catch {
      toast.error("Failed to save AI settings");
    }
  }

  async function generateAiDraft(leadId: string) {
    setAiBusy(true);
    try {
      const r = await fetch("/api/replies/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || "FAILED");
      toast.success("AI draft ready");
      await fetchDetail(leadId);
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setAiBusy(false);
    }
  }

  async function sendAiDraft(aiActionId: string, leadId: string) {
    setAiBusy(true);
    try {
      const r = await fetch("/api/replies/ai/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiActionId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || "FAILED");
      toast.success("Sent");
      await fetchDetail(leadId);
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setAiBusy(false);
    }
  }


  async function scheduleAiMeeting(aiActionId: string, leadId: string) {
    setAiBusy(true);
    try {
      const r = await fetch("/api/replies/ai/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiActionId, sendNow: true }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || "FAILED");
      toast.success(j?.scheduled ? "Meeting scheduled" : "No exact time detected");
      await fetchDetail(leadId);
      loadGoogleStatus();
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setAiBusy(false);
    }
  }

  function toggleBulk(leadId: string) {
    setBulk((prev) => {
      if (prev.includes(leadId)) return prev.filter((x) => x !== leadId);
      return prev.concat(leadId);
    });
  }

  async function fetchThreads() {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      sp.set("view", view);
      sp.set("sort", sort);
      if (mailboxId) sp.set("mailboxId", mailboxId);
      if (campaignId) sp.set("campaignId", campaignId);
      if (q.trim()) sp.set("q", q.trim());
      const res = await fetch(`/api/replies/threads?${sp.toString()}`, { cache: "no-store" });
      const js = await res.json();
      setThreads(js.threads || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }



  async function syncInboxNow() {
    setSyncingInbox(true);
    try {
      const res = await fetch("/api/replies/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mailboxId: mailboxId || undefined }),
      });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || js?.error) throw new Error(js?.error || "SYNC_FAILED");
      toast.success(
        js.queued > 0
          ? `Inbox sync queued for ${js.queued} mailbox${js.queued === 1 ? "" : "es"}`
          : "Inbox sync already running"
      );

      // The worker picks queued jobs on its normal tick. Poll the DB-backed thread list a few
      // times so new replies appear without forcing the user to wait for the 25s refresh.
      await fetchThreads();
      window.setTimeout(fetchThreads, 2500);
      window.setTimeout(fetchThreads, 6000);
      window.setTimeout(fetchThreads, 10000);
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setSyncingInbox(false);
    }
  }

  async function fetchDetail(leadId: string) {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/replies/thread/${leadId}`, { cache: "no-store" });
      const js = (await res.json()) as ThreadDetail;
      setDetail(js);
      setComposerOpen(false);
      setComposeBody("");
      setComposeSubject(js?.target?.subjectHint || "Re:");
      // Mark read (shared)
      await fetch(`/api/replies/state/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markRead: true }),
      });
      fetchThreads();
    } catch (e) {
      console.error(e);
    } finally {
      setDetailLoading(false);
    }
  }

  function scheduleFetch() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchThreads, 250);
  }
  useEffect(() => {
    loadAiSettings();
    loadGoogleStatus();
  }, []);

  useEffect(() => {
    scheduleFetch();
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    refreshTimerRef.current = setInterval(() => {
      fetchThreads();
    }, 25_000);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, sort, mailboxId, campaignId]);

  useEffect(() => {
    scheduleFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Keyboard shortcuts (j/k navigation + r to reply)
  useEffect(() => {
    function isTypingTarget(el: any) {
      const tag = (el?.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || el?.isContentEditable;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (!threads.length) return;
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const idx = Math.max(0, threads.findIndex((t) => t.leadId === selectedLeadId));
        const nextIdx = e.key === "j" ? Math.min(threads.length - 1, idx + 1) : Math.max(0, idx - 1);
        const next = threads[nextIdx];
        if (next) {
          setSelectedLeadId(next.leadId);
          fetchDetail(next.leadId);
        }
      }
      if (e.key === "r") {
        if (selectedLeadId && detail?.target) {
          e.preventDefault();
          setComposeSubject(detail.target.subjectHint || "Re:");
          setComposerOpen(true);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, selectedLeadId, detail]);

  async function patchState(leadId: string, patch: any) {
    await fetch(`/api/replies/state/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    await fetchThreads();
    if (selectedLeadId === leadId) {
      await fetchDetail(leadId);
    }
  }

  async function bulkPatch(patch: any) {
    const ids = [...bulk];
    setBulk([]);
    for (const id of ids) {
      // sequential to keep DB load low
      // eslint-disable-next-line no-await-in-loop
      await patchState(id, patch);
    }
  }

  async function sendReply() {
    if (!detail?.target) return;
    if (!composeBody.trim()) return;
    setComposeSending(true);
    try {
      const subject = composeSubject.trim() || detail.target.subjectHint || "Re:";
      const res = await fetch(`/api/replies/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: detail.lead.id,
          replyToMessageDbId: detail.target.replyToMessageDbId,
          subject,
          bodyText: composeBody,
        }),
      });
      if (!res.ok) {
        const js = await res.json().catch(() => ({}));
        toast.error(js.error || "Failed to send");
        return;
      }
      setComposeBody("");
      setComposerOpen(false);
      toast.success("Reply sent");
      await fetchDetail(detail.lead.id);
    } finally {
      setComposeSending(false);
    }
  }

  const totalThreads = threads.length;
  const unreadThreads = threads.filter((t) => t.unreadCount > 0).length;
  const followThreads = threads.filter((t) => t.stateStatus === "follow_up").length;
  const openThreads = threads.filter((t) => t.stateStatus === "open").length;
  const pinnedThreads = threads.filter((t) => t.isPinned || t.isStarred).length;
  const visibleThreadLabel = loading ? "Syncing…" : `${totalThreads} thread${totalThreads === 1 ? "" : "s"}`;

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-[2rem] border border-slate-900/10 bg-slate-950 text-white shadow-[0_28px_90px_rgba(15,23,42,0.22)]">
        <div className="absolute inset-0 bg-[radial-gradient(900px_circle_at_0%_0%,rgba(99,102,241,0.42),transparent_42%),radial-gradient(760px_circle_at_100%_10%,rgba(20,184,166,0.30),transparent_46%)]" />
        <div className="relative p-5 sm:p-7 lg:p-8">
          <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-6">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/75">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_0_4px_rgba(52,211,153,0.18)]" />
                Shared inbox
              </div>
              <h2 className="mt-4 text-3xl sm:text-4xl font-semibold tracking-tight font-display">Reply Command Center</h2>
              <p className="mt-2 text-sm sm:text-base text-white/70 leading-6">
                Triage inbound replies, assign owners, generate AI drafts, snooze follow-ups, and respond without leaving the workspace.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 xl:grid-cols-5 gap-2 w-full xl:w-auto">
              {[
                ["Threads", totalThreads, "text-white"],
                ["Unread", unreadThreads, "text-sky-100"],
                ["Follow-up", followThreads, "text-amber-100"],
                ["Open", openThreads, "text-indigo-100"],
                ["Pinned", pinnedThreads, "text-emerald-100"],
              ].map(([label, value, color]) => (
                <div key={String(label)} className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-xl min-w-[112px]">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-white/50 font-semibold">{label}</div>
                  <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-3">
            <div className="grid grid-cols-1 md:grid-cols-[1.2fr_0.8fr_0.8fr] gap-3">
              <Input
                className="bg-white/95 border-white/20"
                placeholder="Search lead, subject, company, mailbox…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <select
                className="w-full px-3.5 py-2.5 rounded-2xl border border-white/20 bg-white/95 text-sm text-slate-800 shadow-sm outline-none"
                value={mailboxId}
                onChange={(e) => setMailboxId(e.target.value)}
              >
                <option value="">All mailboxes</option>
                {mailboxes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fromEmail}{m.isActive ? "" : " (inactive)"}
                  </option>
                ))}
              </select>
              <select
                className="w-full px-3.5 py-2.5 rounded-2xl border border-white/20 bg-white/95 text-sm text-slate-800 shadow-sm outline-none"
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
              >
                <option value="">All campaigns</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 justify-start lg:justify-end">
              <Button variant="ghost" className="bg-white/10 border-white/15 text-white hover:bg-white/15" onClick={() => syncInboxNow()}>
                {syncingInbox ? "Syncing inbox…" : loading ? "Refreshing…" : "Sync inbox now"}
              </Button>
              <Button variant="ghost" className="bg-white text-slate-900 border-white" onClick={() => setAiSettingsOpen((v) => !v)}>
                AI settings
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[440px_minmax(0,1fr)] gap-5 items-start">
        <section className="premium-card overflow-hidden xl:sticky xl:top-5">
          <div className="p-4 sm:p-5 border-b border-slate-200/80 bg-white/80">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-indigo-500 shadow-[0_0_0_4px_rgba(99,102,241,0.13)]" />
                  <h2 className="card-title">Inbox queue</h2>
                </div>
                <p className="card-subtitle">J/K to navigate · R to reply · auto-refresh + instant IMAP sync</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge>{visibleThreadLabel}</Badge>
                <IconButton titleText="Sync inbox now" onClick={() => syncInboxNow()}>{syncingInbox ? "…" : "↻"}</IconButton>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <select
                className="w-full px-3.5 py-2.5 rounded-2xl border border-slate-200/90 bg-white/90 text-sm shadow-sm outline-none"
                value={view}
                onChange={(e) => setView(e.target.value as any)}
              >
                <option value="all">All conversations</option>
                <option value="unread">Unread</option>
                <option value="mine">Assigned to me</option>
                <option value="starred">Starred</option>
                <option value="pinned">Pinned</option>
                <option value="snoozed">Snoozed</option>
                <option value="due">Due now</option>
                <option value="open">Open</option>
                <option value="follow_up">Needs follow-up</option>
                <option value="closed">Closed</option>
                <option value="spam">Spam</option>
                <option value="unsubscribe">Unsubscribe</option>
              </select>
              <select
                className="w-full px-3.5 py-2.5 rounded-2xl border border-slate-200/90 bg-white/90 text-sm shadow-sm outline-none"
                value={sort}
                onChange={(e) => setSort(e.target.value as any)}
              >
                <option value="priority">Priority first</option>
                <option value="latest">Latest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>

            {bulkMode ? (
              <div className="mt-3 rounded-2xl border border-indigo-200 bg-indigo-50/80 p-3 flex flex-wrap items-center gap-2">
                <Pill tone="info">{bulk.length} selected</Pill>
                <Button variant="ghost" onClick={() => bulkPatch({ markRead: true })}>Mark read</Button>
                <Button variant="ghost" onClick={() => bulkPatch({ markUnread: true })}>Mark unread</Button>
                <Button variant="ghost" onClick={() => setBulk([])}>Clear</Button>
              </div>
            ) : null}
          </div>

          <div className="max-h-[70vh] overflow-y-auto p-3 bg-gradient-to-b from-white/70 to-slate-50/80">
            <div className="space-y-2">
              {threads.map((t) => {
                const meta = parseMeta(t.lastMeta);
                const subject = meta.subject || meta.subjectHint || "(no subject)";
                const snippet = meta.snippet || "";
                const active = t.leadId === selectedLeadId;
                const snoozed = t.snoozeUntil ? new Date(t.snoozeUntil).getTime() > Date.now() : false;
                const name = leadDisplayName(t);
                return (
                  <div
                    key={t.leadId}
                    className={`group rounded-[1.35rem] border transition shadow-sm ${
                      active
                        ? "border-indigo-200 bg-white shadow-[0_16px_42px_rgba(79,70,229,0.12)] ring-2 ring-indigo-100"
                        : "border-slate-200/80 bg-white/82 hover:bg-white hover:shadow-md"
                    }`}
                  >
                    <button
                      onClick={() => {
                        setSelectedLeadId(t.leadId);
                        fetchDetail(t.leadId);
                      }}
                      className="w-full text-left p-3.5 rounded-[1.35rem]"
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={bulk.includes(t.leadId)}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleBulk(t.leadId);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-3 h-4 w-4 rounded border-slate-300 text-indigo-600"
                        />
                        <div className="relative shrink-0">
                          <div className={`h-11 w-11 rounded-2xl flex items-center justify-center font-semibold border ${active ? "bg-indigo-600 text-white border-indigo-500" : "bg-slate-100 text-slate-700 border-slate-200"}`}>
                            {initialsFromName(name)}
                          </div>
                          {t.unreadCount > 0 ? <div className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{t.unreadCount}</div> : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-950 truncate">{name}</div>
                              <div className="text-xs text-slate-500 truncate">{t.leadEmail}</div>
                            </div>
                            <div className="text-xs text-slate-400 whitespace-nowrap">{formatWhen(t.lastReplyAt)}</div>
                          </div>
                          <div className="mt-2 text-sm text-slate-700 line-clamp-2">
                            <span className="font-medium text-slate-900">{subject}</span>
                            {snippet ? <span className="text-slate-500"> — {snippet}</span> : null}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-1.5 items-center">
                            {t.isPinned ? <Pill>📌 Pinned</Pill> : null}
                            {t.isStarred ? <Pill>★ Starred</Pill> : null}
                            {snoozed ? <Pill>⏰ Snoozed</Pill> : null}
                            {t.stateStatus ? <Pill tone={statusTone(t.stateStatus)}>{t.stateStatus.replace("_", " ")}</Pill> : null}
                            {t.assignedToEmail ? <Pill>👤 {t.assignedToName || t.assignedToEmail}</Pill> : null}
                            {t.replyCount > 1 ? <Pill>{t.replyCount} replies</Pill> : null}
                          </div>
                        </div>
                      </div>
                    </button>
                  </div>
                );
              })}

              {threads.length === 0 ? (
                <div className="rounded-[1.6rem] border border-dashed border-slate-300 bg-white/70 p-10 text-center">
                  <div className="mx-auto h-12 w-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-400 text-white flex items-center justify-center text-xl shadow-lg">✉</div>
                  <div className="mt-4 font-semibold text-slate-950">No reply threads found</div>
                  <div className="mt-1 text-sm text-slate-500">Try clearing filters, switching views, or refreshing the inbox.</div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="premium-card overflow-hidden min-h-[720px]">
          <div className="p-4 sm:p-5 border-b border-slate-200/80 bg-white/82">
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.13)]" />
                  <h2 className="card-title truncate">{detail?.lead ? detail.lead.email : "Conversation studio"}</h2>
                </div>
                <p className="card-subtitle">
                  {detail?.lead ? `${detail.lead.company || "No company"} · ${detail.target?.mailboxFromEmail || "Mailbox not linked"}` : "Select a thread to open messages, AI suggestions, ownership, and reply controls."}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="ghost" onClick={() => setAiSettingsOpen((v) => !v)}>AI</Button>
                {selectedLeadId && detail ? (
                  <>
                    <IconButton titleText={detail.state.isPinned ? "Unpin" : "Pin"} onClick={() => patchState(detail.lead.id, { isPinned: !detail.state.isPinned })}>📌</IconButton>
                    <IconButton titleText={detail.state.isStarred ? "Unstar" : "Star"} onClick={() => patchState(detail.lead.id, { isStarred: !detail.state.isStarred })}>★</IconButton>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-5 lg:p-6">
            {!selectedLeadId ? (
              <div>
                {renderAiPanel()}
                <div className="rounded-[1.8rem] border border-dashed border-slate-300 bg-gradient-to-br from-white to-slate-50 p-12 text-center min-h-[420px] flex flex-col items-center justify-center">
                  <div className="h-16 w-16 rounded-[1.5rem] bg-slate-950 text-white flex items-center justify-center text-2xl shadow-[0_18px_50px_rgba(15,23,42,0.22)]">↩</div>
                  <h3 className="mt-5 text-2xl font-semibold tracking-tight text-slate-950">Pick a reply to start triage</h3>
                  <p className="mt-2 max-w-lg text-sm text-slate-500 leading-6">The thread timeline, AI draft, owner controls, labels, snooze options, and reply composer will appear here.</p>
                </div>
              </div>
            ) : detailLoading ? (
              <div className="rounded-[1.8rem] border border-slate-200 bg-white/70 p-12 text-center text-sm text-slate-500">Loading conversation…</div>
            ) : !detail ? (
              <div className="rounded-[1.8rem] border border-red-200 bg-red-50/80 p-12 text-center text-sm text-red-700">Unable to load this thread.</div>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 md:col-span-2">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Lead</div>
                    <div className="mt-1 font-semibold text-slate-950 truncate">{detail.lead.firstName || detail.lead.lastName ? `${detail.lead.firstName || ""} ${detail.lead.lastName || ""}`.trim() : detail.lead.email}</div>
                    <div className="text-xs text-slate-500 truncate">{detail.lead.email}{detail.lead.company ? ` · ${detail.lead.company}` : ""}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white/80 p-4">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Status</div>
                    <div className="mt-2"><Pill tone={statusTone(detail.state.status)}>{detail.state.status.replace("_", " ")}</Pill></div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white/80 p-4">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Messages</div>
                    <div className="mt-1 text-2xl font-semibold text-slate-950">{detail.timeline.length}</div>
                  </div>
                </div>

                <div className="rounded-[1.6rem] border border-slate-200 bg-white/80 p-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <select className="px-3 py-2.5 rounded-2xl border border-slate-200/90 bg-white text-sm shadow-sm" value={detail.state.status} onChange={(e) => patchState(detail.lead.id, { status: e.target.value })}>
                      <option value="open">Open</option>
                      <option value="follow_up">Needs follow-up</option>
                      <option value="closed">Closed</option>
                      <option value="spam">Spam</option>
                      <option value="unsubscribe">Unsubscribe</option>
                    </select>
                    <select className="px-3 py-2.5 rounded-2xl border border-slate-200/90 bg-white text-sm shadow-sm" value={detail.state.assignedToUserId || ""} onChange={(e) => patchState(detail.lead.id, { assignedToUserId: e.target.value || null })}>
                      {memberOptions.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                    <select
                      className="px-3 py-2.5 rounded-2xl border border-slate-200/90 bg-white text-sm shadow-sm"
                      value={detail.state.snoozeUntil && new Date(detail.state.snoozeUntil).getTime() > Date.now() ? "custom" : ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "") return patchState(detail.lead.id, { snoozeUntil: null });
                        const now = new Date();
                        let dt: Date | null = null;
                        if (v === "tomorrow") { const t = new Date(now); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); dt = t; }
                        if (v === "1d") dt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
                        if (v === "3d") dt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
                        if (v === "7d") dt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
                        if (dt) patchState(detail.lead.id, { snoozeUntil: dt.toISOString() });
                      }}
                    >
                      <option value="">Snooze off</option>
                      <option value="tomorrow">Tomorrow 9am</option>
                      <option value="1d">Snooze 1 day</option>
                      <option value="3d">Snooze 3 days</option>
                      <option value="7d">Snooze 7 days</option>
                    </select>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 justify-between">
                    <div className="flex flex-wrap gap-2">
                      <Button variant="ghost" onClick={() => patchState(detail.lead.id, { markUnread: true })}>Mark unread</Button>
                      <Button variant="ghost" onClick={() => generateAiDraft(detail.lead.id)} disabled={aiBusy || !detail.lead}>{aiBusy ? "AI working…" : "Generate AI draft"}</Button>
                    </div>
                    <Button onClick={() => { setComposeSubject(detail.target?.subjectHint || "Re:"); setComposerOpen(true); }} disabled={!detail.target}>Reply</Button>
                  </div>
                </div>

                {renderAiPanel()}

                {detail.ai ? (
                  <div className="rounded-[1.6rem] border border-indigo-200 bg-indigo-50/75 p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap gap-2">
                          <Pill tone="info">🤖 {detail.ai.sentiment}</Pill>
                          {detail.ai.intent ? <Pill>{detail.ai.intent}</Pill> : null}
                          <Pill>conf {Math.round((detail.ai.confidence || 0) * 100)}%</Pill>
                          <Pill>{detail.ai.action}</Pill>
                          {detail.ai.scheduledEventId ? <Pill>📅 scheduled</Pill> : null}
                        </div>
                        <div className="mt-2 text-sm font-semibold text-slate-950">AI assistant draft</div>
                      </div>
                      {detail.ai.draftBodyText ? (
                        <div className="flex flex-wrap items-center gap-2">
                          {detail.ai?.intent === "meeting_request" && googleStatus?.connected && !detail.ai?.scheduledEventId ? (
                            <Button variant="ghost" onClick={() => scheduleAiMeeting(detail.ai!.id, detail.lead.id)} disabled={aiBusy}>{aiBusy ? "Working…" : "Schedule Meet"}</Button>
                          ) : null}
                          <Button variant="ghost" onClick={() => { setComposeSubject(detail.ai?.draftSubject || detail.target?.subjectHint || "Re:"); setComposeBody(detail.ai?.draftBodyText || ""); setComposerOpen(true); }}>Insert</Button>
                          <Button onClick={() => sendAiDraft(detail.ai!.id, detail.lead.id)} disabled={aiBusy}>{aiBusy ? "Sending…" : "Send AI"}</Button>
                        </div>
                      ) : <div className="text-xs text-slate-500">No draft stored yet.</div>}
                    </div>
                    {detail.ai.draftBodyText ? <pre className="mt-3 rounded-2xl border border-white/70 bg-white/80 p-3 text-sm whitespace-pre-wrap text-slate-700">{detail.ai.draftBodyText}</pre> : null}
                    {detail.ai.scheduledMeetLink ? <div className="mt-2 text-xs text-slate-600">Meet link: <a className="underline" href={detail.ai.scheduledMeetLink} target="_blank" rel="noreferrer">{detail.ai.scheduledMeetLink}</a></div> : null}
                  </div>
                ) : null}

                <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
                  <div className="space-y-3 max-h-[54vh] overflow-y-auto pr-1">
                    {detail.timeline.map((it, idx) => {
                      const inbound = it.kind === "inbound";
                      return (
                        <div key={idx} className={`rounded-[1.6rem] border p-4 shadow-sm ${inbound ? "border-slate-200 bg-white" : "border-indigo-200 bg-indigo-50/70"}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-semibold text-slate-950 truncate">{inbound ? (it.from || "Inbound reply") : `You (${it.fromMailbox || "Mailbox"})`}</div>
                            <div className="text-xs text-slate-500">{formatDateTimeUTC(it.createdAt)}</div>
                          </div>
                          <div className="mt-1 text-sm text-slate-600">{it.subject || "(no subject)"}</div>
                          {it.bodyHtml ? <div className="email-body mt-4" dangerouslySetInnerHTML={{ __html: safeHtml(it.bodyHtml) }} /> : <pre className="mt-4 text-sm whitespace-pre-wrap text-slate-700 leading-6">{inbound ? (it.bodyText || it.snippet || "") : (it.bodyText || "")}</pre>}
                          {!inbound ? <div className="mt-3 text-xs text-slate-500">Status: {it.status}</div> : null}
                        </div>
                      );
                    })}
                    {detail.timeline.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No messages in this thread yet.</div> : null}
                  </div>

                  <aside className="space-y-3">
                    <div className="rounded-[1.5rem] border border-slate-200 bg-white/82 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-400 font-semibold">Suggested actions</div>
                      <div className="mt-3 flex flex-col gap-2">
                        {suggested.length ? suggested.map((s) => <Button key={s.key} variant="ghost" onClick={() => patchState(detail.lead.id, s.patch)}>{s.label}</Button>) : <div className="text-sm text-slate-500">No smart actions detected yet.</div>}
                      </div>
                    </div>
                    <div className="rounded-[1.5rem] border border-slate-200 bg-white/82 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-400 font-semibold">Labels</div>
                      <Input
                        className="mt-3"
                        key={detail.lead.id}
                        defaultValue={(detail.state.labels || []).join(", ")}
                        onBlur={(e) => {
                          const arr = (e.target.value || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 25);
                          patchState(detail.lead.id, { labels: arr });
                        }}
                        placeholder="interested, demo, pricing"
                      />
                      <div className="mt-2 text-xs text-slate-500">Separate labels with commas.</div>
                    </div>
                  </aside>
                </div>

                {composerOpen ? (
                  <div className="rounded-[1.6rem] border border-slate-200 bg-white/90 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-950">Reply composer</div>
                        <div className="text-xs text-slate-500">Send from the linked mailbox and keep the thread context.</div>
                      </div>
                      <Button variant="ghost" onClick={() => setComposerOpen(false)}>Close</Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Template</div>
                        <select
                          className="w-full px-3.5 py-2.5 rounded-2xl border border-slate-200/90 bg-white text-sm shadow-sm"
                          value=""
                          onChange={(e) => {
                            const id = e.target.value;
                            const tpl = templates.find((t) => t.id === id);
                            if (tpl) setComposeBody((prev) => (prev ? prev + "\n\n" : "") + tpl.body);
                            e.currentTarget.value = "";
                          }}
                        >
                          <option value="">Insert template…</option>
                          {templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Subject</div>
                        <Input value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} />
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 mt-3 mb-1">Message</div>
                    <TextArea value={composeBody} onChange={(e) => setComposeBody(e.target.value)} className="min-h-[190px]" />
                    <div className="flex items-center justify-end gap-2 mt-3">
                      <Button variant="ghost" onClick={() => setComposeBody("")}>Clear</Button>
                      <Button onClick={sendReply} disabled={composeSending || !composeBody.trim()}>{composeSending ? "Sending…" : "Send reply"}</Button>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
