"use client";

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { Badge, Button, Card, Input, Pill, Select, Modal, TextArea, Kpi, EmptyState } from "@/components/ui";
import { formatDateTimeUTC } from "@/lib/date";

type CampaignMini = { id: string; name: string; status: string };
type LeadViewRow = { id: string; name: string; payload: any; updatedAt?: string };

type MailboxMini = { id: string; name: string; fromEmail: string; isActive: boolean };

type CompanyVerifyState = {
  status: "idle" | "busy" | "valid" | "invalid" | "error";
  message?: string;
  riskScore?: number;
  riskFlags?: Record<string, unknown>;
};

function companyRiskTone(riskScore: number): "danger" | "warning" | "success" {
  if (riskScore >= 70) return "danger";
  if (riskScore >= 40) return "warning";
  return "success";
}

function renderCompanyRiskPill(verify?: CompanyVerifyState) {
  const riskScore = verify?.riskScore;
  if (typeof riskScore !== "number") return null;
  return <Pill tone={companyRiskTone(riskScore)}>Risk {riskScore}</Pill>;
}

function renderCompanyRiskFlags(verify?: CompanyVerifyState) {
  const riskFlags = verify?.riskFlags;
  if (!riskFlags) return null;
  const flags = Object.entries(riskFlags)
    .filter(([, v]) => !!v)
    .map(([k]) => String(k).replace(/([A-Z])/g, " $1").toLowerCase())
    .slice(0, 6)
    .join(", ") || "none";
  return <div className="text-xs opacity-60 mt-0.5">Flags: {flags}</div>;
}

export type LeadRow = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  website?: string | null;
  status: string;
  stage?: string;
  snoozeUntil?: string | null;
  snoozeReason?: string | null;
  owner?: null | { id: string; name?: string | null; email?: string | null };
  list?: null | { id: string; name: string };
  tags: string[];
  createdAt: string;
  enrollmentsCount: number;
  campaigns: CampaignMini[];
  nextTask?: null | { id: string; title: string; dueAt: string | null };
  lastActivity?: null | { type: string; text?: string | null; createdAt: string };
  lastMessage: null | {
    status: string;
    subject?: string | null;
    createdAt: string;
    sentAt?: string | null;
    campaign?: { id: string; name: string } | null;
    mailbox?: { id: string; fromEmail: string; name: string } | null;
  };
};

type ListResponse = {
  ok: boolean;
  page: number;
  pageSize: number;
  total: number;
  items: LeadRow[];
};

function fmtDate(iso?: string | null) {
  return formatDateTimeUTC(iso || undefined);
}

function toneForStatus(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  const s = String(status || "").toLowerCase();
  if (s === "replied") return "success";
  if (s === "unsubscribed") return "warning";
  if (s === "bounced") return "danger";
  if (s === "suppressed") return "danger";
  if (s === "active") return "info";
  return "neutral";
}

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}


export function LeadsClient() {
  // Filters
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [stage, setStage] = useState<string>("all");
  const [listId, setListId] = useState<string>("all");
  const [ownerUserId, setOwnerUserId] = useState<string>("all");
  const [tasksFilter, setTasksFilter] = useState<string>(""); // "" | overdue | due_7d | none
  const [tag, setTag] = useState<string>("");
  const [contacted, setContacted] = useState<string>(""); // "" | "1" | "0"
  // Snoozed leads are hidden by default
  const [snoozedFilter, setSnoozedFilter] = useState<string>("hide"); // hide | include | only

  // View mode
  const [viewMode, setViewMode] = useState<"table" | "kanban">("table");

  // Paging
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Data
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<LeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  // Selection
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const selectedIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected]);

  // Drawer
  const [drawerId, setDrawerId] = useState<string | null>(null);

  // Saved views (DB, shared per workspace)
  const [views, setViews] = useState<LeadViewRow[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  // Lists + owners (for bulk assign / move)
  const [lists, setLists] = useState<Array<{ id: string; name: string }>>([]);
  const [owners, setOwners] = useState<Array<{ id: string; name?: string | null; email?: string | null }>>([]);
  const [newListName, setNewListName] = useState<string>("");

  // Bulk helpers
  const [bulkBusy, setBulkBusy] = useState<boolean>(false);
  const [bulkStage, setBulkStage] = useState<string>("");
  const [bulkOwner, setBulkOwner] = useState<string>("");
  const [bulkList, setBulkList] = useState<string>("");
  const [bulkTaskTitle, setBulkTaskTitle] = useState<string>("");
  const [bulkTaskDueDate, setBulkTaskDueDate] = useState<string>(""); // YYYY-MM-DD
  const [showBulkTask, setShowBulkTask] = useState(false);

  // Bulk snooze
  const [showBulkSnooze, setShowBulkSnooze] = useState(false);
  const [bulkSnoozeUntil, setBulkSnoozeUntil] = useState<string>(""); // YYYY-MM-DD
  const [bulkSnoozeReason, setBulkSnoozeReason] = useState<string>("");

  // Modals
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showSuppressions, setShowSuppressions] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [showLists, setShowLists] = useState(false);
  const [showEnroll, setShowEnroll] = useState(false);
  const [showAiTags, setShowAiTags] = useState(false);
  const [showAiEnrich, setShowAiEnrich] = useState(false);
  const [showAiSegments, setShowAiSegments] = useState(false);
  const [showCompanyEnrich, setShowCompanyEnrich] = useState(false);

  // Enrich-by-website modal
  const [companyWebsiteUrl, setCompanyWebsiteUrl] = useState<string>("");
  const [companyEnrichBusy, setCompanyEnrichBusy] = useState<boolean>(false);
  const [companyEnrichResult, setCompanyEnrichResult] = useState<null | {
    website: string;
    matched: number;
    updated: number;
    discovered?: number;
    created?: number;
    note?: string;
    rationale?: string;
  }>(null);

  // Website "discovery" inside enrich-by-website modal
  const [companyDiscoverBusy, setCompanyDiscoverBusy] = useState<boolean>(false);
  const [companyDiscoverNote, setCompanyDiscoverNote] = useState<string>("");
  const [companyDiscovered, setCompanyDiscovered] = useState<Array<{
    email: string;
    sourceUrl: string;
    foundOnSite?: boolean;
    evidenceUrls?: string[];
    purpose?: string;
    recommended?: boolean;
    confidence?: number;
    notes?: string;
  }>>([]);
  const [companySuggested, setCompanySuggested] = useState<Array<{
    email: string;
    sourceUrl: string;
    foundOnSite?: boolean;
    evidenceUrls?: string[];
    purpose?: string;
    recommended?: boolean;
    confidence?: number;
    notes?: string;
  }>>([]);
  const [companyDiscoveredSel, setCompanyDiscoveredSel] = useState<Record<string, boolean>>({});
  const [companyIncludeSuggested, setCompanyIncludeSuggested] = useState<boolean>(false);
  const [companyOtherEmails, setCompanyOtherEmails] = useState<Array<{ email: string; sourceUrl: string }>>([]);
  const [companyContactForms, setCompanyContactForms] = useState<Array<{ url: string; sourceUrl: string }>>([]);
  // Manual email check/add inside website discovery (user-provided)
  const [companyManualEmail, setCompanyManualEmail] = useState<string>("");
  const [companyManualEmails, setCompanyManualEmails] = useState<Array<{
    email: string;
    sourceUrl: string;
    purpose?: string;
    recommended?: boolean;
    confidence?: number;
    notes?: string;
  }>>([]);
  // Email fallback generator (pattern-based suggestions when no email is found)
  const [companyFallbackFirst, setCompanyFallbackFirst] = useState<string>("");
  const [companyFallbackLast, setCompanyFallbackLast] = useState<string>("");
  const [companyGenerated, setCompanyGenerated] = useState<Array<{
    email: string;
    sourceUrl: string;
    purpose?: string;
    recommended?: boolean;
    confidence?: number;
    notes?: string;
  }>>([]);
  const [companyImportBusy, setCompanyImportBusy] = useState<boolean>(false);
  const [companyDiscoverDiag, setCompanyDiscoverDiag] = useState<any>(null);
  // Per-email verification state for AI-discovered emails (ping-email)
  const [companyVerifyMode, setCompanyVerifyMode] = useState<"smtp" | "no_smtp">("no_smtp");
  const [companyRequireMailbox, setCompanyRequireMailbox] = useState<boolean>(false);
  const [companyVerifyMap, setCompanyVerifyMap] = useState<Record<string, CompanyVerifyState>>({});
  // Only company-domain inboxes are importable (import endpoint filters by domain anyway).
  // Keep "other" emails selectable for reference/copy, but don't treat them as import candidates.
  const companyAllImportableEmails = useMemo(
    () => [...companyDiscovered, ...companySuggested, ...companyManualEmails, ...companyGenerated],
    [companyDiscovered, companySuggested, companyManualEmails, companyGenerated]
  );

  const discoveredSelected = useMemo(
    () => companyAllImportableEmails
      .filter((x) => !!companyDiscoveredSel[x.email])
      .map((x) => x.email),
    [companyAllImportableEmails, companyDiscoveredSel]
  );

  const discoveredValidSelected = useMemo(
    () => discoveredSelected.filter((e) => companyVerifyMap[e]?.status === "valid"),
    [discoveredSelected, companyVerifyMap]
  );

  const discoveredInvalidSelected = useMemo(
    () => discoveredSelected.filter((e) => ["invalid", "error"].includes(String(companyVerifyMap[e]?.status || ""))),
    [discoveredSelected, companyVerifyMap]
  );

  const discoveredPendingSelected = useMemo(
    () => discoveredSelected.filter((e) => !companyVerifyMap[e] || companyVerifyMap[e]?.status === "busy"),
    [discoveredSelected, companyVerifyMap]
  );

  const discoveredNotVerified = useMemo(
    () => discoveredSelected.filter((e) => companyVerifyMap[e]?.status !== "valid"),
    [discoveredSelected, companyVerifyMap]
  );

  const companyEmailStats = useMemo(() => {
    const emails = companyAllImportableEmails.map((x) => x.email);
    return {
      total: emails.length,
      selected: discoveredSelected.length,
      validSelected: discoveredValidSelected.length,
      invalidSelected: discoveredInvalidSelected.length,
      pendingSelected: discoveredPendingSelected.length,
      published: companyDiscovered.length,
      suggested: companySuggested.length,
      manual: companyManualEmails.length,
      generated: companyGenerated.length,
    };
  }, [companyAllImportableEmails, discoveredSelected.length, discoveredValidSelected.length, discoveredInvalidSelected.length, discoveredPendingSelected.length, companyDiscovered.length, companySuggested.length, companyManualEmails.length, companyGenerated.length]);

  const canImportDiscovered = discoveredValidSelected.length > 0 && !companyImportBusy;

  const companyManualNorm = useMemo(() => String(companyManualEmail || "").trim().toLowerCase(), [companyManualEmail]);

  // AI enrich modal
  const [aiEnrichHint, setAiEnrichHint] = useState<string>("");
  const [aiEnrichBusy, setAiEnrichBusy] = useState<boolean>(false);
  const [aiEnrichRationale, setAiEnrichRationale] = useState<string>("");
  const [aiEnrichRows, setAiEnrichRows] = useState<Array<{ id: string; firstName: string | null; lastName: string | null; company: string | null; website: string | null }>>([]);

  // AI segments modal
  const [aiSegmentsBusy, setAiSegmentsBusy] = useState<boolean>(false);
  const [aiSegments, setAiSegments] = useState<Array<{ name: string; description: string; payload: any }>>([]);

  // AI tags modal
  const [aiHint, setAiHint] = useState<string>("");
  const [aiTags, setAiTags] = useState<string>("");
  const [aiRationale, setAiRationale] = useState<string>("");
  const [aiBusy, setAiBusy] = useState<boolean>(false);

  // Add lead modal data
  const [mailboxes, setMailboxes] = useState<MailboxMini[]>([]);
  const [fEmail, setFEmail] = useState("");
  const [fFirstName, setFFirstName] = useState("");
  const [fLastName, setFLastName] = useState("");
  const [fCompany, setFCompany] = useState("");
  const [fWebsite, setFWebsite] = useState("");
  const [fTags, setFTags] = useState("");
  const [fStatus, setFStatus] = useState("active");
  const [fVerify, setFVerify] = useState(true);
  const [fVerifyMode, setFVerifyMode] = useState<"smtp" | "no_smtp">("smtp");
  const [fRequireMailbox, setFRequireMailbox] = useState(true);
  const [fSenderMailboxId, setFSenderMailboxId] = useState<string>("");

  // Allow deep-linking into a pre-filled search (e.g. from global search)
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const prefill = (sp.get("prefill") || "").trim();
      if (prefill) {
        setQ(prefill);
      }
    } catch {
      // ignore
    }
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enroll modal data
  const [campaigns, setCampaigns] = useState<CampaignMini[]>([]);
  const [enrollCampaignId, setEnrollCampaignId] = useState<string>("");

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);
  const pageStats = useMemo(() => {
    const pageTotal = items.length;
    const counts: Record<string, number> = {};
    for (const it of items) {
      const k = String(it.status || "unknown").toLowerCase();
      counts[k] = (counts[k] || 0) + 1;
    }
    return {
      total,
      pageTotal,
      selected: selectedIds.length,
      active: counts["active"] || 0,
      replied: counts["replied"] || 0,
      bounced: counts["bounced"] || 0,
      unsubscribed: counts["unsubscribed"] || 0,
      suppressed: counts["suppressed"] || 0,
    };
  }, [items, total, selectedIds.length]);

  function notify(msg: string) {
    const t = String(msg || "").trim();
    if (!t) return;
    if (t.startsWith("❌") || /(failed|error|invalid)/i.test(t)) {
      toast.error(t.replace(/^❌\s*/, ""));
      return;
    }
    if (t.startsWith("⚠️")) {
      toast.warning(t.replace(/^⚠️\s*/, ""));
      return;
    }
    toast.success(t.replace(/^✅\s*/, ""));
  }

  useEffect(() => {
    // reset selection when filters change
    setSelected({});
    setDrawerId(null);
  }, [q, status, stage, listId, ownerUserId, tasksFilter, tag, contacted, pageSize]);

  // Load saved views
  useEffect(() => {
    let cancelled = false;
    fetch("/api/leads/views", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return await r.json();
      })
      .then((d) => {
        if (cancelled) return;
        setViews(Array.isArray(d.views) ? d.views : []);
      })
      .catch(() => {
        // non-fatal (e.g. prisma not migrated yet)
        if (cancelled) return;
        setViews([]);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // Load lists + owners (best-effort; UI should still work if not migrated yet)
  useEffect(() => {
    let cancelled = false;
    fetch("/api/leads/lists", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return await r.json();
      })
      .then((d) => {
        if (cancelled) return;
        setLists(Array.isArray(d.lists) ? d.lists : []);
      })
      .catch(() => {
        if (cancelled) return;
        setLists([]);
      });

    fetch("/api/leads/owners", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return await r.json();
      })
      .then((d) => {
        if (cancelled) return;
        setOwners(Array.isArray(d.owners) ? d.owners : []);
      })
      .catch(() => {
        if (cancelled) return;
        setOwners([]);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // Load leads list
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status && status !== "all") params.set("status", status);
    if (stage && stage !== "all") params.set("stage", stage);
    if (listId && listId !== "all") params.set("listId", listId);
    if (ownerUserId && ownerUserId !== "all") params.set("ownerUserId", ownerUserId);
    if (tasksFilter) params.set("tasks", tasksFilter);
    if (tag.trim()) params.set("tag", tag.trim());
    if (contacted) params.set("contacted", contacted);
    if (snoozedFilter && snoozedFilter !== "hide") params.set("snoozed", snoozedFilter);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));

    fetch(`/api/leads/list?${params.toString()}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return (await r.json()) as ListResponse;
      })
      .then((d) => {
        if (cancelled) return;
        setItems(d.items || []);
        setTotal(d.total || 0);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setItems([]);
        setTotal(0);
        notify(`❌ Failed to load leads: ${clip(String(e?.message || e), 140)}`);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [q, status, stage, listId, ownerUserId, tasksFilter, tag, contacted, snoozedFilter, page, pageSize, refreshKey]);

  function toggleAll(on: boolean) {
    const next: Record<string, boolean> = {};
    for (const it of items) next[it.id] = on;
    setSelected(next);
  }

  function toggleOne(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function loadMailboxes() {
    try {
      const r = await fetch("/api/mailboxes/list", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      const mbs: MailboxMini[] = Array.isArray(d?.mailboxes)
        ? d.mailboxes.map((m: any) => ({
            id: String(m.id),
            name: String(m.name || m.fromEmail || "Mailbox"),
            fromEmail: String(m.fromEmail || ""),
            isActive: !!m.isActive,
          }))
        : [];
      setMailboxes(mbs);
    } catch {
      // ignore
      setMailboxes([]);
    }
  }

  function openAddModal() {
    setShowAdd(true);
    // load sender options (optional)
    loadMailboxes();
  }

  async function submitAddLead() {
    const payload = {
      email: fEmail.trim(),
      firstName: fFirstName.trim() || null,
      lastName: fLastName.trim() || null,
      company: fCompany.trim() || null,
      website: fWebsite.trim() || null,
      tags: fTags.trim() || null, // comma-separated
      status: fStatus || "active",
      verify: !!fVerify,
      verifyMode: fVerifyMode,
      requireMailbox: !!fRequireMailbox,
      senderMailboxId: fSenderMailboxId || null,
    };

    if (!payload.email) {
      notify("❌ Email is required");
      return;
    }

    setLoading(true);
    try {
      const r = await fetch("/api/leads/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const d = await r.json().catch(() => ({} as any));
      if (!r.ok || !d?.ok) {
        const msg = d?.message || d?.error || "Failed to add lead";
        notify(`❌ ${msg}`);
        return;
      }

      notify("✅ Lead added");
      setShowAdd(false);
      setFEmail("");
      setFFirstName("");
      setFLastName("");
      setFCompany("");
      setFWebsite("");
      setFTags("");
      setFStatus("active");
      setFVerify(true);
      setFVerifyMode("smtp");
      setFRequireMailbox(true);
      setFSenderMailboxId("");
      setSelected({});
      setDrawerId(null);
      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      notify(`❌ Failed to add lead: ${clip(String(e?.message || e), 140)}`);
    } finally {
      setLoading(false);
    }
  }

  function isoFromDateInputLocal(v: string): string | null {
    const t = String(v || "").trim();
    if (!t) return null;
    const d = new Date(t + "T09:00:00.000Z");
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function nextMondayISOLocal(): string {
    const now = new Date();
    const day = now.getUTCDay(); // 0=Sun
    const diff = (8 - day) % 7 || 7;
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff, 9, 0, 0));
    return target.toISOString();
  }

  function plusDaysISOLocal(days: number): string {
    const now = new Date();
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, 9, 0, 0));
    return target.toISOString();
  }

  async function bulk(
    action:
      | "tag_add"
      | "tag_remove"
      | "set_status"
      | "set_stage"
      | "assign_owner"
      | "move_list"
      | "create_task"
      | "verify_email"
      | "dnc"
      | "unsuppress"
      | "enroll_campaign"
      | "stop_campaigns"
      | "snooze"
      | "unsnooze"
      | "delete",
    payload: any = {},
    idsOverride?: string[]
  ) {
    const ids = idsOverride && idsOverride.length ? idsOverride : selectedIds;
    if (!ids.length) return;
    setLoading(true);
    try {
      const r = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action, ...payload }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(String(j?.error || `HTTP_${r.status}`));

      if (action === "verify_email") {
        const s = j?.summary;
        if (s) notify(`✅ Verified: ${s.valid}/${s.total} valid`);
        else notify("✅ Verified");
      } else {
        notify("✅ Updated");
      }
      setSelected({});
      setDrawerId(null);
      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      notify(`❌ Bulk action failed: ${clip(String(e?.message || e), 140)}`);
    } finally {
      setLoading(false);
    }
  }

  async function generateAiTags(hintOverride?: string) {
    if (!selectedIds.length) return;
    setAiBusy(true);
    setAiTags("");
    setAiRationale("");
    try {
      const r = await fetch("/api/leads/ai/suggest-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, maxTags: 10, hint: hintOverride ?? aiHint }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        throw new Error(String(j?.error || `HTTP_${r.status}`));
      }
      const tags = Array.isArray(j.tags) ? j.tags : [];
      setAiTags(tags.join(", "));
      setAiRationale(String(j.rationale || ""));
    } catch (e: any) {
      notify(`❌ AI tags failed: ${clip(String(e?.message || e), 140)}`);
    } finally {
      setAiBusy(false);
    }
  }

  function openAiTagsModal() {
    setShowAiTags(true);
    setAiHint("");
    setAiTags("");
    setAiRationale("");
    // fire and forget
    setTimeout(() => generateAiTags(""), 0);
  }

  async function applyAiTagsToSelection() {
    const t = String(aiTags || "").trim();
    if (!t) {
      notify("⚠️ No tags to apply");
      return;
    }
    setShowAiTags(false);
    await bulk("tag_add", { tags: t });
  }

  async function generateAiEnrich(hintOverride?: string) {
    if (!selectedIds.length) return;
    setAiEnrichBusy(true);
    setAiEnrichRows([]);
    setAiEnrichRationale("");
    try {
      const r = await fetch("/api/leads/ai/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, hint: hintOverride ?? aiEnrichHint }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(String(j?.message || j?.error || `HTTP_${r.status}`));
      const rows = Array.isArray(j.leads) ? j.leads : [];
      setAiEnrichRows(
        rows.map((x: any) => ({
          id: String(x.id),
          firstName: x.firstName ?? null,
          lastName: x.lastName ?? null,
          company: x.company ?? null,
          website: x.website ?? null,
        }))
      );
      setAiEnrichRationale(String(j.rationale || ""));
    } catch (e: any) {
      notify(`❌ AI enrich failed: ${clip(String(e?.message || e), 140)}`);
    } finally {
      setAiEnrichBusy(false);
    }
  }

  function openAiEnrichModal() {
    setShowAiEnrich(true);
    setAiEnrichHint("");
    setAiEnrichRows([]);
    setAiEnrichRationale("");
    setTimeout(() => generateAiEnrich(""), 0);
  }

  async function applyAiEnrichToSelection() {
    const updates = aiEnrichRows
      .map((r) => ({
        id: r.id,
        firstName: r.firstName,
        lastName: r.lastName,
        company: r.company,
        website: r.website,
      }))
      .filter((u) => Boolean(u.firstName || u.lastName || u.company || u.website));

    if (!updates.length) {
      notify("⚠️ No enrichment to apply");
      return;
    }

    setLoading(true);
    try {
      const r = await fetch("/api/leads/patch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overwrite: false, updates }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(String(j?.message || j?.error || `HTTP_${r.status}`));
      notify(`✅ Enriched ${j.updated || updates.length} leads (filled missing only)`);
      setShowAiEnrich(false);
      setSelected({});
      setDrawerId(null);
      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      notify(`❌ Apply enrich failed: ${clip(String(e?.message || e), 140)}`);
    } finally {
      setLoading(false);
    }
  }

  async function generateAiSegments() {
    setAiSegmentsBusy(true);
    setAiSegments([]);
    try {
      const r = await fetch("/api/leads/ai/suggest-views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(String(j?.message || j?.error || `HTTP_${r.status}`));
      const views = Array.isArray(j.views) ? j.views : [];
      setAiSegments(views.map((v: any) => ({ name: String(v.name || ""), description: String(v.description || ""), payload: v.payload || {} })));
    } catch (e: any) {
      notify(`❌ AI segments failed: ${clip(String(e?.message || e), 140)}`);
    } finally {
      setAiSegmentsBusy(false);
    }
  }

  function openAiSegmentsModal() {
    setShowAiSegments(true);
    setAiSegments([]);
    setTimeout(() => generateAiSegments(), 0);
  }

  function openCompanyEnrichModal() {
    setShowCompanyEnrich(true);
    setCompanyWebsiteUrl("");
    setCompanyEnrichResult(null);
    setCompanyDiscoverBusy(false);
    setCompanyDiscoverNote("");
    setCompanyDiscovered([]);
    setCompanySuggested([]);
    setCompanyManualEmail("");
    setCompanyManualEmails([]);
    setCompanyDiscoveredSel({});
    setCompanyIncludeSuggested(false);
    setCompanyImportBusy(false);
    setCompanyDiscoverDiag(null);
  }

  async function runCompanyDiscover() {
    const u = String(companyWebsiteUrl || "").trim();
    if (!u) {
      notify("⚠️ Enter a website URL first");
      return;
    }
    setCompanyDiscoverBusy(true);
    setCompanyDiscoverNote("");
    setCompanyDiscovered([]);
    setCompanySuggested([]);
    setCompanyManualEmail("");
    setCompanyManualEmails([]);
    setCompanyDiscoveredSel({});
    setCompanyOtherEmails([]);
    setCompanyContactForms([]);
    setCompanyDiscoverDiag(null);
    try {
      const r = await fetch("/api/leads/ai/discover-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ websiteUrl: u, includeSuggested: companyIncludeSuggested }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(String(j?.message || j?.error || `HTTP_${r.status}`));

      // Keep diagnostics for cases where the site blocks fetch/headless.
      setCompanyDiscoverDiag({
        scanned: Number(j.scanned || 0),
        deepMode: j.deepMode || null,
        attemptedUrls: Array.isArray(j.attemptedUrls) ? j.attemptedUrls : [],
        failures: Array.isArray(j.failures) ? j.failures : [],
      });
      const other = Array.isArray(j.otherEmails) ? j.otherEmails : [];
      const forms = Array.isArray(j.contactForms) ? j.contactForms : [];
      setCompanyOtherEmails(other.map((x: any) => ({ email: String(x.email || "").toLowerCase(), sourceUrl: String(x.sourceUrl || "") })).filter((x: any) => x.email && x.sourceUrl));
      setCompanyContactForms(forms.map((x: any) => ({ url: String(x.url || ""), sourceUrl: String(x.sourceUrl || "") })).filter((x: any) => x.url));

      const rows = [...(Array.isArray(j.emails) ? j.emails : [])];
      const mapped = rows
        .map((x: any) => ({
          email: String(x.email || "").toLowerCase(),
          sourceUrl: String(x.sourceUrl || ""),
          foundOnSite: Boolean(x.foundOnSite),
          evidenceUrls: Array.isArray(x.evidenceUrls) ? x.evidenceUrls.map((u: any) => String(u || "")).filter(Boolean) : [],
          purpose: String(x.purpose || ""),
          recommended: Boolean(x.recommended),
          confidence: typeof x.confidence === "number" ? Number(x.confidence) : undefined,
          notes: String(x.notes || ""),
        }))
        .filter((x: any) => x.email && x.sourceUrl);
      setCompanyDiscovered(mapped);

      const sug = [...(Array.isArray(j.suggested) ? j.suggested : [])];
      const mappedSug = sug
        .map((x: any) => ({
          email: String(x.email || "").toLowerCase(),
          sourceUrl: String(x.sourceUrl || ""),
          foundOnSite: Boolean(x.foundOnSite),
          evidenceUrls: Array.isArray(x.evidenceUrls) ? x.evidenceUrls.map((u: any) => String(u || "")).filter(Boolean) : [],
          purpose: String(x.purpose || ""),
          recommended: Boolean(x.recommended),
          confidence: typeof x.confidence === "number" ? Number(x.confidence) : undefined,
          notes: String(x.notes || ""),
        }))
        .filter((x: any) => x.email && x.sourceUrl);
      setCompanySuggested(mappedSug);
      setCompanyDiscoverNote(String(j.note || ""));
      // Don't auto-select anything. User should explicitly choose which inboxes to verify + import.
      setCompanyDiscoveredSel({});
      // Reset verification results whenever we run a new discovery
      setCompanyVerifyMap({});
      const foundCount = mapped.length;
      const sugCount = mappedSug.length;
      const otherCount = Array.isArray(j.otherEmails) ? j.otherEmails.length : 0;
      const formCount = Array.isArray(j.contactForms) ? j.contactForms.length : 0;
      const parts: string[] = [];
      if (foundCount) parts.push(`${foundCount} published email${foundCount === 1 ? "" : "s"}`);
      if (sugCount) parts.push(`${sugCount} AI suggested`);
      if (otherCount) parts.push(`${otherCount} other-domain`);
      if (formCount) parts.push(`${formCount} contact form${formCount === 1 ? "" : "s"}`);
      notify(parts.length ? `✅ Found ${parts.join(" · ")}` : `ℹ️ No emails found`);
    } catch (e: any) {
      notify(`❌ Discover failed: ${clip(String(e?.message || e), 140)}`);
    } finally {
      setCompanyDiscoverBusy(false);
    }
  }

  function addManualCompanyEmail(rawEmail: string) {
    const e = String(rawEmail || "").trim().toLowerCase();
    if (!e) {
      notify("⚠️ Enter an email to add");
      return;
    }

    // Only allow adding after it's verified as valid
    if (companyVerifyMap[e]?.status !== "valid") {
      notify("⚠️ Please verify the email first (needs to be ✅ Valid)");
      return;
    }

    const exists = [...companyDiscovered, ...companySuggested, ...companyManualEmails, ...companyGenerated].some((x) => String(x.email || "").toLowerCase() === e);
    if (!exists) {
      setCompanyManualEmails((arr) => [{
        email: e,
        sourceUrl: "manual",
        purpose: "manual",
        recommended: true,
        confidence: 1,
        notes: "Manually added by user",
      }, ...arr]);
    }
    setCompanyDiscoveredSel((m) => ({ ...m, [e]: true }));
    notify(exists ? "ℹ️ Already in list (selected)" : "✅ Added to import list");
  }

  async function verifyCompanyEmail(email: string) {
    const e = String(email || "").trim().toLowerCase();
    if (!e) return;
    setCompanyVerifyMap((m) => ({ ...m, [e]: { status: "busy", message: "" } }));
    try {
      const r = await fetch("/api/leads/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: e,
          verifyMode: companyVerifyMode,
          requireMailbox: companyRequireMailbox,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(String(j?.message || j?.error || `HTTP_${r.status}`));
      const valid = Boolean(j.valid);
      const message = String(j.message || "").trim();
      const riskScore = Number(j?.risk?.score || 0);
      const riskFlags = j?.risk?.flags || null;
      setCompanyVerifyMap((m) => ({
        ...m,
        [e]: { status: valid ? "valid" : "invalid", message, riskScore, riskFlags },
      }));
    } catch (err: any) {
      const msg = clip(String(err?.message || err || "Verification failed"), 180);
      setCompanyVerifyMap((m) => ({ ...m, [e]: { status: "error", message: msg } }));
    }
  }

  async function verifySelectedCompanyEmails() {
    const list = discoveredSelected;
    if (!list.length) {
      notify("⚠️ Select at least one email first");
      return;
    }
    // Verify sequentially (avoids SMTP rate spikes). Re-verify anything that's not already valid.
    for (const e of list) {
      if (companyVerifyMap[e]?.status === "valid") continue;
      // eslint-disable-next-line no-await-in-loop
      await verifyCompanyEmail(e);
    }
  }

  async function importDiscoveredEmails() {
    const u = String(companyWebsiteUrl || "").trim();
    if (!u) {
      notify("⚠️ Enter a website URL first");
      return;
    }
    const emails = discoveredValidSelected;
    if (!discoveredSelected.length) {
      notify("⚠️ Select at least one email to import");
      return;
    }

    if (!emails.length) {
      notify("⚠️ No verified-valid selected emails to import yet. Click Verify selected first.");
      return;
    }

    if (discoveredNotVerified.length) {
      notify(`ℹ️ Importing ${emails.length} valid email${emails.length === 1 ? "" : "s"}; skipping ${discoveredNotVerified.length} pending/failed selected item${discoveredNotVerified.length === 1 ? "" : "s"}.`);
    }

    setCompanyImportBusy(true);
    try {
      const r = await fetch("/api/leads/ai/import-discovered", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ websiteUrl: u, emails }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(String(j?.message || j?.error || `HTTP_${r.status}`));
      const created = Number(j.created || 0);
      const skipped = Number(j.skipped || 0);
      const skippedSuppressed = Number(j.skippedSuppressed || 0);
      const enriched = Number(j.enriched || 0);
      notify(`✅ Imported ${created} valid lead${created === 1 ? "" : "s"} (skipped ${skipped} duplicates${skippedSuppressed ? `, ${skippedSuppressed} suppressed` : ""}) · enriched ${enriched}`);
      setCompanyDiscoveredSel((m) => {
        const next = { ...m };
        for (const e of emails) delete next[e];
        return next;
      });
      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      notify(`❌ Import failed: ${clip(String(e?.message || e), 140)}`);
    } finally {
      setCompanyImportBusy(false);
    }
  }

  async function runCompanyEnrich() {
    const u = String(companyWebsiteUrl || "").trim();
    if (!u) {
      notify("⚠️ Enter a website URL first");
      return;
    }

    setCompanyEnrichBusy(true);
    setCompanyEnrichResult(null);
    try {
      const r = await fetch("/api/leads/ai/enrich-by-website", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ websiteUrl: u, discover: true }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(String(j?.message || j?.error || `HTTP_${r.status}`));

      setCompanyEnrichResult({
        website: String(j.website || ""),
        matched: Number(j.matched || 0),
        updated: Number(j.updated || 0),
        created: Number(j.created || 0),
        discovered: Number(j.discovered || 0),
        note: String(j.note || ""),
        rationale: String(j.rationale || ""),
      });

      // Refresh list to show updates
      setRefreshKey((k) => k + 1);
      notify(`✅ Company enrich: ${Number(j.updated || 0)} updated · ${Number(j.created || 0)} new leads · ${Number(j.discovered || 0)} discovered`);
    } catch (e: any) {
      notify(`❌ Company enrich failed: ${clip(String(e?.message || e), 140)}`);
    } finally {
      setCompanyEnrichBusy(false);
    }
  }

  async function saveSuggestedView(name: string, payload: any) {
    try {
      const r = await fetch("/api/leads/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, payload }),
      });
      if (!r.ok) throw new Error(await r.text());
      notify("✅ View saved (shared)");
      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      notify(`❌ Failed to save view: ${clip(String(e?.message || e), 140)}`);
    }
  }

  async function saveCurrentView() {
    const name = prompt("Save view name:", "My View");
    if (!name) return;
    const payload = { q, status, tag, contacted, pageSize };
    try {
      const r = await fetch("/api/leads/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, payload }),
      });
      if (!r.ok) throw new Error(await r.text());
      notify("✅ View saved (shared)" );
      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      notify(`❌ Failed to save view: ${clip(String(e?.message || e), 140)}`);
    }
  }

  async function deleteActiveView() {
    if (!activeViewId) return;
    if (!confirm("Delete this saved view for the whole workspace?")) return;
    try {
      const r = await fetch(`/api/leads/views/${encodeURIComponent(activeViewId)}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
      notify("✅ View deleted");
      setActiveViewId(null);
      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      notify(`❌ Failed to delete view: ${clip(String(e?.message || e), 140)}`);
    }
  }

  function applyViewPayload(payload: any, viewId?: string | null) {
    setActiveViewId(viewId || null);
    setQ(String(payload?.q || ""));
    setStatus(String(payload?.status || "all"));
    setTag(String(payload?.tag || ""));
    setContacted(String(payload?.contacted || ""));
    setPageSize(Number(payload?.pageSize || 50));
    setPage(1);
  }

  async function openEnrollModal() {
    setShowEnroll(true);
    setEnrollCampaignId("");
    try {
      const r = await fetch("/api/campaigns/list", { cache: "no-store" });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      setCampaigns(Array.isArray(d.campaigns) ? d.campaigns : []);
    } catch {
      setCampaigns([]);
    }
  }

  const allChecked = items.length > 0 && items.every((it) => !!selected[it.id]);

  const presets = [
    { id: "preset_all", name: "All", payload: { q: "", status: "all", tag: "", contacted: "", pageSize } },
    { id: "preset_active", name: "Active", payload: { q: "", status: "active", tag: "", contacted: "", pageSize } },
    { id: "preset_replied", name: "Replied", payload: { q: "", status: "replied", tag: "", contacted: "", pageSize } },
    { id: "preset_unsub", name: "Unsubscribed", payload: { q: "", status: "unsubscribed", tag: "", contacted: "", pageSize } },
    { id: "preset_bounced", name: "Bounced", payload: { q: "", status: "bounced", tag: "", contacted: "", pageSize } },
    { id: "preset_supp", name: "Suppressed", payload: { q: "", status: "suppressed", tag: "", contacted: "", pageSize } },
    { id: "preset_not_contacted", name: "Not contacted", payload: { q: "", status: "all", tag: "", contacted: "0", pageSize } },
  ];

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-gradient-to-br from-indigo-600 via-violet-600 to-sky-500 p-5 sm:p-6 text-white shadow-2xl shadow-indigo-200/60">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/20 blur-3xl" />
        <div className="absolute -left-24 bottom-0 h-64 w-64 rounded-full bg-cyan-300/20 blur-3xl" />
        <div className="relative grid gap-5 xl:grid-cols-[1.15fr_0.85fr] xl:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-white/90 backdrop-blur">
              ✨ Lead Command Center
            </div>
            <h1 className="mt-4 text-3xl sm:text-4xl font-semibold tracking-tight">Leads</h1>
            <p className="mt-2 max-w-3xl text-sm sm:text-base text-white/80">
              Search, enrich, verify, segment, bulk-edit, and move prospects into campaigns from one polished workspace.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button variant="secondary" className="bg-white text-indigo-700 border-white/30 hover:bg-white/90" onClick={openAddModal}>
                + Add lead
              </Button>
              <Button variant="ghost" className="bg-white/15 text-white border-white/25 hover:bg-white/25" onClick={() => setShowImport(true)}>
                Import wizard
              </Button>
              <Button variant="ghost" className="bg-white/15 text-white border-white/25 hover:bg-white/25" onClick={openCompanyEnrichModal}>
                ✨ Enrich by website
              </Button>
              <Button variant="ghost" className="bg-white/15 text-white border-white/25 hover:bg-white/25" onClick={openAiSegmentsModal}>
                ✨ AI segments
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-2">
            {[
              { label: "Total", value: pageStats.total, hint: "all leads" },
              { label: "Active", value: pageStats.active, hint: "ready to work" },
              { label: "Replied", value: pageStats.replied, hint: "warm conversations" },
              { label: "Selected", value: pageStats.selected, hint: "bulk actions" },
            ].map((m) => (
              <div key={m.label} className="rounded-3xl border border-white/20 bg-white/15 p-4 backdrop-blur-xl shadow-lg shadow-black/5">
                <div className="text-xs uppercase tracking-[0.18em] text-white/65">{m.label}</div>
                <div className="mt-1 text-3xl font-semibold">{m.value}</div>
                <div className="text-xs text-white/65">{m.hint}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="rounded-[1.5rem] border border-slate-200 bg-white/80 p-4 shadow-sm backdrop-blur sticky top-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-slate-900">Workspace</div>
                <div className="text-xs text-slate-500">Views and tools</div>
              </div>
              <Badge>{loading ? "Loading…" : `${total} leads`}</Badge>
            </div>

            <div className="mt-4 grid gap-2">
              <Button variant="primary" className="w-full justify-center" onClick={openAddModal}>+ Add lead</Button>
              <Button variant="ghost" className="w-full justify-center" onClick={() => setShowImport(true)}>Import wizard</Button>
              <Button variant="ghost" className="w-full justify-center" onClick={() => setShowLists(true)}>Lists</Button>
              <Button variant="ghost" className="w-full justify-center" onClick={() => setShowDuplicates(true)}>Duplicates</Button>
              <Button variant="ghost" className="w-full justify-center" onClick={() => setShowSuppressions(true)}>Suppressions</Button>
            </div>

            <div className="mt-5 border-t border-slate-200 pt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Quick views</div>
              <div className="flex flex-wrap gap-2">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => applyViewPayload(p.payload, null)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            {views.length ? (
              <div className="mt-5 border-t border-slate-200 pt-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Saved views</div>
                  <button className="text-xs text-indigo-600 hover:text-indigo-700" onClick={saveCurrentView}>Save</button>
                </div>
                <div className="grid gap-2">
                  {views.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => applyViewPayload(v.payload, v.id)}
                      className={`rounded-2xl border px-3 py-2 text-left text-sm transition ${activeViewId === v.id ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"}`}
                    >
                      {v.name}
                    </button>
                  ))}
                </div>
                {activeViewId ? (
                  <Button variant="danger" className="mt-3 w-full" onClick={deleteActiveView}>Delete active view</Button>
                ) : null}
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                Save a filtered view to reuse it with your team.
                <button className="mt-2 block font-semibold text-indigo-600" onClick={saveCurrentView}>Save current view →</button>
              </div>
            )}
          </div>
        </aside>

        <main className="min-w-0 space-y-4">
          <Card className="overflow-hidden rounded-[1.5rem] border border-slate-200/80 bg-white/85 shadow-xl shadow-slate-200/70" title="Pipeline overview" subtitle="Live health of this page and your current filters.">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Kpi label="Total leads" value={pageStats.total} />
              <Kpi label="On page" value={pageStats.pageTotal} tone="info" />
              <Kpi label="Selected" value={pageStats.selected} tone={pageStats.selected ? "warning" : "neutral"} />
              <Kpi label="Active" value={pageStats.active} tone="info" />
              <Kpi label="Replied" value={pageStats.replied} tone="success" />
              <Kpi label="Bounced" value={pageStats.bounced} tone={pageStats.bounced ? "danger" : "neutral"} />
            </div>
          </Card>

          <Card className="rounded-[1.5rem] border border-slate-200/80 bg-white/90 shadow-xl shadow-slate-200/70" title="Find and focus" subtitle="Filters are grouped so the table stays calm, even when the workflow gets busy." right={
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={saveCurrentView}>Save view</Button>
              <Select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="h-10 min-w-[140px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
              >
                <option value={50}>50 / page</option>
                <option value={100}>100 / page</option>
                <option value={200}>200 / page</option>
              </Select>
            </div>
          }>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
              <div className="lg:col-span-5">
                <div className="text-xs font-medium text-slate-500 mb-1">Search leads</div>
                <Input className="h-12 text-base" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); setActiveViewId(null); }} placeholder="email, name, company, website, tags…" />
              </div>
              <div className="lg:col-span-2">
                <div className="text-xs font-medium text-slate-500 mb-1">Status</div>
                <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); setActiveViewId(null); }} className="h-12">
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="replied">Replied</option>
                  <option value="unsubscribed">Unsubscribed</option>
                  <option value="bounced">Bounced</option>
                  <option value="suppressed">Suppressed (DNC)</option>
                </Select>
              </div>
              <div className="lg:col-span-2">
                <div className="text-xs font-medium text-slate-500 mb-1">Stage</div>
                <Select value={stage} onChange={(e) => { setStage(e.target.value); setPage(1); setActiveViewId(null); }} className="h-12">
                  <option value="all">All stages</option>
                  <option value="new">New</option>
                  <option value="enriched">Enriched</option>
                  <option value="verified">Verified</option>
                  <option value="ready">Ready</option>
                  <option value="contacted">Contacted</option>
                  <option value="replied">Replied</option>
                  <option value="interested">Interested</option>
                  <option value="not_fit">Not fit</option>
                </Select>
              </div>
              <div className="lg:col-span-2">
                <div className="text-xs font-medium text-slate-500 mb-1">Contacted</div>
                <Select value={contacted} onChange={(e) => { setContacted(e.target.value); setPage(1); setActiveViewId(null); }} className="h-12">
                  <option value="">Any</option>
                  <option value="1">Contacted</option>
                  <option value="0">Not contacted</option>
                </Select>
              </div>
              <div className="lg:col-span-1 flex items-end">
                <Button
                  variant="ghost"
                  className="h-12 w-full"
                  onClick={() => {
                    setQ(""); setStatus("all"); setStage("all"); setListId("all"); setOwnerUserId("all"); setTasksFilter(""); setTag(""); setContacted(""); setPage(1); setActiveViewId(null);
                  }}
                >
                  Reset
                </Button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
              <div>
                <div className="text-xs font-medium text-slate-500 mb-1">List</div>
                <Select value={listId} onChange={(e) => { setListId(e.target.value); setPage(1); setActiveViewId(null); }} className="h-11">
                  <option value="all">All lists</option>
                  {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500 mb-1">Owner</div>
                <Select value={ownerUserId} onChange={(e) => { setOwnerUserId(e.target.value); setPage(1); setActiveViewId(null); }} className="h-11">
                  <option value="all">All owners</option>
                  {owners.map((u) => <option key={u.id} value={u.id}>{u.name || u.email || u.id}</option>)}
                </Select>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500 mb-1">Tasks</div>
                <Select value={tasksFilter} onChange={(e) => { setTasksFilter(e.target.value); setPage(1); setActiveViewId(null); }} className="h-11">
                  <option value="">Any tasks</option>
                  <option value="overdue">Overdue</option>
                  <option value="due_7d">Due in 7 days</option>
                  <option value="none">No open tasks</option>
                </Select>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500 mb-1">Tag contains</div>
                <Input value={tag} onChange={(e) => { setTag(e.target.value); setPage(1); setActiveViewId(null); }} placeholder="e.g. saas" className="h-11" />
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500 mb-1">Snooze</div>
                <Select value={snoozedFilter} onChange={(e) => { setSnoozedFilter(e.target.value); setPage(1); setActiveViewId(null); }} className="h-11">
                  <option value="hide">Hide snoozed</option>
                  <option value="include">Include snoozed</option>
                  <option value="only">Only snoozed</option>
                </Select>
              </div>
            </div>
          </Card>

          <Card className="rounded-[1.5rem] border border-slate-200/80 bg-white/95 shadow-xl shadow-slate-200/70" title="Lead list" subtitle="Clean table for scanning. Use the drawer for deeper timeline, messages, and campaign history." right={
            <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
              <button className={`rounded-xl px-4 py-2 text-sm font-medium transition ${viewMode === "table" ? "bg-slate-950 text-white shadow" : "text-slate-600 hover:text-slate-900"}`} onClick={() => setViewMode("table")}>Table</button>
              <button className={`rounded-xl px-4 py-2 text-sm font-medium transition ${viewMode === "kanban" ? "bg-slate-950 text-white shadow" : "text-slate-600 hover:text-slate-900"}`} onClick={() => setViewMode("kanban")}>Kanban</button>
            </div>
          }>
            {selectedIds.length ? (
              <div className="mb-4 overflow-hidden rounded-3xl border border-indigo-200 bg-gradient-to-r from-indigo-50 via-white to-sky-50 p-3 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{selectedIds.length} selected</div>
                    <div className="text-xs text-slate-500">Choose a bulk action without losing your place.</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="primary" onClick={openAiTagsModal}>✨ AI tags</Button>
                    <Button variant="ghost" onClick={openAiEnrichModal}>✨ AI enrich</Button>
                    <Button variant="ghost" disabled={bulkBusy} onClick={async () => {
                      const hint = prompt("Optional hint for enrichment (e.g. ICP/job titles to focus on):", "") ?? null;
                      if (hint === null) return;
                      const overwrite = confirm("Overwrite existing first/last/company/website fields if AI suggests changes?\n\nOK = overwrite\nCancel = fill only missing fields");
                      try {
                        setBulkBusy(true);
                        const r = await fetch("/api/leads/ai/enrich-apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: selectedIds, hint, overwrite }) });
                        if (!r.ok) throw new Error(await r.text());
                        const d = await r.json();
                        notify(`✅ Enriched ${d.updated ?? selectedIds.length} leads`);
                        setRefreshKey((k) => k + 1);
                      } catch (e: any) {
                        notify(`❌ Bulk enrich failed: ${clip(String(e?.message || e), 140)}`);
                      } finally { setBulkBusy(false); }
                    }}>{bulkBusy ? "Enriching…" : "⚡ Bulk enrich"}</Button>
                    <Button variant="ghost" onClick={() => bulk("verify_email", { verifyMode: "no_smtp", requireMailbox: false })}>Verify emails</Button>
                    <Button variant="ghost" onClick={() => { setBulkTaskTitle(""); setBulkTaskDueDate(""); setShowBulkTask(true); }}>+ Task</Button>
                    <Button variant="ghost" onClick={() => { setBulkSnoozeUntil(plusDaysISOLocal(3).slice(0, 10)); setBulkSnoozeReason(""); setShowBulkSnooze(true); }}>Snooze</Button>
                    <Button variant="ghost" onClick={openEnrollModal}>Add to campaign</Button>
                    <Button variant="danger" onClick={() => { if (confirm("Mark selected leads as DNC (suppressed)?")) bulk("dnc", { reason: "manual" }); }}>DNC</Button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 lg:grid-cols-3">
                  <div className="flex gap-2">
                    <Select value={bulkStage} onChange={(e) => setBulkStage(e.target.value)} className="h-10">
                      <option value="">Set stage…</option>
                      <option value="new">New</option><option value="enriched">Enriched</option><option value="verified">Verified</option><option value="ready">Ready</option><option value="contacted">Contacted</option><option value="replied">Replied</option><option value="interested">Interested</option><option value="not_fit">Not fit</option>
                    </Select>
                    <Button variant="ghost" disabled={!bulkStage} onClick={() => bulk("set_stage", { stage: bulkStage })}>Apply</Button>
                  </div>
                  <div className="flex gap-2">
                    <Select value={bulkOwner} onChange={(e) => setBulkOwner(e.target.value)} className="h-10">
                      <option value="">Assign owner…</option><option value="__clear__">(Clear)</option>{owners.map((u) => <option key={u.id} value={u.id}>{u.name || u.email || u.id}</option>)}
                    </Select>
                    <Button variant="ghost" disabled={!bulkOwner} onClick={() => bulk("assign_owner", { ownerUserId: bulkOwner === "__clear__" ? "" : bulkOwner })}>Apply</Button>
                  </div>
                  <div className="flex gap-2">
                    <Select value={bulkList} onChange={(e) => setBulkList(e.target.value)} className="h-10">
                      <option value="">Move to list…</option><option value="__clear__">(Remove)</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </Select>
                    <Button variant="ghost" disabled={!bulkList} onClick={() => bulk("move_list", { listId: bulkList === "__clear__" ? "" : bulkList })}>Apply</Button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="ghost" onClick={() => { if (confirm("Unsnooze selected leads?")) bulk("unsnooze"); }}>Unsnooze</Button>
                  <Button variant="ghost" onClick={() => { const t = prompt("Add tags (comma separated):", ""); if (t === null) return; bulk("tag_add", { tags: t }); }}>+ Tag</Button>
                  <Button variant="ghost" onClick={() => { const t = prompt("Remove tags (comma separated):", ""); if (t === null) return; bulk("tag_remove", { tags: t }); }}>− Tag</Button>
                  <Button variant="ghost" onClick={() => { const s = prompt("Set status (active/replied/unsubscribed/bounced/suppressed):", "active"); if (s === null) return; bulk("set_status", { status: s }); }}>Set status</Button>
                  <Button variant="ghost" onClick={() => { if (confirm("Stop ALL campaign enrollments for selected leads?")) bulk("stop_campaigns"); }}>Stop campaigns</Button>
                  <Button variant="ghost" onClick={async () => {
                    try {
                      const r = await fetch("/api/leads/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: selectedIds }) });
                      if (!r.ok) throw new Error(await r.text());
                      const blob = await r.blob(); const url = URL.createObjectURL(blob); const a = document.createElement("a");
                      a.href = url; a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
                    } catch (e: any) { notify(`❌ Export failed: ${clip(String(e?.message || e), 140)}`); }
                  }}>Export CSV</Button>
                  <Button variant="ghost" onClick={() => { if (confirm("Unsuppress selected leads (remove from suppression list)?")) bulk("unsuppress"); }}>Unsuppress</Button>
                  <Button variant="danger" onClick={() => { if (confirm("Delete selected leads? This cannot be undone.")) bulk("delete"); }}>Delete</Button>
                </div>
              </div>
            ) : null}

            {viewMode === "kanban" ? (
              <KanbanBoard items={items} selected={selected} onToggleOne={toggleOne} onOpen={(id) => setDrawerId(id)} onMoveStage={async (id, st) => { await bulk("set_stage", { stage: st }, [id]); }} />
            ) : (
              <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="min-w-[1120px] w-full text-sm">
                    <thead className="bg-slate-50/90 text-xs uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-4 py-4 text-left w-[48px]"><input type="checkbox" checked={allChecked} onChange={(e) => toggleAll(e.target.checked)} /></th>
                        <th className="px-4 py-4 text-left">Lead</th>
                        <th className="px-4 py-4 text-left">Company</th>
                        <th className="px-4 py-4 text-left">Stage</th>
                        <th className="px-4 py-4 text-left">Owner</th>
                        <th className="px-4 py-4 text-left">List</th>
                        <th className="px-4 py-4 text-left">Tags</th>
                        <th className="px-4 py-4 text-left">Status</th>
                        <th className="px-4 py-4 text-left">Campaigns</th>
                        <th className="px-4 py-4 text-left">Next task</th>
                        <th className="px-4 py-4 text-left">Last activity</th>
                        <th className="px-4 py-4 text-left">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map((it) => {
                        const name = [it.firstName, it.lastName].filter(Boolean).join(" ");
                        const company = it.company || "—";
                        const last = it.lastMessage;
                        const lastLine = it.lastActivity?.text || (last ? `${last.status}${last.campaign?.name ? ` • ${last.campaign.name}` : ""}` : "—");
                        const lastAt = it.lastActivity?.createdAt || last?.sentAt || last?.createdAt || it.createdAt;
                        const snoozed = !!(it.snoozeUntil && new Date(it.snoozeUntil).getTime() > Date.now());
                        const initial = (name || it.email || "?").trim().slice(0, 1).toUpperCase();
                        return (
                          <tr key={it.id} className={`transition hover:bg-indigo-50/35 ${selected[it.id] ? "bg-indigo-50/50" : "bg-white"}`}>
                            <td className="px-4 py-4 align-top"><input type="checkbox" checked={!!selected[it.id]} onChange={() => toggleOne(it.id)} /></td>
                            <td className="px-4 py-4 align-top">
                              <div className="flex min-w-[250px] items-start gap-3">
                                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-100 to-sky-100 text-sm font-semibold text-indigo-700">{initial}</div>
                                <div className="min-w-0">
                                  <div className="font-semibold text-slate-900">{it.email}</div>
                                  <div className="text-xs text-slate-500">{name || "No name yet"}</div>
                                  {snoozed ? <div className="mt-1 text-xs"><Pill tone="warning">Snoozed</Pill><span className="ml-2 text-slate-500">until {fmtDate(it.snoozeUntil || undefined)}</span></div> : null}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-4 align-top">
                              <div className="font-medium text-slate-900">{clip(company, 28)}</div>
                              <div className="text-xs text-slate-500">{it.website ? clip(it.website, 34) : "No website"}</div>
                            </td>
                            <td className="px-4 py-4 align-top"><Pill tone="neutral">{it.stage || "new"}</Pill></td>
                            <td className="px-4 py-4 align-top text-xs text-slate-600">{it.owner?.name || it.owner?.email || "—"}</td>
                            <td className="px-4 py-4 align-top text-xs text-slate-600">{it.list?.name || "—"}</td>
                            <td className="px-4 py-4 align-top"><div className="flex max-w-[170px] flex-wrap gap-1">{it.tags?.length ? it.tags.slice(0, 3).map((t) => <Badge key={t}>{t}</Badge>) : <span className="text-slate-400">—</span>}{it.tags?.length > 3 ? <Badge>+{it.tags.length - 3}</Badge> : null}</div></td>
                            <td className="px-4 py-4 align-top"><Pill tone={toneForStatus(it.status)}>{it.status}</Pill></td>
                            <td className="px-4 py-4 align-top"><div className="flex max-w-[190px] flex-wrap gap-1">{it.campaigns?.length ? it.campaigns.slice(0, 2).map((c) => <Badge key={c.id}>{clip(c.name, 18)}</Badge>) : <span className="text-slate-400">—</span>}{it.campaigns?.length > 2 ? <Badge>+{it.campaigns.length - 2}</Badge> : null}</div></td>
                            <td className="px-4 py-4 align-top">{it.nextTask ? <div><div className="text-xs font-medium text-slate-700">{clip(it.nextTask.title, 26)}</div><div className="text-xs text-slate-500">{it.nextTask.dueAt ? fmtDate(it.nextTask.dueAt) : "No due"}</div></div> : <span className="text-slate-400">—</span>}</td>
                            <td className="px-4 py-4 align-top"><div className="text-xs text-slate-700">{lastLine}</div><div className="text-xs text-slate-500">{fmtDate(lastAt)}</div></td>
                            <td className="px-4 py-4 align-top">
                              <div className="flex gap-2">
                                <Button variant="ghost" onClick={() => setDrawerId(it.id)}>View</Button>
                                <Button variant="ghost" onClick={() => {
                                  if (snoozed) { if (confirm("Unsnooze this lead?")) bulk("unsnooze", {}, [it.id]); return; }
                                  const def = plusDaysISOLocal(3).slice(0, 10); const v = prompt("Snooze until (YYYY-MM-DD):", def); if (!v) return;
                                  const iso = isoFromDateInputLocal(v); if (!iso) { notify("⚠️ Invalid date"); return; }
                                  const reason = prompt("Reason (optional):", "") ?? ""; bulk("snooze", { until: iso, reason }, [it.id]);
                                }}>{snoozed ? "Unsnooze" : "Snooze"}</Button>
                                <Button variant="ghost" onClick={() => { if (confirm("Mark this lead as DNC (suppressed)?")) { (async () => { try { const r = await fetch("/api/leads/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [it.id], action: "dnc", reason: "manual" }) }); if (!r.ok) throw new Error(await r.text()); notify("✅ Marked as DNC"); setRefreshKey((k) => k + 1); } catch (e: any) { notify(`❌ Failed: ${clip(String(e?.message || e), 140)}`); } })(); } }}>DNC</Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!loading && items.length === 0 ? <EmptyState title="No leads found" subtitle="Try adjusting your filters, enrich by website, or import a CSV to get started." /> : null}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-sm text-slate-600">Page <span className="font-semibold text-slate-900">{page}</span> of <span className="font-semibold text-slate-900">{totalPages}</span></div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => setPage(1)} disabled={page <= 1}>First</Button>
                <Button variant="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Prev</Button>
                <Button variant="ghost" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</Button>
                <Button variant="ghost" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>Last</Button>
              </div>
            </div>
          </Card>
        </main>
      </div>

      {drawerId ? <LeadDrawer id={drawerId} onClose={() => setDrawerId(null)} onToast={notify} /> : null}


      {showBulkTask ? (
        <Modal
          title={`Create task (${selectedIds.length} leads)`}
          onClose={() => setShowBulkTask(false)}
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowBulkTask(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!String(bulkTaskTitle || "").trim()}
                onClick={async () => {
                  const title = String(bulkTaskTitle || "").trim();
                  if (!title) return;
                  const dueAt = isoFromDateInputLocal(bulkTaskDueDate);
                  await bulk("create_task", { title, dueAt });
                  setShowBulkTask(false);
                  setBulkTaskTitle("");
                  setBulkTaskDueDate("");
                }}
              >
                Create task
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <div>
              <div className="text-xs opacity-70 mb-1">Title</div>
              <Input value={bulkTaskTitle} onChange={(e) => setBulkTaskTitle(e.target.value)} placeholder="Follow up" />
            </div>
            <div>
              <div className="text-xs opacity-70 mb-1">Due date (optional)</div>
              <Input type="date" value={bulkTaskDueDate} onChange={(e) => setBulkTaskDueDate(e.target.value)} />
              <div className="flex gap-2 mt-2 flex-wrap">
                <Button variant="ghost" onClick={() => setBulkTaskDueDate(plusDaysISOLocal(3).slice(0, 10))}>
                  Follow up in 3 days
                </Button>
                <Button variant="ghost" onClick={() => setBulkTaskDueDate(nextMondayISOLocal().slice(0, 10))}>
                  Call on Monday
                </Button>
                <Button variant="ghost" onClick={() => setBulkTaskDueDate("")}>
                  Clear
                </Button>
              </div>
            </div>
            <div className="text-xs opacity-70">Creates the same task on each selected lead.</div>
          </div>
        </Modal>
      ) : null}

      {showBulkSnooze ? (
        <Modal
          title={`Snooze (${selectedIds.length} leads)`}
          onClose={() => setShowBulkSnooze(false)}
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowBulkSnooze(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!String(bulkSnoozeUntil || "").trim()}
                onClick={async () => {
                  const until = isoFromDateInputLocal(bulkSnoozeUntil);
                  if (!until) {
                    notify("⚠️ Please choose a valid snooze date");
                    return;
                  }
                  await bulk("snooze", { until, reason: String(bulkSnoozeReason || "").trim() });
                  setShowBulkSnooze(false);
                  setBulkSnoozeUntil("");
                  setBulkSnoozeReason("");
                }}
              >
                Snooze
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <div>
              <div className="text-xs opacity-70 mb-1">Snooze until</div>
              <Input type="date" value={bulkSnoozeUntil} onChange={(e) => setBulkSnoozeUntil(e.target.value)} />
              <div className="flex gap-2 mt-2 flex-wrap">
                <Button variant="ghost" onClick={() => setBulkSnoozeUntil(plusDaysISOLocal(3).slice(0, 10))}>
                  3 days
                </Button>
                <Button variant="ghost" onClick={() => setBulkSnoozeUntil(plusDaysISOLocal(7).slice(0, 10))}>
                  7 days
                </Button>
                <Button variant="ghost" onClick={() => setBulkSnoozeUntil(nextMondayISOLocal().slice(0, 10))}>
                  Next Monday
                </Button>
                <Button variant="ghost" onClick={() => setBulkSnoozeUntil("")}>
                  Clear
                </Button>
              </div>
            </div>
            <div>
              <div className="text-xs opacity-70 mb-1">Reason (optional)</div>
              <TextArea value={bulkSnoozeReason} onChange={(e) => setBulkSnoozeReason(e.target.value)} placeholder="e.g. follow up after conference" rows={3} />
            </div>
            <div className="text-xs opacity-70">Hidden by default in the Leads list until the snooze date passes.</div>
          </div>
        </Modal>
      ) : null}

      {showAiTags ? (
        <Modal
          title={`✨ AI tags (${selectedIds.length} selected)`}
          onClose={() => {
            setShowAiTags(false);
            setAiBusy(false);
          }}
          footer={
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs opacity-70">Adds tags (doesn’t remove existing tags).</div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => setShowAiTags(false)}>
                  Cancel
                </Button>
                <Button variant="ghost" onClick={() => generateAiTags()} disabled={aiBusy}>
                  {aiBusy ? "Generating…" : "Regenerate"}
                </Button>
                <Button variant="primary" onClick={applyAiTagsToSelection} disabled={aiBusy || !String(aiTags || "").trim()}>
                  Apply tags
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-3">
            <div className="text-xs opacity-70">
              Use AI to suggest a shared tag set for the selected leads. Optionally provide a hint (e.g. “SaaS founders”, “US healthcare”, “B2B agencies”).
            </div>

            <div>
              <div className="text-xs opacity-70 mb-1">Hint (optional)</div>
              <Input value={aiHint} onChange={(e) => setAiHint(e.target.value)} placeholder="e.g. fintech CFOs in the UK" />
            </div>

            <div>
              <div className="text-xs opacity-70 mb-1">Suggested tags (comma separated)</div>
              <TextArea value={aiTags} onChange={(e) => setAiTags(e.target.value)} rows={3} placeholder="saas, founder, us" />
            </div>

            {aiRationale ? (
              <div className="glass p-3">
                <div className="text-xs font-medium mb-1">Why these tags</div>
                <div className="text-sm whitespace-pre-wrap">{aiRationale}</div>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {showAiEnrich ? (
        <Modal
          title={`✨ AI enrich (${selectedIds.length} selected)`}
          onClose={() => {
            setShowAiEnrich(false);
            setAiEnrichBusy(false);
          }}
          footer={
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs opacity-70">Fills missing fields only (safe). Does not overwrite existing.</div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => setShowAiEnrich(false)}>Cancel</Button>
                <Button variant="ghost" onClick={() => generateAiEnrich()} disabled={aiEnrichBusy}>
                  {aiEnrichBusy ? "Generating…" : "Regenerate"}
                </Button>
                <Button variant="primary" onClick={applyAiEnrichToSelection} disabled={aiEnrichBusy || !aiEnrichRows.length}>
                  Apply enrichment
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-3">
            <div className="text-xs opacity-70">
              AI suggests missing lead fields (name/company/website) based on the email + existing data. Add an optional hint if you have context.
            </div>

            <div>
              <div className="text-xs opacity-70 mb-1">Hint (optional)</div>
              <Input value={aiEnrichHint} onChange={(e) => setAiEnrichHint(e.target.value)} placeholder="e.g. B2B SaaS founders" />
            </div>

            <div className="glass p-3 max-h-72 overflow-auto">
              <div className="text-xs font-medium mb-2">Preview</div>
              <div className="space-y-2">
                {aiEnrichRows.length ? (
                  aiEnrichRows.map((r) => {
                    const it = items.find((x) => x.id === r.id);
                    const label = it?.email || r.id;
                    const parts = [
                      r.firstName ? `first: ${r.firstName}` : null,
                      r.lastName ? `last: ${r.lastName}` : null,
                      r.company ? `company: ${r.company}` : null,
                      r.website ? `website: ${r.website}` : null,
                    ].filter(Boolean) as string[];
                    return (
                      <div key={r.id} className="border-b border-black/5 dark:border-white/10 pb-2">
                        <div className="text-sm font-medium">{label}</div>
                        <div className="text-xs opacity-70">{parts.length ? parts.join(" · ") : "No suggestions"}</div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-sm opacity-70">No suggestions yet.</div>
                )}
              </div>
            </div>

            {aiEnrichRationale ? (
              <div className="glass p-3">
                <div className="text-xs font-medium mb-1">Notes</div>
                <div className="text-sm whitespace-pre-wrap">{aiEnrichRationale}</div>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {showCompanyEnrich ? (
        <Modal
          title="✨ Enrich all leads by company website"
          wide
          onClose={() => {
            setShowCompanyEnrich(false);
            setCompanyEnrichBusy(false);
          }}
          footer={
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs text-slate-500">
                Verify first. Import now automatically uses only ✅ valid selected emails and skips failed/pending ones.
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="ghost" onClick={() => setShowCompanyEnrich(false)}>Close</Button>
                <Button
                  variant="ghost"
                  onClick={runCompanyEnrich}
                  disabled={companyDiscoverBusy || companyImportBusy || companyEnrichBusy || !String(companyWebsiteUrl || "").trim()}
                  title="Optional: fill missing fields for existing leads whose email domain matches this website"
                >
                  {companyEnrichBusy ? "Enriching…" : "Enrich matching leads"}
                </Button>
                <Button
                  variant="primary"
                  onClick={importDiscoveredEmails}
                  disabled={!canImportDiscovered}
                  title={discoveredNotVerified.length ? "Imports only verified-valid selected emails. Failed/pending selected emails are skipped automatically." : "Import verified-valid selected emails"}
                >
                  {companyImportBusy ? "Importing…" : `Import valid (${discoveredValidSelected.length})`}
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-5">
            <div className="rounded-3xl border border-slate-200/80 bg-gradient-to-br from-violet-50 via-white to-sky-50 p-4 sm:p-5">
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 items-end">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500 font-semibold">Company website</div>
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      value={companyWebsiteUrl}
                      onChange={(e) => setCompanyWebsiteUrl(e.target.value)}
                      placeholder="https://example.com"
                      className="h-12 text-base"
                    />
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    Discover public inboxes, verify deliverability, then import only clean leads — no manual cleanup needed.
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap lg:justify-end">
                  <Button variant="primary" onClick={runCompanyDiscover} disabled={companyDiscoverBusy || !String(companyWebsiteUrl || "").trim()}>
                    {companyDiscoverBusy ? "Discovering…" : "1. Discover emails"}
                  </Button>
                  <Button variant="ghost" onClick={verifySelectedCompanyEmails} disabled={companyDiscoverBusy || companyImportBusy || !discoveredSelected.length}>
                    2. Verify selected
                  </Button>
                  <Button variant="ghost" onClick={importDiscoveredEmails} disabled={!canImportDiscovered}>
                    3. Import valid ({discoveredValidSelected.length})
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-2">
                {[
                  ["Found", companyEmailStats.total],
                  ["Selected", companyEmailStats.selected],
                  ["Valid", companyEmailStats.validSelected],
                  ["Failed", companyEmailStats.invalidSelected],
                  ["Pending", companyEmailStats.pendingSelected],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-2xl bg-white/75 border border-slate-200/80 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
                    <div className="text-lg font-semibold text-slate-900">{value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
              <div className="space-y-4">
                <div className="glass p-4 rounded-3xl">
                  <div className="text-sm font-semibold text-slate-900">Discovery settings</div>
                  <div className="text-xs text-slate-500 mt-1">Keep this safe by default. SMTP probing is slower and some providers do not reveal mailbox existence.</div>

                  <label className="flex items-start gap-2 text-sm mt-4 select-none">
                    <input className="mt-1" type="checkbox" checked={companyIncludeSuggested} onChange={(e) => setCompanyIncludeSuggested(e.target.checked)} />
                    <span>
                      <span className="font-medium">Also generate AI inbox suggestions</span>
                      <span className="block text-xs text-slate-500">Useful when the site hides emails. Suggestions must still be verified.</span>
                    </span>
                  </label>

                  <div className="mt-4">
                    <div className="text-xs text-slate-500 mb-1">Verification mode</div>
                    <Select value={companyVerifyMode} onChange={(e) => setCompanyVerifyMode(e.target.value === "smtp" ? "smtp" : "no_smtp")}>
                      <option value="no_smtp">Safe: syntax + domain + MX</option>
                      <option value="smtp">Full: MX + SMTP probe</option>
                    </Select>
                  </div>

                  <label className="flex items-start gap-2 text-sm mt-3 select-none">
                    <input
                      className="mt-1"
                      type="checkbox"
                      checked={companyRequireMailbox}
                      onChange={(e) => setCompanyRequireMailbox(e.target.checked)}
                      disabled={companyVerifyMode === "no_smtp"}
                    />
                    <span>
                      <span className="font-medium">Require mailbox confirmation</span>
                      <span className="block text-xs text-slate-500">SMTP mode only.</span>
                    </span>
                  </label>
                </div>

                <div className="glass p-4 rounded-3xl">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Selection tools</div>
                      <div className="text-xs text-slate-500">No more deselecting failed leads manually.</div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const sel: Record<string, boolean> = {};
                        for (const it of companyAllImportableEmails) sel[it.email] = true;
                        setCompanyDiscoveredSel(sel);
                      }}
                      disabled={companyDiscoverBusy || !companyAllImportableEmails.length}
                    >
                      Select all
                    </Button>
                    <Button variant="ghost" onClick={() => setCompanyDiscoveredSel({})} disabled={companyDiscoverBusy || !companyAllImportableEmails.length}>
                      Clear
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const sel: Record<string, boolean> = {};
                        for (const it of companyAllImportableEmails) {
                          if (companyVerifyMap[it.email]?.status === "valid") sel[it.email] = true;
                        }
                        setCompanyDiscoveredSel(sel);
                      }}
                      disabled={!companyAllImportableEmails.length}
                    >
                      Select valid
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setCompanyDiscoveredSel((m) => {
                          const next = { ...m };
                          for (const e of discoveredInvalidSelected) delete next[e];
                          return next;
                        });
                      }}
                      disabled={!discoveredInvalidSelected.length}
                    >
                      Remove failed
                    </Button>
                  </div>
                  {discoveredSelected.length ? (
                    <div className="mt-3 rounded-2xl border border-slate-200 bg-white/70 p-3 text-xs text-slate-600">
                      Import will add <span className="font-semibold text-emerald-700">{discoveredValidSelected.length} valid</span>
                      {discoveredNotVerified.length ? <span> and skip {discoveredNotVerified.length} pending/failed selected.</span> : <span>.</span>}
                    </div>
                  ) : null}
                </div>

                <div className="glass p-4 rounded-3xl">
                  <div className="text-sm font-semibold text-slate-900">Manual verified email</div>
                  <div className="text-xs text-slate-500 mt-1">Check a corrected or known email, then add it to the import list.</div>
                  <div className="mt-3 space-y-2">
                    <Input value={companyManualEmail} onChange={(e) => setCompanyManualEmail(e.target.value)} placeholder="name@company.com" />
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          if (!companyManualNorm) {
                            notify("⚠️ Enter an email first");
                            return;
                          }
                          verifyCompanyEmail(companyManualNorm);
                        }}
                        disabled={!companyManualNorm || companyVerifyMap[companyManualNorm]?.status === "busy"}
                      >
                        {companyVerifyMap[companyManualNorm]?.status === "busy" ? "Checking…" : "Check"}
                      </Button>
                      <Button variant="primary" onClick={() => addManualCompanyEmail(companyManualNorm)} disabled={!companyManualNorm || companyVerifyMap[companyManualNorm]?.status !== "valid"}>
                        Add
                      </Button>
                    </div>
                    {companyManualNorm ? (
                      <div className="text-xs text-slate-500" title={companyVerifyMap[companyManualNorm]?.message || ""}>
                        Status: {companyVerifyMap[companyManualNorm]?.status === "valid"
                          ? "✅ Valid"
                          : companyVerifyMap[companyManualNorm]?.status === "invalid"
                            ? "❌ Invalid"
                            : companyVerifyMap[companyManualNorm]?.status === "busy"
                              ? "⏳ Checking…"
                              : companyVerifyMap[companyManualNorm]?.status === "error"
                                ? "⚠️ Error"
                                : "Not verified"}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="glass p-4 rounded-3xl">
                  <div className="text-sm font-semibold text-slate-900">Fallback pattern generator</div>
                  <div className="text-xs text-slate-500 mt-1">Generate common address patterns, then verify them before import.</div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Input value={companyFallbackFirst} onChange={(e) => setCompanyFallbackFirst(e.target.value)} placeholder="first" />
                    <Input value={companyFallbackLast} onChange={(e) => setCompanyFallbackLast(e.target.value)} placeholder="last" />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const raw = String(companyWebsiteUrl || "").trim();
                        let host = "";
                        try {
                          const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
                          host = (u.hostname || "").replace(/^www\./, "");
                        } catch {
                          host = "";
                        }
                        if (!host) {
                          notify("⚠️ Enter a valid company website URL first");
                          return;
                        }
                        const fn = String(companyFallbackFirst || "").trim().toLowerCase();
                        const ln = String(companyFallbackLast || "").trim().toLowerCase();
                        if (!fn && !ln) {
                          notify("⚠️ Enter first name or last name");
                          return;
                        }
                        const f = fn ? (fn[0] || "") : "";
                        const l = ln ? (ln[0] || "") : "";
                        const locals: string[] = [];
                        if (fn && ln) {
                          locals.push(`${fn}.${ln}`, `${fn}${ln}`, `${fn}_${ln}`, `${fn}-${ln}`, `${f}${ln}`, `${f}.${ln}`, `${f}_${ln}`, `${f}-${ln}`, `${fn}${l}`, `${fn}.${l}`, `${ln}.${fn}`, `${ln}${fn}`);
                        }
                        if (fn) locals.push(`${fn}`, `${f}`);
                        if (ln) locals.push(`${ln}`, `${l}`);
                        const uniq: string[] = [];
                        const seen = new Set<string>();
                        for (const local of locals) {
                          const localClean = String(local || "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
                          if (!localClean) continue;
                          const e = `${localClean}@${host}`;
                          const key = e.toLowerCase();
                          if (seen.has(key)) continue;
                          seen.add(key);
                          uniq.push(e);
                        }
                        setCompanyGenerated((prev) => {
                          const existing = new Set([...companyDiscovered, ...companySuggested, ...companyManualEmails, ...prev].map((x) => String(x.email || "").toLowerCase()));
                          const add = uniq.filter((e) => !existing.has(e.toLowerCase())).map((email) => ({
                            email: email.toLowerCase(),
                            sourceUrl: "pattern",
                            purpose: "pattern",
                            recommended: true,
                            confidence: 0.2,
                            notes: "Generated pattern (verify before import)",
                          }));
                          return [...add, ...prev];
                        });
                        notify("✅ Generated pattern emails. Select and verify them.");
                      }}
                    >
                      Generate
                    </Button>
                    <Button variant="ghost" onClick={() => { setCompanyGenerated([]); notify("Cleared generated patterns"); }} disabled={!companyGenerated.length}>
                      Clear
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {companyDiscoverNote ? (
                  <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">{companyDiscoverNote}</div>
                ) : null}

                {companyAllImportableEmails.length ? (
                  <div className="glass rounded-3xl overflow-hidden">
                    <div className="p-4 border-b border-slate-200/70 flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Review inboxes</div>
                        <div className="text-xs text-slate-500">Grouped by source. Failed emails can stay selected — import skips them automatically.</div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
                        <span className="rounded-full bg-emerald-50 text-emerald-700 px-2 py-1">✅ {companyEmailStats.validSelected} valid selected</span>
                        <span className="rounded-full bg-rose-50 text-rose-700 px-2 py-1">❌ {companyEmailStats.invalidSelected} failed</span>
                        <span className="rounded-full bg-slate-100 text-slate-600 px-2 py-1">⏳ {companyEmailStats.pendingSelected} pending</span>
                      </div>
                    </div>

                    <div className="max-h-[520px] overflow-auto divide-y divide-slate-200/70">
                      {[
                        { title: "Published on website", count: companyDiscovered.length, items: companyDiscovered, empty: "No website-published emails yet." },
                        { title: "AI suggested", count: companySuggested.length, items: companySuggested, empty: "AI suggestions are off or none were generated." },
                        { title: "Manually added", count: companyManualEmails.length, items: companyManualEmails, empty: "No manual emails added." },
                        { title: "Generated patterns", count: companyGenerated.length, items: companyGenerated, empty: "No generated patterns yet." },
                      ].map((section) => (
                        <div key={section.title} className="p-4">
                          <div className="flex items-center justify-between gap-2 mb-3">
                            <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">{section.title}</div>
                            <div className="text-xs text-slate-400">{section.count}</div>
                          </div>
                          {section.items.length ? (
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                              {section.items.map((it: any) => {
                                const state = companyVerifyMap[it.email];
                                const status = state?.status || "idle";
                                const statusClass = status === "valid"
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : status === "invalid" || status === "error"
                                    ? "bg-rose-50 text-rose-700 border-rose-200"
                                    : status === "busy"
                                      ? "bg-amber-50 text-amber-700 border-amber-200"
                                      : "bg-slate-50 text-slate-600 border-slate-200";
                                const statusText = status === "valid"
                                  ? "✅ Valid"
                                  : status === "invalid"
                                    ? "❌ Invalid"
                                    : status === "busy"
                                      ? "⏳ Verifying"
                                      : status === "error"
                                        ? "⚠️ Error"
                                        : "Not verified";
                                return (
                                  <div key={`${section.title}-${it.email}`} className={`rounded-2xl border p-3 transition ${companyDiscoveredSel[it.email] ? "border-violet-300 bg-violet-50/40" : "border-slate-200 bg-white/70"}`}>
                                    <div className="flex items-start gap-3">
                                      <input
                                        type="checkbox"
                                        className="mt-1.5"
                                        checked={!!companyDiscoveredSel[it.email]}
                                        onChange={(e) => setCompanyDiscoveredSel((m) => ({ ...m, [it.email]: e.target.checked }))}
                                      />
                                      <div className="min-w-0 flex-1">
                                        <div className="font-mono text-sm break-all text-slate-900">{it.email}</div>
                                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                                          <span className={`rounded-full border px-2 py-1 text-[11px] ${statusClass}`} title={state?.message || ""}>{statusText}</span>
                                          {renderCompanyRiskPill(state)}
                                          {it.purpose ? <span className="rounded-full bg-slate-100 text-slate-600 px-2 py-1 text-[11px]">{it.purpose}</span> : null}
                                          {typeof it.confidence === "number" ? <span className="text-[11px] text-slate-500">AI {(it.confidence * 100).toFixed(0)}%</span> : null}
                                        </div>
                                        {it.notes ? <div className="mt-2 text-xs text-slate-500">{it.notes}</div> : null}
                                        {renderCompanyRiskFlags(state)}
                                        {it.evidenceUrls?.length ? (
                                          <div className="mt-2 text-xs text-slate-500 break-all">
                                            Found on: {it.evidenceUrls.slice(0, 2).map((u: string, idx: number) => (
                                              <span key={u}>
                                                <a className="underline" href={u} target="_blank" rel="noreferrer">page {idx + 1}</a>
                                                {idx === 0 && it.evidenceUrls!.length > 2 ? <span className="opacity-60"> (+{it.evidenceUrls!.length - 2} more)</span> : null}
                                              </span>
                                            ))}
                                          </div>
                                        ) : null}
                                      </div>
                                      <Button
                                        variant="ghost"
                                        className="px-2 py-1 text-xs rounded-lg shrink-0"
                                        onClick={() => verifyCompanyEmail(it.email)}
                                        disabled={status === "busy"}
                                      >
                                        {status === "valid" ? "Recheck" : "Verify"}
                                      </Button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 p-4 text-sm text-slate-500">{section.empty}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="glass rounded-3xl p-8 text-center">
                    <div className="mx-auto h-14 w-14 rounded-3xl bg-violet-50 flex items-center justify-center text-2xl">🔎</div>
                    <div className="mt-3 text-base font-semibold text-slate-900">No emails found yet</div>
                    <div className="mt-1 text-sm text-slate-500">Enter a company website and click Discover emails. Results will appear here in clean grouped cards.</div>
                  </div>
                )}

                {companyOtherEmails.length || companyContactForms.length ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {companyOtherEmails.length ? (
                      <div className="glass p-4 rounded-3xl">
                        <div className="text-sm font-semibold text-slate-900">Other public emails</div>
                        <div className="text-xs text-slate-500 mt-1">Shown for reference. These are not company-domain import candidates.</div>
                        <div className="mt-3 space-y-2 max-h-44 overflow-auto">
                          {companyOtherEmails.map((it) => (
                            <div key={it.email} className="rounded-2xl border border-slate-200 bg-white/70 p-3">
                              <div className="font-mono text-sm break-all">{it.email}</div>
                              <div className="text-xs text-slate-500 break-all mt-1">Source: {it.sourceUrl}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {companyContactForms.length ? (
                      <div className="glass p-4 rounded-3xl">
                        <div className="text-sm font-semibold text-slate-900">Contact forms found</div>
                        <div className="text-xs text-slate-500 mt-1">Official fallback channels if the site does not publish inboxes.</div>
                        <div className="mt-3 space-y-2 max-h-44 overflow-auto">
                          {companyContactForms.map((f, idx) => (
                            <div key={`${f.url}-${idx}`} className="rounded-2xl border border-slate-200 bg-white/70 p-3 text-xs break-all">
                              <a className="underline" href={f.url} target="_blank" rel="noreferrer">{f.url}</a>
                              {f.sourceUrl && f.sourceUrl !== f.url ? <div className="text-slate-500 mt-1">Found on {f.sourceUrl}</div> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {companyEnrichResult ? (
                  <div className="glass p-4 rounded-3xl">
                    <div className="text-sm font-semibold text-slate-900">Enrichment result</div>
                    <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      <div className="rounded-2xl bg-white/70 border border-slate-200 p-3"><div className="text-slate-500">Matched</div><div className="text-lg font-semibold">{companyEnrichResult.matched}</div></div>
                      <div className="rounded-2xl bg-white/70 border border-slate-200 p-3"><div className="text-slate-500">Updated</div><div className="text-lg font-semibold">{companyEnrichResult.updated}</div></div>
                      <div className="rounded-2xl bg-white/70 border border-slate-200 p-3"><div className="text-slate-500">Discovered</div><div className="text-lg font-semibold">{companyEnrichResult.discovered}</div></div>
                      <div className="rounded-2xl bg-white/70 border border-slate-200 p-3"><div className="text-slate-500">Created</div><div className="text-lg font-semibold">{companyEnrichResult.created}</div></div>
                    </div>
                    <div className="text-xs text-slate-500 mt-3">Website: <span className="font-mono">{companyEnrichResult.website}</span></div>
                    {companyEnrichResult.note ? <div className="text-xs text-slate-500 mt-2">{companyEnrichResult.note}</div> : null}
                    {companyEnrichResult.rationale ? <div className="mt-3 text-sm whitespace-pre-wrap">{companyEnrichResult.rationale}</div> : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </Modal>
      ) : null}


      {showAiSegments ? (
        <Modal
          title="✨ AI segments"
          onClose={() => {
            setShowAiSegments(false);
            setAiSegmentsBusy(false);
          }}
          footer={
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs opacity-70">Suggested saved views (segments) based on your lead stats.</div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => setShowAiSegments(false)}>Close</Button>
                <Button variant="ghost" onClick={generateAiSegments} disabled={aiSegmentsBusy}>
                  {aiSegmentsBusy ? "Generating…" : "Regenerate"}
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-3">
            {aiSegments.length ? (
              <div className="space-y-2">
                {aiSegments.map((v, idx) => (
                  <div key={`${v.name}-${idx}`} className="glass p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold">{v.name}</div>
                        <div className="text-xs opacity-70">{v.description}</div>
                        <div className="text-xs opacity-60 mt-1">
                          status: {String(v.payload?.status || "all")} · contacted: {String(v.payload?.contacted || "")} · tag: {String(v.payload?.tag || "")}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          onClick={() => {
                            applyViewPayload(v.payload, null);
                            setShowAiSegments(false);
                          }}
                        >
                          Apply
                        </Button>
                        <Button variant="primary" onClick={() => saveSuggestedView(v.name, v.payload)}>
                          Save
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm opacity-70">{aiSegmentsBusy ? "Generating suggestions…" : "No suggestions yet."}</div>
            )}
          </div>
        </Modal>
      ) : null}

      {showAdd ? (
        <Modal title="Add lead (manual)" onClose={() => setShowAdd(false)}>
          <div className="space-y-3">
            <div className="text-xs opacity-70">
              Add a lead manually. If verification is enabled, the lead will only be saved when the email validates.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-xs opacity-70 mb-1">Email *</div>
                <Input value={fEmail} onChange={(e) => setFEmail(e.target.value)} placeholder="lead@company.com" />
              </div>

              <div>
                <div className="text-xs opacity-70 mb-1">Status</div>
                <Select
                  value={fStatus}
                  onChange={(e) => setFStatus(e.target.value)}
                  className="h-10 w-full rounded-xl border border-black/10 dark:border-white/10 bg-transparent px-3 text-sm"
                >
                  <option value="active">Active</option>
                  <option value="replied">Replied</option>
                  <option value="unsubscribed">Unsubscribed</option>
                  <option value="bounced">Bounced</option>
                  <option value="suppressed">Suppressed</option>
                </Select>
              </div>

              <div>
                <div className="text-xs opacity-70 mb-1">First name</div>
                <Input value={fFirstName} onChange={(e) => setFFirstName(e.target.value)} placeholder="First name" />
              </div>

              <div>
                <div className="text-xs opacity-70 mb-1">Last name</div>
                <Input value={fLastName} onChange={(e) => setFLastName(e.target.value)} placeholder="Last name" />
              </div>

              <div>
                <div className="text-xs opacity-70 mb-1">Company</div>
                <Input value={fCompany} onChange={(e) => setFCompany(e.target.value)} placeholder="Company" />
              </div>

              <div>
                <div className="text-xs opacity-70 mb-1">Website</div>
                <Input value={fWebsite} onChange={(e) => setFWebsite(e.target.value)} placeholder="https://company.com" />
              </div>

              <div className="md:col-span-2">
                <div className="text-xs opacity-70 mb-1">Tags (comma separated)</div>
                <Input value={fTags} onChange={(e) => setFTags(e.target.value)} placeholder="saas, founder, us" />
              </div>
            </div>

            <div className="glass p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={fVerify} onChange={(e) => setFVerify(e.target.checked)} />
                Verify email before saving
              </label>

              {fVerify ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs opacity-70 mb-1">Verification mode</div>
                    <Select
                      value={fVerifyMode}
                      onChange={(e) => {
                        const v = e.target.value as any;
                        setFVerifyMode(v);
                        if (v === "no_smtp") setFRequireMailbox(false);
                      }}
                      className="h-10 w-full rounded-xl border border-black/10 dark:border-white/10 bg-transparent px-3 text-sm"
                    >
                      <option value="smtp">Full (MX + SMTP)</option>
                      <option value="no_smtp">Safe (syntax + domain + MX only)</option>
                    </Select>
                    <div className="text-xs opacity-60 mt-1">
                      Full mode may fail if your VPS blocks outbound SMTP (port 25). Safe mode avoids SMTP.
                    </div>

                    <label className="mt-2 flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={fRequireMailbox}
                        disabled={fVerifyMode !== "smtp"}
                        onChange={(e) => setFRequireMailbox(e.target.checked)}
                      />
                      Require mailbox confirmation (SMTP)
                    </label>
                    <div className="text-xs opacity-60">
                      This will only save the lead when the SMTP check explicitly confirms the mailbox.
                      Some providers may still return &quot;unknown&quot; for privacy reasons.
                    </div>
                  </div>

                  <div>
                    <div className="text-xs opacity-70 mb-1">Sender mailbox (optional)</div>
                    <Select
                      value={fSenderMailboxId}
                      onChange={(e) => setFSenderMailboxId(e.target.value)}
                      className="h-10 w-full rounded-xl border border-black/10 dark:border-white/10 bg-transparent px-3 text-sm"
                    >
                      <option value="">Use server default (PING_EMAIL_SENDER)</option>
                      {mailboxes.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} • {m.fromEmail}
                        </option>
                      ))}
                    </Select>
                    <div className="text-xs opacity-60 mt-1">
                      If selected, we will use that mailbox&apos;s From email for the verification handshake.
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex gap-2">
              <Button onClick={submitAddLead} disabled={loading}>
                Add lead
              </Button>
              <Button variant="ghost" onClick={() => setShowAdd(false)} disabled={loading}>
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {showImport ? (
        <ImportWizard
          onClose={() => setShowImport(false)}
          onToast={notify}
          onDone={() => setRefreshKey((k) => k + 1)}
        />
      ) : null}

      {showSuppressions ? (
        <SuppressionManager
          onClose={() => setShowSuppressions(false)}
          onToast={notify}
          onChanged={() => setRefreshKey((k) => k + 1)}
        />
      ) : null}

      {showLists ? (
        <Modal
          title="Lead lists"
          onClose={() => {
            setShowLists(false);
            setNewListName("");
          }}
          footer={
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs opacity-70">Use lists to organize leads. Bulk action: “Move to list…”.</div>
              <Button variant="ghost" onClick={() => setShowLists(false)}>
                Close
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <div className="glass p-3 space-y-2">
              <div className="text-xs opacity-70">Create a list</div>
              <div className="flex gap-2">
                <Input value={newListName} onChange={(e) => setNewListName(e.target.value)} placeholder="e.g. US SaaS founders" />
                <Button
                  onClick={async () => {
                    const name = String(newListName || "").trim();
                    if (!name) {
                      notify("❌ Enter a list name");
                      return;
                    }
                    try {
                      const r = await fetch("/api/leads/lists", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name }),
                      });
                      if (!r.ok) throw new Error(await r.text());
                      notify("✅ List saved");
                      setNewListName("");
                      setRefreshKey((k) => k + 1);
                    } catch (e: any) {
                      notify(`❌ Failed: ${clip(String(e?.message || e), 140)}`);
                    }
                  }}
                >
                  Create
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs opacity-70">Lists in this workspace</div>
              {lists.length ? (
                lists.map((l) => (
                  <div key={l.id} className="rounded-2xl border border-black/10 dark:border-white/10 p-3 flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">{l.name}</div>
                    <Button
                      variant="danger"
                      onClick={async () => {
                        if (!confirm(`Delete list “${l.name}”? Leads will be unassigned from this list.`)) return;
                        try {
                          const r = await fetch(`/api/leads/lists?id=${encodeURIComponent(l.id)}`, { method: "DELETE" });
                          if (!r.ok) throw new Error(await r.text());
                          notify("✅ List deleted");
                          setRefreshKey((k) => k + 1);
                        } catch (e: any) {
                          notify(`❌ Failed: ${clip(String(e?.message || e), 140)}`);
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                ))
              ) : (
                <div className="text-sm opacity-70">No lists yet.</div>
              )}
            </div>
          </div>
        </Modal>
      ) : null}

      {showDuplicates ? (
        <DuplicatesManager
          onClose={() => setShowDuplicates(false)}
          onToast={notify}
          onChanged={() => setRefreshKey((k) => k + 1)}
        />
      ) : null}

      {showEnroll ? (
        <Modal title="Add selected leads to a campaign" onClose={() => setShowEnroll(false)}>
          <div className="space-y-3">
            <div className="text-sm opacity-70">Selected leads: <span className="font-medium">{selectedIds.length}</span></div>
            <div className="text-xs opacity-70">Choose a campaign:</div>
            <Select
              value={enrollCampaignId}
              onChange={(e) => setEnrollCampaignId(e.target.value)}
              className="h-10 w-full rounded-xl border border-black/10 dark:border-white/10 bg-transparent px-3 text-sm"
            >
              <option value="">Select campaign…</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.status})
                </option>
              ))}
            </Select>
            <div className="flex gap-2">
              <Button
                onClick={async () => {
                  if (!enrollCampaignId) {
                    notify("❌ Select a campaign");
                    return;
                  }
                  await bulk("enroll_campaign", { campaignId: enrollCampaignId });
                  setShowEnroll(false);
                }}
              >
                Enroll
              </Button>
              <Button variant="ghost" onClick={() => setShowEnroll(false)}>
                Cancel
              </Button>
            </div>
            {!campaigns.length ? <div className="text-sm opacity-70">No campaigns found.</div> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );

  // ensure function is referenced
  async function _noop() {
    await openEnrollModal();
  }
}

function ImportWizard({ onClose, onToast, onDone }: { onClose: () => void; onToast: (m: string) => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [upsert, setUpsert] = useState(true);
  const [batchTag, setBatchTag] = useState("");
  const [verify, setVerify] = useState(false);
  const [verifyMode, setVerifyMode] = useState<"smtp" | "no_smtp">("smtp");
  const [requireMailbox, setRequireMailbox] = useState(true);
  const [onInvalid, setOnInvalid] = useState<"skip" | "fail">("skip");
  const [mailboxes, setMailboxes] = useState<Array<{ id: string; name: string; fromEmail: string; isActive: boolean }>>([]);
  const [senderMailboxId, setSenderMailboxId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    // Load sender mailbox options (optional)
    let cancelled = false;
    fetch("/api/mailboxes/list", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) return null;
        return await r.json();
      })
      .then((d) => {
        if (cancelled) return;
        const mbs = Array.isArray(d?.mailboxes)
          ? d.mailboxes.map((m: any) => ({
              id: String(m.id),
              name: String(m.name || m.fromEmail || "Mailbox"),
              fromEmail: String(m.fromEmail || ""),
              isActive: !!m.isActive,
            }))
          : [];
        setMailboxes(mbs);
      })
      .catch(() => {
        if (cancelled) return;
        setMailboxes([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Modal title="Import CSV wizard" onClose={onClose}>
      <div className="space-y-3">
        <div className="text-sm opacity-80">
          Supported headers: <span className="font-mono">email, firstName, lastName, company, website, tags</span>
        </div>
        <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={upsert} onChange={(e) => setUpsert(e.target.checked)} />
          Upsert existing leads (update fields)
        </label>
        <div>
          <div className="text-xs opacity-70 mb-1">Batch tag (optional)</div>
          <Input value={batchTag} onChange={(e) => setBatchTag(e.target.value)} placeholder="e.g. jan-import" />
        </div>

        <div className="rounded-2xl border border-black/10 dark:border-white/10 p-3 space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} />
            Verify email IDs during import (slower)
          </label>

          {verify ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <div className="text-xs opacity-70 mb-1">Verification mode</div>
                  <Select
                    value={verifyMode}
                    onChange={(e) => {
                      const v = (e.target.value === "no_smtp" ? "no_smtp" : "smtp") as any;
                      setVerifyMode(v);
                      if (v === "no_smtp") setRequireMailbox(false);
                    }}
                    className="h-10 w-full rounded-xl border border-black/10 dark:border-white/10 bg-transparent px-3 text-sm"
                  >
                    <option value="smtp">Full (MX + SMTP mailbox check)</option>
                    <option value="no_smtp">Safe (syntax + domain + MX only)</option>
                  </Select>
                </div>

                <div>
                  <div className="text-xs opacity-70 mb-1">If an email is invalid</div>
                  <Select
                    value={onInvalid}
                    onChange={(e) => setOnInvalid(e.target.value === "fail" ? "fail" : "skip")}
                    className="h-10 w-full rounded-xl border border-black/10 dark:border-white/10 bg-transparent px-3 text-sm"
                  >
                    <option value="skip">Skip invalid rows and import the rest</option>
                    <option value="fail">Stop import and show errors</option>
                  </Select>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={requireMailbox}
                  onChange={(e) => setRequireMailbox(e.target.checked)}
                  disabled={verifyMode === "no_smtp"}
                />
                Require mailbox confirmation (SMTP)
              </label>
              {verifyMode === "no_smtp" ? (
                <div className="text-xs opacity-70">
                  Safe mode does not perform SMTP mailbox verification (use Full mode to verify mailbox).
                </div>
              ) : null}

              {mailboxes.length ? (
                <div>
                  <div className="text-xs opacity-70 mb-1">Sender mailbox (optional)</div>
                  <Select
                    value={senderMailboxId}
                    onChange={(e) => setSenderMailboxId(e.target.value)}
                    className="h-10 w-full rounded-xl border border-black/10 dark:border-white/10 bg-transparent px-3 text-sm"
                  >
                    <option value="">Use PING_EMAIL_SENDER</option>
                    {mailboxes.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} {m.fromEmail ? `(${m.fromEmail})` : ""} {m.isActive ? "" : "(inactive)"}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : (
                <div className="text-xs opacity-70">(Optional) Set PING_EMAIL_SENDER in .env to choose the SMTP sender.</div>
              )}
            </>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button
            onClick={async () => {
              if (!file) {
                onToast("❌ Select a CSV file");
                return;
              }
              setLoading(true);
              setResult(null);
              try {
                const fd = new FormData();
                fd.set("file", file);
                if (upsert) fd.set("upsert", "1");
                if (batchTag.trim()) fd.set("batchTag", batchTag.trim());
                if (verify) {
                  fd.set("verify", "1");
                  fd.set("verifyMode", verifyMode);
                  if (requireMailbox) fd.set("requireMailbox", "1");
                  fd.set("onInvalid", onInvalid);
                  if (senderMailboxId) fd.set("senderMailboxId", senderMailboxId);
                }
                const r = await fetch("/api/leads/import-wizard", { method: "POST", body: fd });
                const txt = await r.text();
                let d: any = null;
                try {
                  d = txt ? JSON.parse(txt) : null;
                } catch {
                  d = null;
                }

                if (!r.ok || !d?.ok) {
                  setResult(d || { ok: false, error: "Import failed" });
                  onToast(`❌ Import failed: ${clip(String(d?.error || d?.message || txt || "Unknown error"), 140)}`);
                  return;
                }

                setResult(d);
                onToast("✅ Import finished");
                onDone();
              } catch (e: any) {
                onToast(`❌ Import failed: ${clip(String(e?.message || e), 140)}`);
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
          >
            {loading ? "Importing…" : "Import"}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        {result?.ok ? (
          <div className="rounded-2xl border border-black/10 dark:border-white/10 p-3 text-sm">
            <div>Inserted: <span className="font-medium">{result.inserted}</span></div>
            <div>Updated: <span className="font-medium">{result.updated}</span></div>
            <div>Skipped: <span className="font-medium">{result.skipped}</span></div>
            <div>Invalid: <span className="font-medium">{result.invalid}</span></div>
            {typeof result.verified === "number" ? (
              <div>Verified: <span className="font-medium">{result.verified}</span></div>
            ) : null}

            {Array.isArray(result.invalidRows) && result.invalidRows.length ? (
              <div className="mt-2">
                <div className="text-xs opacity-70 mb-1">Invalid rows (showing up to {result.invalidRows.length})</div>
                <div className="max-h-40 overflow-auto rounded-xl border border-black/10 dark:border-white/10">
                  {result.invalidRows.map((x: any, idx: number) => (
                    <div key={idx} className="px-2 py-1 text-xs border-b border-black/5 dark:border-white/5 last:border-0">
                      <span className="font-mono opacity-80">#{x.row}</span> {x.email ? <span className="font-mono">{x.email}</span> : <span className="opacity-70">(no email)</span>} — {x.message}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {result?.ok === false ? (
          <div className="rounded-2xl border border-black/10 dark:border-white/10 p-3 text-sm">
            <div className="font-medium">❌ {result.error || "Import failed"}</div>
            {Array.isArray(result.invalidRows) && result.invalidRows.length ? (
              <div className="mt-2">
                <div className="text-xs opacity-70 mb-1">Invalid rows</div>
                <div className="max-h-40 overflow-auto rounded-xl border border-black/10 dark:border-white/10">
                  {result.invalidRows.map((x: any, idx: number) => (
                    <div key={idx} className="px-2 py-1 text-xs border-b border-black/5 dark:border-white/5 last:border-0">
                      <span className="font-mono opacity-80">#{x.row}</span> {x.email ? <span className="font-mono">{x.email}</span> : <span className="opacity-70">(no email)</span>} — {x.message}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function SuppressionManager({ onClose, onToast, onChanged }: { onClose: () => void; onToast: (m: string) => void; onChanged: () => void }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const selectedIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected]);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / 50)), [total]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    params.set("page", String(page));
    params.set("pageSize", "50");
    fetch(`/api/suppressions/list?${params.toString()}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return await r.json();
      })
      .then((d) => {
        if (cancelled) return;
        setItems(Array.isArray(d.items) ? d.items : []);
        setTotal(Number(d.total || 0));
        setSelected({});
      })
      .catch((e: any) => {
        if (cancelled) return;
        onToast(`❌ Failed to load suppressions: ${clip(String(e?.message || e), 140)}`);
        setItems([]);
        setTotal(0);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [q, page, onToast]);

  return (
    <Modal title="Suppression list (DNC)" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search email or reason…" />
          <Badge>{loading ? "Loading…" : `${total}`}</Badge>
        </div>

        {selectedIds.length ? (
          <div className="glass p-3 flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm"><span className="font-medium">{selectedIds.length}</span> selected</div>
            <Button
              onClick={async () => {
                if (!confirm("Unsuppress selected emails?")) return;
                try {
                  const r = await fetch("/api/suppressions/delete", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ids: selectedIds }),
                  });
                  if (!r.ok) throw new Error(await r.text());
                  onToast("✅ Unsuppressed");
                  onChanged();
                  setPage(1);
                } catch (e: any) {
                  onToast(`❌ Failed: ${clip(String(e?.message || e), 140)}`);
                }
              }}
            >
              Unsuppress
            </Button>
          </div>
        ) : null}

        <div className="table-wrap">
          <table className="min-w-[520px] w-full text-sm">
            <thead className="table-head">
              <tr>
                <th className="table-cell text-left w-[44px]"></th>
                <th className="table-cell text-left">Email</th>
                <th className="table-cell text-left">Reason</th>
                <th className="table-cell text-left">Created</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t border-black/5 dark:border-white/5">
                  <td className="table-cell">
                    <input type="checkbox" checked={!!selected[it.id]} onChange={() => setSelected((p) => ({ ...p, [it.id]: !p[it.id] }))} />
                  </td>
                  <td className="table-cell font-medium">{it.email}</td>
                  <td className="table-cell"><Badge>{it.reason}</Badge></td>
                  <td className="table-cell text-xs opacity-70">{fmtDate(it.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-sm opacity-70">Page {page} of {totalPages}</div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Prev</Button>
            <Button variant="ghost" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function DuplicatesManager({ onClose, onToast, onChanged }: { onClose: () => void; onToast: (m: string) => void; onChanged: () => void }) {
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<any[]>([]);
  const [scanned, setScanned] = useState(0);
  const [primaryByGroup, setPrimaryByGroup] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/leads/duplicates", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return await r.json();
      })
      .then((d) => {
        if (cancelled) return;
        const g = Array.isArray(d.groups) ? d.groups : [];
        setGroups(g);
        setScanned(Number(d.scanned || 0));
        const init: Record<string, string> = {};
        for (const gg of g) {
          // default primary = newest (first in array due to createdAt desc)
          const first = gg?.leads?.[0]?.id;
          if (first) init[gg.key] = first;
        }
        setPrimaryByGroup(init);
      })
      .catch((e: any) => {
        if (cancelled) return;
        onToast(`❌ Failed to load duplicates: ${clip(String(e?.message || e), 140)}`);
        setGroups([]);
        setScanned(0);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onToast]);

  return (
    <Modal title="Duplicate detector + merge" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge>{loading ? "Scanning…" : `${groups.length} groups`}</Badge>
          <span className="text-sm opacity-70">Scanned: {scanned} leads (latest)</span>
          <span className="text-xs opacity-60">Tip: keep website filled to improve detection.</span>
        </div>

        {!loading && !groups.length ? <div className="text-sm opacity-70">No duplicates found (email variants + domain/name + website/name).</div> : null}

        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          {groups.map((g) => {
            const primaryId = primaryByGroup[g.key];
            const leads = Array.isArray(g.leads) ? g.leads : [];
            return (
              <div key={g.key} className="rounded-2xl border border-black/10 dark:border-white/10 p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <div className="font-medium">{g.title || g.host || "Duplicate group"}</div>
                    <div className="text-xs opacity-70">
                      <span className="mr-2"><Pill tone="info">{String(g.type || "match")}</Pill></span>
                      {g.subtitle ? <span>{g.subtitle} • </span> : null}
                      {leads.length} leads
                    </div>
                  </div>
                  <Button
                    onClick={async () => {
                      const pid = primaryByGroup[g.key];
                      if (!pid) return;
                      const dupes = leads.map((l: any) => l.id).filter((id: string) => id !== pid);
                      if (!dupes.length) return;
                      if (!confirm(`Merge ${dupes.length} into primary? This will delete duplicates.`)) return;
                      try {
                        const r = await fetch("/api/leads/merge", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ primaryId: pid, duplicateIds: dupes }),
                        });
                        if (!r.ok) throw new Error(await r.text());
                        onToast("✅ Merged");
                        setGroups((prev) => prev.filter((x) => x.key !== g.key));
                        onChanged();
                      } catch (e: any) {
                        onToast(`❌ Merge failed: ${clip(String(e?.message || e), 140)}`);
                      }
                    }}
                  >
                    Merge
                  </Button>
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-[900px] w-full text-sm">
                    <thead className="table-head">
                      <tr>
                        <th className="text-left p-2 w-[70px]">Primary</th>
                        <th className="text-left p-2">Email</th>
                        <th className="text-left p-2">Company</th>
                        <th className="text-left p-2">Website</th>
                        <th className="text-left p-2">Status</th>
                        <th className="text-left p-2">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leads.map((l: any) => (
                        <tr key={l.id} className="border-t border-black/5 dark:border-white/5">
                          <td className="p-2">
                            <input
                              type="radio"
                              name={`primary-${g.key}`}
                              checked={primaryId === l.id}
                              onChange={() => setPrimaryByGroup((p) => ({ ...p, [g.key]: l.id }))}
                            />
                          </td>
                          <td className="p-2 font-medium">{l.email}</td>
                          <td className="p-2">{l.company || "—"}</td>
                          <td className="p-2">{l.website || "—"}</td>
                          <td className="p-2"><Pill tone={toneForStatus(l.status)}>{l.status}</Pill></td>
                          <td className="p-2 text-xs opacity-70">{fmtDate(l.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

function KanbanBoard({
  items,
  selected,
  onToggleOne,
  onOpen,
  onMoveStage,
}: {
  items: LeadRow[];
  selected: Record<string, boolean>;
  onToggleOne: (id: string) => void;
  onOpen: (id: string) => void;
  onMoveStage: (id: string, stage: string) => void;
}) {
  const stages: Array<{ id: string; name: string }> = [
    { id: "new", name: "New" },
    { id: "enriched", name: "Enriched" },
    { id: "verified", name: "Verified" },
    { id: "ready", name: "Ready" },
    { id: "contacted", name: "Contacted" },
    { id: "replied", name: "Replied" },
    { id: "interested", name: "Interested" },
    { id: "not_fit", name: "Not fit" },
  ];
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  const byStage: Record<string, LeadRow[]> = {};
  for (const s of stages) byStage[s.id] = [];
  for (const it of items) {
    const st = String(it.stage || "new").toLowerCase();
    (byStage[st] || (byStage[st] = [])).push(it);
  }

  return (
    <div className="w-full max-w-full overflow-x-auto pb-2">
      <div className="flex gap-3 w-max pr-2">
      {stages.map((s) => (
        <div key={s.id} className="min-w-[260px] max-w-[260px]">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium text-sm">{s.name}</div>
            <div className="text-xs opacity-60">{(byStage[s.id] || []).length}</div>
          </div>
          <div
            className={`glass p-2 rounded-2xl flex flex-col gap-2 min-h-[120px] ${overStage === s.id ? "ring-2 ring-black/20 dark:ring-white/20" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setOverStage(s.id); }}
            onDragLeave={() => { if (overStage === s.id) setOverStage(null); }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain") || dragId;
              setOverStage(null);
              setDragId(null);
              if (id && id !== "undefined") onMoveStage(id, s.id);
            }}
          >
            {(byStage[s.id] || []).map((it) => (
              <div
                key={it.id}
                draggable
                onDragStart={(e) => {
                  setDragId(it.id);
                  try { e.dataTransfer.setData("text/plain", it.id); } catch {}
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => { setDragId(null); setOverStage(null); }}
                className={`rounded-2xl border border-black/10 dark:border-white/10 bg-white/60 dark:bg-black/20 p-2 ${dragId === it.id ? "opacity-60" : ""}`}
              >
                <div className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={!!selected[it.id]} onChange={() => onToggleOne(it.id)} />
                  <div className="flex-1">
                    <div className="font-medium text-sm truncate">{it.email}</div>
                    <div className="text-xs opacity-70 truncate">{[it.firstName, it.lastName].filter(Boolean).join(" ") || "—"}</div>
                    <div className="text-xs opacity-60 truncate">{it.company || "—"}</div>
                    {it.nextTask ? (
                      <div className="text-xs mt-1 opacity-70">⏰ {clip(it.nextTask.title, 24)}</div>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2 gap-2">
                  <button
                    className="text-xs px-2 py-1 rounded-xl border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10"
                    onClick={() => onOpen(it.id)}
                  >
                    Open
                  </button>
                  <Select
                    value={String(it.stage || "new").toLowerCase()}
                    onChange={(e) => onMoveStage(it.id, e.target.value)}
                    className="h-8 rounded-xl border border-black/10 dark:border-white/10 bg-transparent px-2 text-xs"
                  >
                    {stages.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            ))}
            {(byStage[s.id] || []).length === 0 ? <div className="text-xs opacity-50 p-2">No leads</div> : null}
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}

function LeadDrawer({ id, onClose, onToast }: { id: string; onClose: () => void; onToast: (m: string) => void }) {
  const [tab, setTab] = useState<"overview" | "timeline" | "notes" | "tasks" | "messages" | "campaigns">("overview");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);

  const [noteKind, setNoteKind] = useState<"note" | "call" | "meeting">("note");
  const [noteBody, setNoteBody] = useState<string>("");
  const [noteBusy, setNoteBusy] = useState(false);

  const [taskTitle, setTaskTitle] = useState<string>("");
  const [taskDueDate, setTaskDueDate] = useState<string>(""); // YYYY-MM-DD
  const [taskBusy, setTaskBusy] = useState(false);

  async function refreshLead() {
    setLoading(true);
    try {
      const r = await fetch(`/api/leads/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      setData(d.lead);
    } catch (e: any) {
      onToast(`❌ Failed to load lead: ${clip(String(e?.message || e), 140)}`);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  function isoFromDateInput(v: string): string | null {
    const t = String(v || "").trim();
    if (!t) return null;
    const d = new Date(`${t}T09:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function nextMondayISO(): string {
    const now = new Date();
    // JS: 0=Sun ... 1=Mon
    const day = now.getUTCDay();
    const diff = (8 - day) % 7 || 7; // days until next Monday
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff, 9, 0, 0));
    return target.toISOString();
  }

  function plusDaysISO(days: number): string {
    const now = new Date();
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, 9, 0, 0));
    return target.toISOString();
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    fetch(`/api/leads/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return await r.json();
      })
      .then((d) => {
        if (cancelled) return;
        setData(d.lead);
      })
      .catch((e: any) => {
        if (cancelled) return;
        onToast(`❌ Failed to load lead: ${clip(String(e?.message || e), 140)}`);
        setData(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, onToast]);

  const lead = data;
  const leadLists = useMemo(
    () => ({
      messages: Array.isArray(lead?.messages) ? lead.messages : [],
      enrollments: Array.isArray(lead?.enrollments) ? lead.enrollments : [],
      activities: Array.isArray(lead?.activities) ? lead.activities : [],
    }),
    [lead]
  );
  const { messages, enrollments, activities } = leadLists;

  const notes = Array.isArray(lead?.notes) ? lead.notes : [];
  const tasks = Array.isArray(lead?.tasks) ? lead.tasks : [];

  const timeline = useMemo(() => {
    const out: Array<{ at: string; type: string; text: string }> = [];
    if (lead?.createdAt) out.push({ at: String(lead.createdAt), type: "import", text: "Lead created/imported" });

    // First-class activities logged by the system (status/stage changes, verify, notes, tasks, etc.)
    for (const a of activities) {
      out.push({ at: String(a.createdAt), type: String(a.type || "activity"), text: String(a.text || "") || String(a.type || "activity") });
    }

    // Campaign + message info (not always duplicated in activities)
    for (const e of enrollments) {
      out.push({ at: String(e.createdAt), type: "enroll", text: `Enrolled in ${e.campaign?.name || "campaign"} (${e.status})` });
      if (e.updatedAt && e.updatedAt !== e.createdAt) out.push({ at: String(e.updatedAt), type: "enroll", text: `Enrollment updated (step ${e.currentStep})` });
    }
    for (const m of messages) {
      const at = m.sentAt || m.createdAt;
      const subj = m.subject ? clip(String(m.subject), 64) : "(no subject)";
      out.push({ at: String(at), type: "message", text: `${m.status}: ${subj}` });
    }

    out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return out;
  }, [lead, activities, enrollments, messages]);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full md:w-[520px] bg-white dark:bg-black border-l border-black/10 dark:border-white/10 shadow-xl p-4 overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">{lead?.email || "Lead"}</div>
            <div className="text-sm opacity-70">{[lead?.firstName, lead?.lastName, lead?.company].filter(Boolean).join(" • ") || "—"}</div>
          </div>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {(["overview", "tasks", "notes", "timeline", "messages", "campaigns"] as const).map((t) => (
            <button
              key={t}
              className={`px-3 py-1.5 rounded-xl text-sm border border-black/10 dark:border-white/10 ${tab === t ? "bg-black text-white dark:bg-white dark:text-black" : ""}`}
              onClick={() => setTab(t)}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {loading ? <div className="text-sm opacity-70">Loading…</div> : null}
          {!loading && !lead ? <div className="text-sm opacity-70">Not found.</div> : null}

          {!loading && lead && tab === "overview" ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Pill tone={toneForStatus(lead.status)}>{lead.status}</Pill>
                <Badge>Stage: {lead.stage || "new"}</Badge>
                <Badge>Created: {fmtDate(lead.createdAt)}</Badge>
              </div>
              <div className="grid grid-cols-1 gap-2">
                <div className="rounded-2xl border border-black/10 dark:border-white/10 p-3">
                  <div className="text-xs opacity-70">Website</div>
                  <div className="text-sm">{lead.website || "—"}</div>
                </div>
                <div className="rounded-2xl border border-black/10 dark:border-white/10 p-3">
                  <div className="text-xs opacity-70">Owner</div>
                  <div className="text-sm">{lead.owner?.name || lead.owner?.email || "—"}</div>
                </div>
                <div className="rounded-2xl border border-black/10 dark:border-white/10 p-3">
                  <div className="text-xs opacity-70">List</div>
                  <div className="text-sm">{lead.list?.name || "—"}</div>
                </div>
                <div className="rounded-2xl border border-black/10 dark:border-white/10 p-3">
                  <div className="text-xs opacity-70">Tags</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(String(lead.tags || "")
                      .split(",")
                      .map((t: string) => t.trim())
                      .filter(Boolean) as string[]).length
                      ? (String(lead.tags || "")
                          .split(",")
                          .map((t: string) => t.trim())
                          .filter(Boolean)
                          .slice(0, 12)
                          .map((t: string) => <Badge key={t}>{t}</Badge>))
                      : "—"}
                  </div>
                </div>
                <div className="rounded-2xl border border-black/10 dark:border-white/10 p-3">
                  <div className="text-xs opacity-70">Last email sent</div>
                  <div className="text-sm">
                    {messages.find((m: any) => m.sentAt || m.createdAt)
                      ? `${fmtDate((messages[0]?.sentAt || messages[0]?.createdAt) as any)} • ${clip(String(messages[0]?.subject || "(no subject)"), 64)}`
                      : "—"}
                  </div>
                </div>
                <div className="rounded-2xl border border-black/10 dark:border-white/10 p-3">
                  <div className="text-xs opacity-70">Next task</div>
                  <div className="text-sm">{tasks.find((t: any) => !t.completedAt) ? `${tasks.find((t: any) => !t.completedAt)?.title} • ${fmtDate(tasks.find((t: any) => !t.completedAt)?.dueAt)}` : "—"}</div>
                </div>
              </div>

              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="ghost"
                  onClick={async () => {
                    // quick task presets
                    try {
                      setTaskBusy(true);
                      const r = await fetch(`/api/leads/${encodeURIComponent(id)}/tasks`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ title: "Follow up", dueAt: plusDaysISO(3) }),
                      });
                      if (!r.ok) throw new Error(await r.text());
                      onToast("✅ Task added (Follow up in 3 days)");
                      await refreshLead();
                      setTab("tasks");
                    } catch (e: any) {
                      onToast(`❌ Failed: ${clip(String(e?.message || e), 140)}`);
                    } finally {
                      setTaskBusy(false);
                    }
                  }}
                  disabled={taskBusy}
                >
                  + Follow up (3 days)
                </Button>
                <Button
                  variant="danger"
                  onClick={async () => {
                    if (!confirm("Mark this lead as DNC (suppressed)?")) return;
                    try {
                      const r = await fetch("/api/leads/bulk", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ ids: [id], action: "dnc", reason: "manual" }),
                      });
                      if (!r.ok) throw new Error(await r.text());
                      onToast("✅ Marked as DNC");
                      onClose();
                    } catch (e: any) {
                      onToast(`❌ Failed: ${clip(String(e?.message || e), 140)}`);
                    }
                  }}
                >
                  Mark DNC
                </Button>
                <Button variant="ghost" onClick={() => { window.location.href = "/app/replies"; }}>
                  Go to Replies
                </Button>
              </div>
            </div>
          ) : null}

          {!loading && lead && tab === "notes" ? (
            <div className="space-y-3">
              <div className="glass p-3 space-y-2">
                <div className="text-xs opacity-70">Add note / call log / meeting log</div>
                <div className="grid grid-cols-1 gap-2">
                  <Select value={noteKind} onChange={(e) => setNoteKind(e.target.value as any)} className="h-10">
                    <option value="note">Note</option>
                    <option value="call">Call log</option>
                    <option value="meeting">Meeting</option>
                  </Select>
                  <TextArea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} rows={3} placeholder="Write a quick note…" />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={async () => {
                      const body = String(noteBody || "").trim();
                      if (!body) {
                        onToast("❌ Note cannot be empty");
                        return;
                      }
                      try {
                        setNoteBusy(true);
                        const r = await fetch(`/api/leads/${encodeURIComponent(id)}/notes`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ kind: noteKind, body }),
                        });
                        if (!r.ok) throw new Error(await r.text());
                        setNoteBody("");
                        onToast("✅ Note added");
                        await refreshLead();
                      } catch (e: any) {
                        onToast(`❌ Failed: ${clip(String(e?.message || e), 140)}`);
                      } finally {
                        setNoteBusy(false);
                      }
                    }}
                    disabled={noteBusy}
                  >
                    Add
                  </Button>
                  <Button variant="ghost" onClick={() => setNoteBody("")} disabled={noteBusy}>
                    Clear
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                {notes.length ? (
                  notes.map((n: any) => (
                    <div key={n.id} className="rounded-2xl border border-black/10 dark:border-white/10 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Badge>{n.kind}</Badge>
                        <div className="flex items-center gap-2">
                          <div className="text-xs opacity-60">{fmtDate(n.createdAt)}</div>
                          <Button
                            variant="ghost"
                            onClick={async () => {
                              if (!confirm("Delete this note?")) return;
                              try {
                                const r = await fetch(`/api/leads/${encodeURIComponent(id)}/notes?noteId=${encodeURIComponent(n.id)}`, { method: "DELETE" });
                                if (!r.ok) throw new Error(await r.text());
                                onToast("✅ Deleted");
                                await refreshLead();
                              } catch (e: any) {
                                onToast(`❌ Failed: ${clip(String(e?.message || e), 140)}`);
                              }
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                      <div className="text-sm mt-2 whitespace-pre-wrap">{n.body}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm opacity-70">No notes yet.</div>
                )}
              </div>
            </div>
          ) : null}

          {!loading && lead && tab === "tasks" ? (
            <div className="space-y-3">
              <div className="glass p-3 space-y-2">
                <div className="text-xs opacity-70">Add a task / reminder</div>
                <Input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="e.g. Follow up, Call, Send demo" />
                <div className="grid grid-cols-1 gap-2">
                  <div>
                    <div className="text-xs opacity-70 mb-1">Due date (optional)</div>
                    <Input type="date" value={taskDueDate} onChange={(e) => setTaskDueDate(e.target.value)} />
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setTaskTitle("Follow up");
                        setTaskDueDate(new Date(plusDaysISO(3)).toISOString().slice(0, 10));
                      }}
                    >
                      Follow up in 3 days
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setTaskTitle("Call");
                        setTaskDueDate(new Date(nextMondayISO()).toISOString().slice(0, 10));
                      }}
                    >
                      Call on Monday
                    </Button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={async () => {
                      const title = String(taskTitle || "").trim();
                      if (!title) {
                        onToast("❌ Task title is required");
                        return;
                      }
                      try {
                        setTaskBusy(true);
                        const dueAt = isoFromDateInput(taskDueDate);
                        const r = await fetch(`/api/leads/${encodeURIComponent(id)}/tasks`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ title, dueAt }),
                        });
                        if (!r.ok) throw new Error(await r.text());
                        setTaskTitle("");
                        setTaskDueDate("");
                        onToast("✅ Task added");
                        await refreshLead();
                      } catch (e: any) {
                        onToast(`❌ Failed: ${clip(String(e?.message || e), 140)}`);
                      } finally {
                        setTaskBusy(false);
                      }
                    }}
                    disabled={taskBusy}
                  >
                    Add task
                  </Button>
                  <Button variant="ghost" onClick={() => { setTaskTitle(""); setTaskDueDate(""); }} disabled={taskBusy}>
                    Clear
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                {tasks.length ? (
                  tasks.map((t: any) => {
                    const isDone = !!t.completedAt;
                    const isOverdue = !isDone && t.dueAt && new Date(t.dueAt).getTime() < Date.now();
                    return (
                      <div key={t.id} className="rounded-2xl border border-black/10 dark:border-white/10 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-medium">
                              {t.title} {isOverdue ? <Badge>Overdue</Badge> : null} {isDone ? <Badge>Done</Badge> : null}
                            </div>
                            <div className="text-xs opacity-70">Due: {t.dueAt ? fmtDate(t.dueAt) : "—"} • Created: {fmtDate(t.createdAt)}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            {!isDone ? (
                              <Button
                                variant="ghost"
                                onClick={async () => {
                                  try {
                                    const r = await fetch(`/api/leads/${encodeURIComponent(id)}/tasks`, {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ taskId: t.id, completed: true }),
                                    });
                                    if (!r.ok) throw new Error(await r.text());
                                    onToast("✅ Completed");
                                    await refreshLead();
                                  } catch (e: any) {
                                    onToast(`❌ Failed: ${clip(String(e?.message || e), 140)}`);
                                  }
                                }}
                              >
                                Mark done
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              onClick={async () => {
                                if (!confirm("Delete this task?")) return;
                                try {
                                  const r = await fetch(`/api/leads/${encodeURIComponent(id)}/tasks?taskId=${encodeURIComponent(t.id)}`, { method: "DELETE" });
                                  if (!r.ok) throw new Error(await r.text());
                                  onToast("✅ Deleted");
                                  await refreshLead();
                                } catch (e: any) {
                                  onToast(`❌ Failed: ${clip(String(e?.message || e), 140)}`);
                                }
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-sm opacity-70">No tasks yet.</div>
                )}
              </div>
            </div>
          ) : null}

          {!loading && lead && tab === "timeline" ? (
            <div className="space-y-2">
              {timeline.length ? (
                timeline.map((t, i) => (
                  <div key={i} className="rounded-2xl border border-black/10 dark:border-white/10 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs opacity-70">{t.type}</div>
                      <div className="text-xs opacity-60">{fmtDate(t.at)}</div>
                    </div>
                    <div className="text-sm mt-1">{t.text}</div>
                  </div>
                ))
              ) : (
                <div className="text-sm opacity-70">No activity yet.</div>
              )}
            </div>
          ) : null}

          {!loading && lead && tab === "messages" ? (
            <div className="space-y-2">
              {messages.length ? (
                messages.map((m: any) => (
                  <div key={m.id} className="rounded-2xl border border-black/10 dark:border-white/10 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Pill tone={toneForStatus(m.status)}>{m.status}</Pill>
                      <div className="text-xs opacity-60">{fmtDate(m.sentAt || m.createdAt)}</div>
                    </div>
                    <div className="text-sm font-medium mt-2">{m.subject || "(no subject)"}</div>
                    <div className="text-xs opacity-70 mt-1">
                      {m.campaign?.name ? `Campaign: ${m.campaign.name}` : ""}
                      {m.mailbox?.fromEmail ? ` • From: ${m.mailbox.fromEmail}` : ""}
                    </div>
                    <div className="text-sm mt-2 whitespace-pre-wrap opacity-90">{m.bodyText ? clip(String(m.bodyText), 800) : "(No text body)"}</div>
                  </div>
                ))
              ) : (
                <div className="text-sm opacity-70">No messages recorded for this lead yet.</div>
              )}
            </div>
          ) : null}

          {!loading && lead && tab === "campaigns" ? (
            <div className="space-y-2">
              {enrollments.length ? (
                enrollments.map((e: any) => (
                  <div key={e.id} className="rounded-2xl border border-black/10 dark:border-white/10 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">{e.campaign?.name || "Campaign"}</div>
                      <Badge>{e.status}</Badge>
                    </div>
                    <div className="text-xs opacity-70 mt-1">Step: {e.currentStep} • Next: {fmtDate(e.nextRunAt)}</div>
                    {e.stopReason ? <div className="text-xs opacity-70 mt-1">Stop reason: {e.stopReason}</div> : null}
                  </div>
                ))
              ) : (
                <div className="text-sm opacity-70">Not enrolled in any campaign.</div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
