"use client";

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { Badge, Button, Card, Input, Pill, Select, Modal, TextArea, Kpi, EmptyState } from "@/components/ui";
import { formatDateTimeUTC } from "@/lib/date";

type CampaignMini = { id: string; name: string; status: string };
type LeadViewRow = { id: string; name: string; payload: any; updatedAt?: string };

type MailboxMini = { id: string; name: string; fromEmail: string; isActive: boolean };

export type LeadRow = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  website?: string | null;
  status: string;
  tags: string[];
  createdAt: string;
  enrollmentsCount: number;
  campaigns: CampaignMini[];
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
  const [tag, setTag] = useState<string>("");
  const [contacted, setContacted] = useState<string>(""); // "" | "1" | "0"

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

  // Modals
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showSuppressions, setShowSuppressions] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
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
  const [companyImportBusy, setCompanyImportBusy] = useState<boolean>(false);
  const [companyDiscoverDiag, setCompanyDiscoverDiag] = useState<any>(null);
  // Per-email verification state for AI-discovered emails (ping-email)
  const [companyVerifyMode, setCompanyVerifyMode] = useState<"smtp" | "no_smtp">("no_smtp");
  const [companyRequireMailbox, setCompanyRequireMailbox] = useState<boolean>(false);
  const [companyVerifyMap, setCompanyVerifyMap] = useState<
    Record<string, { status: "idle" | "busy" | "valid" | "invalid" | "error"; message?: string }>
  >({});
  // Only company-domain inboxes are importable (import endpoint filters by domain anyway).
  // Keep "other" emails selectable for reference/copy, but don't treat them as import candidates.
  const discoveredSelected = useMemo(
    () => [...companyDiscovered, ...companySuggested, ...companyManualEmails]
      .filter((x) => !!companyDiscoveredSel[x.email])
      .map((x) => x.email),
    [companyDiscovered, companySuggested, companyManualEmails, companyDiscoveredSel]
  );

  const discoveredNotVerified = useMemo(
    () => discoveredSelected.filter((e) => companyVerifyMap[e]?.status !== "valid"),
    [discoveredSelected, companyVerifyMap]
  );

  const canImportDiscovered = discoveredSelected.length > 0 && discoveredNotVerified.length === 0 && !companyImportBusy;

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
  }, [q, status, tag, contacted, pageSize]);

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

  // Load leads list
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status && status !== "all") params.set("status", status);
    if (tag.trim()) params.set("tag", tag.trim());
    if (contacted) params.set("contacted", contacted);
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
  }, [q, status, tag, contacted, page, pageSize, refreshKey]);

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

  async function bulk(
    action: "tag_add" | "tag_remove" | "set_status" | "dnc" | "unsuppress" | "enroll_campaign" | "stop_campaigns" | "delete",
    payload: any = {}
  ) {
    if (!selectedIds.length) return;
    setLoading(true);
    try {
      const r = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, action, ...payload }),
      });
      if (!r.ok) throw new Error(await r.text());
      notify("✅ Updated");
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

    const exists = [...companyDiscovered, ...companySuggested, ...companyManualEmails].some((x) => String(x.email || "").toLowerCase() === e);
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
      setCompanyVerifyMap((m) => ({
        ...m,
        [e]: { status: valid ? "valid" : "invalid", message },
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
    const emails = discoveredSelected;
    if (!emails.length) {
      notify("⚠️ Select at least one email to import");
      return;
    }

    if (discoveredNotVerified.length) {
      notify(`⚠️ Verify selected emails first (${discoveredNotVerified.length} pending/invalid)`);
      return;
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
      const enriched = Number(j.enriched || 0);
      notify(`✅ Imported ${created} leads (skipped ${skipped} duplicates) · enriched ${enriched}`);
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
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-xl font-semibold">Leads</div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge>{loading ? "Loading…" : `${total} leads`}</Badge>
          <Button variant="primary" onClick={openAddModal}>
            Add lead
          </Button>
          <Button variant="ghost" onClick={() => setShowImport(true)}>
            Import wizard
          </Button>
          <Button variant="ghost" onClick={() => setShowSuppressions(true)}>
            Suppressions
          </Button>
          <Button variant="ghost" onClick={() => setShowDuplicates(true)}>
            Duplicates
          </Button>
        </div>
      </div>

      <Card
        title="Leads"
        subtitle="Views, filters, bulk actions, and a lead drawer (timeline + messages + campaigns)."
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" onClick={saveCurrentView}>
              Save view
            </Button>
            <Button variant="ghost" onClick={openAiSegmentsModal}>
              ✨ AI segments
            </Button>
            <Button variant="ghost" onClick={openCompanyEnrichModal}>
              ✨ Enrich by website
            </Button>
            {activeViewId ? (
              <Button variant="danger" onClick={deleteActiveView}>
                Delete view
              </Button>
            ) : null}
            <Select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="h-9 rounded-xl border border-black/10 dark:border-white/10 bg-transparent px-2 text-sm"
            >
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
              <option value={200}>200 / page</option>
            </Select>
          </div>
        }
      >        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-4">
          <Kpi label="Total leads" value={pageStats.total} />
          <Kpi label="On this page" value={pageStats.pageTotal} tone="info" />
          <Kpi label="Selected" value={pageStats.selected} tone={pageStats.selected ? "warning" : "neutral"} />
          <Kpi label="Active" value={pageStats.active} tone="info" />
          <Kpi label="Replied" value={pageStats.replied} tone="success" />
          <Kpi label="Bounced" value={pageStats.bounced} tone={pageStats.bounced ? "danger" : "neutral"} />
        </div>

        {/* Views (presets + saved) */}
        <div className="flex flex-wrap gap-2 mb-3">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => applyViewPayload(p.payload, null)}
              className="px-3 py-1.5 rounded-xl text-sm border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10"
            >
              {p.name}
            </button>
          ))}
          {views.length ? <span className="mx-1 opacity-40">|</span> : null}
          {views.map((v) => (
            <button
              key={v.id}
              onClick={() => applyViewPayload(v.payload, v.id)}
              className={`px-3 py-1.5 rounded-xl text-sm border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 ${activeViewId === v.id ? "bg-indigo-600 text-white border-indigo-600" : ""}`}
              title="Shared workspace view"
            >
              {v.name}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
            <div className="md:col-span-5">
              <div className="text-xs opacity-70 mb-1">Search</div>
              <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); setActiveViewId(null); }} placeholder="email, name, company, website, tags…" />
            </div>

            <div className="md:col-span-2">
              <div className="text-xs opacity-70 mb-1">Status</div>
              <Select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                  setActiveViewId(null);
                }}
                className="h-10 w-full rounded-xl border border-black/10 dark:border-white/10 bg-transparent px-3 text-sm"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="replied">Replied</option>
                <option value="unsubscribed">Unsubscribed</option>
                <option value="bounced">Bounced</option>
                <option value="suppressed">Suppressed (DNC)</option>
              </Select>
            </div>

            <div className="md:col-span-2">
              <div className="text-xs opacity-70 mb-1">Contacted</div>
              <Select
                value={contacted}
                onChange={(e) => {
                  setContacted(e.target.value);
                  setPage(1);
                  setActiveViewId(null);
                }}
                className="h-10 w-full rounded-xl border border-black/10 dark:border-white/10 bg-transparent px-3 text-sm"
              >
                <option value="">Any</option>
                <option value="1">Contacted</option>
                <option value="0">Not contacted</option>
              </Select>
            </div>

            <div className="md:col-span-2">
              <div className="text-xs opacity-70 mb-1">Tag contains</div>
              <Input value={tag} onChange={(e) => { setTag(e.target.value); setPage(1); setActiveViewId(null); }} placeholder="e.g. saas" />
            </div>

            <div className="md:col-span-1 flex gap-2">
              <Button variant="ghost" onClick={() => { setQ(""); setStatus("all"); setTag(""); setContacted(""); setPage(1); setActiveViewId(null); }}>
                Reset
              </Button>
            </div>
          </div>

          {/* Bulk bar */}
          {selectedIds.length ? (
            <div className="glass p-3 flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm">
                <span className="font-medium">{selectedIds.length}</span> selected
              </div>
              <div className="flex items-center flex-wrap gap-2">
                <Button variant="ghost" onClick={openAiTagsModal}>
                  ✨ AI tags
                </Button>
                <Button variant="ghost" onClick={openAiEnrichModal}>
                  ✨ AI enrich
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    const t = prompt("Add tags (comma separated):", "");
                    if (t === null) return;
                    bulk("tag_add", { tags: t });
                  }}
                >
                  + Tag
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    const t = prompt("Remove tags (comma separated):", "");
                    if (t === null) return;
                    bulk("tag_remove", { tags: t });
                  }}
                >
                  − Tag
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    const s = prompt("Set status (active/replied/unsubscribed/bounced/suppressed):", "active");
                    if (s === null) return;
                    bulk("set_status", { status: s });
                  }}
                >
                  Set status
                </Button>
                <Button variant="ghost" onClick={openEnrollModal}>
                  Add to campaign
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (confirm("Stop ALL campaign enrollments for selected leads?")) bulk("stop_campaigns");
                  }}
                >
                  Stop campaigns
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    // download CSV from server
                    (async () => {
                      try {
                        const r = await fetch("/api/leads/export", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ ids: selectedIds }),
                        });
                        if (!r.ok) throw new Error(await r.text());
                        const blob = await r.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);
                      } catch (e: any) {
                        notify(`❌ Export failed: ${clip(String(e?.message || e), 140)}`);
                      }
                    })();
                  }}
                >
                  Export CSV
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    if (confirm("Mark selected leads as DNC (suppressed)?")) bulk("dnc", { reason: "manual" });
                  }}
                >
                  DNC
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (confirm("Unsuppress selected leads (remove from suppression list)?")) bulk("unsuppress");
                  }}
                >
                  Unsuppress
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    if (confirm("Delete selected leads? This cannot be undone.")) bulk("delete");
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          ) : null}

          {/* Table */}
          <div className="table-wrap">
            <table className="min-w-[1060px] w-full text-sm">
              <thead className="table-head">
                <tr>
                  <th className="table-cell text-left w-[44px]">
                    <input type="checkbox" checked={allChecked} onChange={(e) => toggleAll(e.target.checked)} />
                  </th>
                  <th className="table-cell text-left">Lead</th>
                  <th className="table-cell text-left">Company</th>
                  <th className="table-cell text-left">Tags</th>
                  <th className="table-cell text-left">Status</th>
                  <th className="table-cell text-left">Campaigns</th>
                  <th className="table-cell text-left">Last activity</th>
                  <th className="table-cell text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const name = [it.firstName, it.lastName].filter(Boolean).join(" ");
                  const company = it.company || "—";
                  const last = it.lastMessage;
                  const lastLine = last ? `${last.status}${last.campaign?.name ? ` • ${last.campaign.name}` : ""}` : "—";
                  const lastAt = last?.sentAt || last?.createdAt || it.createdAt;
                  return (
                    <tr key={it.id} className="table-row">
                      <td className="table-cell">
                        <input type="checkbox" checked={!!selected[it.id]} onChange={() => toggleOne(it.id)} />
                      </td>
                      <td className="table-cell">
                        <div className="font-medium">{it.email}</div>
                        <div className="text-xs opacity-70">{name || "—"}</div>
                      </td>
                      <td className="table-cell">
                        <div className="font-medium">{clip(company, 28)}</div>
                        <div className="text-xs opacity-70">{it.website ? clip(it.website, 34) : "—"}</div>
                      </td>
                      <td className="table-cell">
                        <div className="flex flex-wrap gap-1">
                          {it.tags?.length ? it.tags.slice(0, 3).map((t) => <Badge key={t}>{t}</Badge>) : <span className="opacity-60">—</span>}
                          {it.tags?.length > 3 ? <Badge>+{it.tags.length - 3}</Badge> : null}
                        </div>
                      </td>
                      <td className="table-cell">
                        <Pill tone={toneForStatus(it.status)}>{it.status}</Pill>
                      </td>
                      <td className="table-cell">
                        <div className="flex flex-wrap gap-1">
                          {it.campaigns?.length ? it.campaigns.slice(0, 2).map((c) => <Badge key={c.id}>{clip(c.name, 18)}</Badge>) : <span className="opacity-60">—</span>}
                          {it.campaigns?.length > 2 ? <Badge>+{it.campaigns.length - 2}</Badge> : null}
                        </div>
                      </td>
                      <td className="table-cell">
                        <div className="text-xs opacity-80">{lastLine}</div>
                        <div className="text-xs opacity-60">{fmtDate(lastAt)}</div>
                      </td>
                      <td className="table-cell">
                        <div className="flex gap-2">
                          <Button variant="ghost" onClick={() => setDrawerId(it.id)}>
                            View
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              if (
                                confirm("Mark this lead as DNC (suppressed)?")
                              ) {
                                (async () => {
                                  try {
                                    const r = await fetch("/api/leads/bulk", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ ids: [it.id], action: "dnc", reason: "manual" }),
                                    });
                                    if (!r.ok) throw new Error(await r.text());
                                    notify("✅ Marked as DNC");
                                    setRefreshKey((k) => k + 1);
                                  } catch (e: any) {
                                    notify(`❌ Failed: ${clip(String(e?.message || e), 140)}`);
                                  }
                                })();
                              }
                            }}
                          >
                            DNC
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!loading && items.length === 0 ? <EmptyState title="No leads found" subtitle="Try adjusting your filters, or import a CSV to get started." /> : null}

          {/* Pagination */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm opacity-70">
              Page {page} of {totalPages}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setPage(1)} disabled={page <= 1}>
                First
              </Button>
              <Button variant="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                Prev
              </Button>
              <Button variant="ghost" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                Next
              </Button>
              <Button variant="ghost" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>
                Last
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {drawerId ? <LeadDrawer id={drawerId} onClose={() => setDrawerId(null)} onToast={notify} /> : null}

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
          onClose={() => {
            setShowCompanyEnrich(false);
            setCompanyEnrichBusy(false);
          }}
          footer={
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs opacity-70">
                1) Discover inboxes on the website  2) Verify with ping-email  3) Import as leads.
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => setShowCompanyEnrich(false)}>
                  Close
                </Button>
                <Button variant="primary" onClick={runCompanyDiscover} disabled={companyDiscoverBusy || !String(companyWebsiteUrl || "").trim()}>
                  {companyDiscoverBusy ? "Running…" : "Run enrich"}
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-3">
            <div className="text-xs opacity-70">
              Paste a company website (e.g. <span className="font-mono">https://acme.com</span>). Click <span className="font-medium">Run enrich</span> to discover inboxes,
              then select the ones you want, verify via ping-email, and import as leads.
            </div>

            <div>
              <div className="text-xs opacity-70 mb-1">Company website URL</div>
              <Input value={companyWebsiteUrl} onChange={(e) => setCompanyWebsiteUrl(e.target.value)} placeholder="https://example.com" />
            </div>

            <div className="glass p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <div className="text-sm font-medium">Find emails on the website (then let AI explain them)</div>
                  <div className="text-xs opacity-70">
                    We fetch a few public pages (homepage/contact/etc.), extract company-domain emails, then AI labels what each inbox is for.
                  </div>
                  <label className="flex items-center gap-2 text-xs opacity-80 mt-2 select-none">
                    <input type="checkbox" checked={companyIncludeSuggested} onChange={(e) => setCompanyIncludeSuggested(e.target.checked)} />
                    Also generate AI inbox suggestions (unverified)
                  </label>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div>
                      <div className="text-xs opacity-70 mb-1">Verification mode (ping-email)</div>
                      <Select
                        value={companyVerifyMode}
                        onChange={(e) => setCompanyVerifyMode(e.target.value === "smtp" ? "smtp" : "no_smtp")}
                      >
                        <option value="no_smtp">Safe: syntax + domain + MX (fast, low risk)</option>
                        <option value="smtp">Full: MX + SMTP probe (slower)</option>
                      </Select>
                      <div className="text-[11px] opacity-60 mt-1">
                        Note: some providers (e.g. Gmail) may not reliably disclose mailbox existence.
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs opacity-80 select-none md:mt-6">
                      <input
                        type="checkbox"
                        checked={companyRequireMailbox}
                        onChange={(e) => setCompanyRequireMailbox(e.target.checked)}
                        disabled={companyVerifyMode === "no_smtp"}
                      />
                      Require mailbox confirmation (SMTP only)
                    </label>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button variant="ghost" onClick={runCompanyDiscover} disabled={companyDiscoverBusy || !String(companyWebsiteUrl || "").trim()}>
                    {companyDiscoverBusy ? "Discovering…" : "Discover emails"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const sel: Record<string, boolean> = {};
                      for (const it of [...companyDiscovered, ...companySuggested, ...companyManualEmails]) sel[it.email] = true;
                      setCompanyDiscoveredSel(sel);
                    }}
                    disabled={companyDiscoverBusy || (!companyDiscovered.length && !companySuggested.length && !companyManualEmails.length)}
                  >
                    Select all
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setCompanyDiscoveredSel({})}
                    disabled={companyDiscoverBusy || (!companyDiscovered.length && !companySuggested.length && !companyManualEmails.length)}
                  >
                    Clear
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={verifySelectedCompanyEmails}
                    disabled={companyDiscoverBusy || companyImportBusy || !discoveredSelected.length}
                  >
                    Verify selected
                  </Button>
                  <Button variant="primary" onClick={importDiscoveredEmails} disabled={!canImportDiscovered}>
                    {companyImportBusy ? "Importing…" : `Import (${discoveredSelected.length || 0})`}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={runCompanyEnrich}
                    disabled={companyDiscoverBusy || companyImportBusy || companyEnrichBusy || !String(companyWebsiteUrl || "").trim()}
                    title="Optional: fill missing fields for existing leads whose email domain matches this website"
                  >
                    {companyEnrichBusy ? "Enriching…" : "Enrich matching leads"}
                  </Button>
                </div>
              </div>

              {companyDiscoverNote ? <div className="text-xs opacity-60 mt-2">{companyDiscoverNote}</div> : null}

              {discoveredSelected.length && discoveredNotVerified.length ? (
                <div className="text-xs opacity-70 mt-2">
                  ⚠️ Verify before importing: {discoveredNotVerified.length} selected email{discoveredNotVerified.length === 1 ? "" : "s"} pending/invalid.
                </div>
              ) : null}

              <div className="mt-3 glass p-3">
                <div className="text-xs font-medium">Manual check before adding</div>
                <div className="text-xs opacity-70 mt-1">
                  Paste any email you want to verify (including a correction to an AI suggestion). After it becomes ✅ Valid, you can add it to the import list.
                </div>

                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <Input
                    value={companyManualEmail}
                    onChange={(e) => setCompanyManualEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="min-w-[240px] flex-1"
                  />
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
                  <Button
                    variant="primary"
                    onClick={() => addManualCompanyEmail(companyManualNorm)}
                    disabled={!companyManualNorm || companyVerifyMap[companyManualNorm]?.status !== "valid"}
                  >
                    Add
                  </Button>
                </div>

                {companyManualNorm ? (
                  <div className="text-xs opacity-70 mt-2" title={companyVerifyMap[companyManualNorm]?.message || ""}>
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

              {companyManualEmails.length ? (
                <div className="mt-3">
                  <div className="text-xs font-medium mb-2">Manually added (verified)</div>
                  <div className="space-y-2 max-h-40 overflow-auto">
                    {companyManualEmails.map((it) => (
                      <label key={it.email} className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={!!companyDiscoveredSel[it.email]}
                          onChange={(e) => setCompanyDiscoveredSel((m) => ({ ...m, [it.email]: e.target.checked }))}
                        />
                        <div className="min-w-0">
                          <div className="font-mono break-all">{it.email}</div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-xs opacity-70" title={companyVerifyMap[it.email]?.message || ""}>
                              {companyVerifyMap[it.email]?.status === "valid" ? "✅ Valid" : companyVerifyMap[it.email]?.status === "busy" ? "⏳ Verifying…" : companyVerifyMap[it.email]?.status === "error" ? "⚠️ Error" : "Not verified"}
                            </span>
                            <Button
                              variant="ghost"
                              className="px-2 py-1 text-xs rounded-lg"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                verifyCompanyEmail(it.email);
                              }}
                              disabled={companyVerifyMap[it.email]?.status === "busy"}
                            >
                              {companyVerifyMap[it.email]?.status === "valid" ? "Re-verify" : "Verify"}
                            </Button>
                          </div>
                          <div className="text-xs opacity-60 break-all mt-0.5">Source: manually added</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {companyDiscovered.length ? (
                <div className="mt-3">
                  <div className="text-xs font-medium mb-2">Emails published on the website</div>
                  <div className="space-y-2 max-h-56 overflow-auto">
                    {companyDiscovered.map((it) => (
                      <label key={it.email} className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={!!companyDiscoveredSel[it.email]}
                          onChange={(e) => setCompanyDiscoveredSel((m) => ({ ...m, [it.email]: e.target.checked }))}
                        />
                        <div className="min-w-0">
                          <div className="font-mono break-all">{it.email}</div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span
                              className="text-xs opacity-70"
                              title={companyVerifyMap[it.email]?.message || ""}
                            >
                              {companyVerifyMap[it.email]?.status === "valid"
                                ? "✅ Valid"
                                : companyVerifyMap[it.email]?.status === "invalid"
                                  ? "❌ Invalid"
                                  : companyVerifyMap[it.email]?.status === "busy"
                                    ? "⏳ Verifying…"
                                    : companyVerifyMap[it.email]?.status === "error"
                                      ? "⚠️ Error"
                                      : "Not verified"}
                            </span>
                            <Button
                              variant="ghost"
                              className="px-2 py-1 text-xs rounded-lg"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                verifyCompanyEmail(it.email);
                              }}
                              disabled={companyVerifyMap[it.email]?.status === "busy"}
                            >
                              {companyVerifyMap[it.email]?.status === "valid" ? "Re-verify" : "Verify"}
                            </Button>
                          </div>
                          <div className="text-xs opacity-70 mt-0.5">
                            AI: <span className="font-medium">{it.purpose || "other"}</span>
                            {typeof it.confidence === "number" ? <span className="opacity-70"> · {(it.confidence * 100).toFixed(0)}%</span> : null}
                            {it.recommended ? <span className="ml-1">· ✅ ok for outreach</span> : <span className="ml-1">· 🚫 avoid outreach</span>}
                          </div>
                          {it.notes ? <div className="text-xs opacity-60 mt-0.5">{it.notes}</div> : null}
                          {it.evidenceUrls?.length ? (
                            <div className="text-xs opacity-60 mt-0.5 break-all">
                              Found on: {it.evidenceUrls.slice(0, 2).map((u, idx) => (
                                <span key={u}>
                                  <a className="underline" href={u} target="_blank" rel="noreferrer">page {idx + 1}</a>
                                  {idx === 0 && it.evidenceUrls!.length > 2 ? <span className="opacity-60"> (+{it.evidenceUrls!.length - 2} more)</span> : null}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {companySuggested.length ? (
                <div className="mt-3">
                  <div className="text-xs font-medium mb-2">AI-suggested inboxes (unverified)</div>
                  <div className="space-y-2 max-h-56 overflow-auto">
                    {companySuggested.map((it) => (
                      <label key={it.email} className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={!!companyDiscoveredSel[it.email]}
                          onChange={(e) => setCompanyDiscoveredSel((m) => ({ ...m, [it.email]: e.target.checked }))}
                        />
                        <div className="min-w-0">
                          <div className="font-mono break-all">{it.email}</div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span
                              className="text-xs opacity-70"
                              title={companyVerifyMap[it.email]?.message || ""}
                            >
                              {companyVerifyMap[it.email]?.status === "valid"
                                ? "✅ Valid"
                                : companyVerifyMap[it.email]?.status === "invalid"
                                  ? "❌ Invalid"
                                  : companyVerifyMap[it.email]?.status === "busy"
                                    ? "⏳ Verifying…"
                                    : companyVerifyMap[it.email]?.status === "error"
                                      ? "⚠️ Error"
                                      : "Not verified"}
                            </span>
                            <Button
                              variant="ghost"
                              className="px-2 py-1 text-xs rounded-lg"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                verifyCompanyEmail(it.email);
                              }}
                              disabled={companyVerifyMap[it.email]?.status === "busy"}
                            >
                              {companyVerifyMap[it.email]?.status === "valid" ? "Re-verify" : "Verify"}
                            </Button>
                          </div>
                          <div className="text-xs opacity-70 mt-0.5">
                            AI: <span className="font-medium">{it.purpose || "other"}</span>
                            {typeof it.confidence === "number" ? <span className="opacity-70"> · {(it.confidence * 100).toFixed(0)}%</span> : null}
                            {it.recommended ? <span className="ml-1">· ✅ ok for outreach</span> : <span className="ml-1">· 🚫 avoid outreach</span>}
                          </div>
                          {it.notes ? <div className="text-xs opacity-60 mt-0.5">{it.notes}</div> : null}
                          <div className="text-xs opacity-60 break-all mt-0.5">Source: AI suggested (unverified)</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}


              {companyManualEmails.length ? (
                <div className="mt-3">
                  <div className="text-xs font-medium mb-2">Manually added emails</div>
                  <div className="space-y-2 max-h-40 overflow-auto">
                    {companyManualEmails.map((it) => (
                      <label key={it.email} className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={!!companyDiscoveredSel[it.email]}
                          onChange={(e) => setCompanyDiscoveredSel((m) => ({ ...m, [it.email]: e.target.checked }))}
                        />
                        <div className="min-w-0">
                          <div className="font-mono break-all">{it.email}</div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-xs opacity-70" title={companyVerifyMap[it.email]?.message || ""}>
                              {companyVerifyMap[it.email]?.status === "valid"
                                ? "✅ Valid"
                                : companyVerifyMap[it.email]?.status === "invalid"
                                  ? "❌ Invalid"
                                  : companyVerifyMap[it.email]?.status === "busy"
                                    ? "⏳ Verifying…"
                                    : companyVerifyMap[it.email]?.status === "error"
                                      ? "⚠️ Error"
                                      : "Not verified"}
                            </span>
                            <Button
                              variant="ghost"
                              className="px-2 py-1 text-xs rounded-lg"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                verifyCompanyEmail(it.email);
                              }}
                              disabled={companyVerifyMap[it.email]?.status === "busy"}
                            >
                              {companyVerifyMap[it.email]?.status === "valid" ? "Re-verify" : "Verify"}
                            </Button>
                          </div>
                          <div className="text-xs opacity-60 break-all mt-0.5">Source: manually added</div>
                          {it.notes ? <div className="text-xs opacity-60 mt-0.5">{it.notes}</div> : null}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {companyOtherEmails.length ? (
                <div className="mt-3">
                  <div className="text-xs font-medium mb-2">Other public emails (not company domain)</div>
                  <div className="space-y-2 max-h-40 overflow-auto">
                    {companyOtherEmails.map((it) => (
                      <label key={it.email} className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={!!companyDiscoveredSel[it.email]}
                          onChange={(e) => setCompanyDiscoveredSel((m) => ({ ...m, [it.email]: e.target.checked }))}
                        />
                        <div>
                          <div className="font-mono">{it.email}</div>
                          <div className="text-xs opacity-60 break-all">Source: {it.sourceUrl}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {companyContactForms.length ? (
                <div className="mt-3 glass p-3">
                  <div className="text-xs font-medium">Contact forms found</div>
                  <div className="text-xs opacity-70 mt-1">If the site does not publish emails, these are the best official ways to reach them.</div>
                  <div className="mt-2 space-y-1 max-h-40 overflow-auto">
                    {companyContactForms.map((f, idx) => (
                      <div key={`${f.url}-${idx}`} className="text-xs break-all">
                        <a className="underline" href={f.url} target="_blank" rel="noreferrer">{f.url}</a>
                        {f.sourceUrl && f.sourceUrl !== f.url ? (
                          <span className="opacity-60"> — found on {f.sourceUrl}</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {!companyDiscovered.length && !companySuggested.length && !companyOtherEmails.length && !companyContactForms.length ? (
                <div className="text-sm opacity-70 mt-3">No emails found yet.</div>
              ) : null}
            </div>

            {companyEnrichResult ? (
              <div className="glass p-3">
                <div className="text-sm font-medium">Result</div>
                <div className="text-xs opacity-70 mt-1">Website: <span className="font-mono">{companyEnrichResult.website}</span></div>
                <div className="text-xs opacity-70 mt-1">Matched leads: {companyEnrichResult.matched}</div>
                <div className="text-xs opacity-70 mt-1">Updated (filled missing): {companyEnrichResult.updated}</div>
                <div className="text-xs opacity-70 mt-1">Discovered emails (AI): {companyEnrichResult.discovered}</div>
                <div className="text-xs opacity-70 mt-1">New leads created: {companyEnrichResult.created}</div>
                {companyEnrichResult.note ? <div className="text-xs opacity-60 mt-2">{companyEnrichResult.note}</div> : null}
                {companyEnrichResult.rationale ? (
                  <div className="mt-3">
                    <div className="text-xs font-medium mb-1">Notes</div>
                    <div className="text-sm whitespace-pre-wrap">{companyEnrichResult.rationale}</div>
                  </div>
                ) : null}
              </div>
            ) : null}
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
                      Some providers may still return "unknown" for privacy reasons.
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
  }, [q, page]);

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
  }, []);

  return (
    <Modal title="Duplicate detector + merge" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge>{loading ? "Scanning…" : `${groups.length} groups`}</Badge>
          <span className="text-sm opacity-70">Scanned: {scanned} leads (latest)</span>
          <span className="text-xs opacity-60">Tip: keep website filled to improve detection.</span>
        </div>

        {!loading && !groups.length ? <div className="text-sm opacity-70">No duplicates found (based on website host + name).</div> : null}

        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          {groups.map((g) => {
            const primaryId = primaryByGroup[g.key];
            const leads = Array.isArray(g.leads) ? g.leads : [];
            return (
              <div key={g.key} className="rounded-2xl border border-black/10 dark:border-white/10 p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <div className="font-medium">{g.host}</div>
                    <div className="text-xs opacity-70">{g.name} • {leads.length} leads</div>
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

function LeadDrawer({ id, onClose, onToast }: { id: string; onClose: () => void; onToast: (m: string) => void }) {
  const [tab, setTab] = useState<"overview" | "timeline" | "messages" | "campaigns">("overview");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);

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
  }, [id]);

  const lead = data;
  const messages = Array.isArray(lead?.messages) ? lead.messages : [];
  const enrollments = Array.isArray(lead?.enrollments) ? lead.enrollments : [];

  const timeline = useMemo(() => {
    const out: { at: string; type: string; text: string }[] = [];
    if (lead?.createdAt) out.push({ at: String(lead.createdAt), type: "import", text: "Lead created/imported" });
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
  }, [lead, enrollments, messages]);

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
          {(["overview", "timeline", "messages", "campaigns"] as const).map((t) => (
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
                <Badge>Created: {fmtDate(lead.createdAt)}</Badge>
              </div>
              <div className="grid grid-cols-1 gap-2">
                <div className="rounded-2xl border border-black/10 dark:border-white/10 p-3">
                  <div className="text-xs opacity-70">Website</div>
                  <div className="text-sm">{lead.website || "—"}</div>
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
              </div>

              <div className="flex gap-2 flex-wrap">
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
