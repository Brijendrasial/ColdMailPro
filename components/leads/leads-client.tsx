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
