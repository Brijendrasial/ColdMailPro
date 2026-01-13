"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button, Input, Pill, Select, TextArea, Modal, Kpi, EmptyState } from "@/components/ui";

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
  const [editing, setEditing] = useState<MailboxRow | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    fromEmail: "",
    replyTo: "",
    isActive: true,
    warmupEnabled: false,
    dailyLimit: 50,
    localAddress: "",
  });

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
    });
    setDrawerOpen(true);
  }

  async function saveDrawer() {
    if (!editing) return;
    setDrawerSaving(true);
    try {
      const body = {
        id: editing.id,
        data: {
          name: editForm.name,
          fromEmail: editForm.fromEmail,
          replyTo: editForm.replyTo || null,
          isActive: !!editForm.isActive,
          warmupEnabled: !!editForm.warmupEnabled,
          dailyLimit: clampInt(Number(editForm.dailyLimit), 1, 100000),
          localAddress: editForm.localAddress?.trim() ? editForm.localAddress.trim() : null,
        },
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

  function setAllSelected(on: boolean) {
    const next: Record<string, boolean> = {};
    for (const r of filteredSorted) next[r.id] = on;
    setSelected(next);
  }

  async function bulkUpdate(patch: { isActive?: boolean; dailyLimit?: number }) {
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
    <div className="grid gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <Kpi label="Mailboxes" value={kpis.total} />
        <Kpi label="Active" value={kpis.active} tone="info" />
        <Kpi label="Warmup on" value={kpis.warmup} tone="neutral" />
        <Kpi label="Needs attention" value={kpis.attention} tone={kpis.attention ? "danger" : "success"} hint={kpis.attention ? "Review health + bounce spikes" : "All good"} />
        <Kpi label="Sent today" value={kpis.sentToday} tone="neutral" />
        <Kpi label="Avg bounce (7d)" value={fmtPct(kpis.avgBounce7d)} tone={kpis.avgBounce7d >= 0.1 ? "danger" : kpis.avgBounce7d >= 0.06 ? "warning" : "success"} hint="Across mailboxes with ≥20 sent" />
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search mailboxes…" className="w-[280px]" />
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="w-[240px] text-sm"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="attention">Needs attention ({attentionCount})</option>
          </Select>
          <Button type="button" variant="ghost" onClick={refresh} disabled={loading}>
            Refresh
          </Button>
        </div>

        {anyChecked ? (
          <div className="flex items-center gap-2 flex-wrap">
            <Pill tone="info">{selectedIds.length} selected</Pill>
            <Button type="button" variant="ghost" disabled={bulkBusy} onClick={() => bulkUpdate({ isActive: true })}>
              Enable
            </Button>
            <Button type="button" variant="ghost" disabled={bulkBusy} onClick={() => bulkUpdate({ isActive: false })}>
              Disable
            </Button>
            <Button type="button" variant="ghost" disabled={bulkBusy} onClick={() => runHealthcheck(selectedIds)}>
              Run checks
            </Button>
            <div className="flex items-center gap-2">
              <Input
                value={bulkLimit}
                onChange={(e) => setBulkLimit(e.target.value)}
                placeholder="Daily limit"
                type="number"
                min={1}
                className="w-[140px]"
              />
              <Button
                type="button"
                variant="secondary"
                disabled={bulkBusy || !bulkLimit.trim()}
                onClick={() => bulkUpdate({ dailyLimit: clampInt(Number(bulkLimit), 1, 100000) })}
              >
                Set limit
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {notice ? <div className="text-sm text-emerald-700">{notice}</div> : null}
      {loading ? <div className="text-sm text-slate-600">Loading…</div> : null}

      <div className="table-wrap"><div className="overflow-auto">
        <table className="min-w-[1420px] w-full text-sm">
          <thead className="table-head">
            <tr>
              <th className="table-cell text-left w-[44px]">
                <input type="checkbox" checked={allChecked} onChange={(e) => setAllSelected(e.target.checked)} />
              </th>
              <Th label="Mailbox" onClick={() => toggleSort("name")} active={sortKey === "name"} dir={sortDir} />
              <Th label="Status" onClick={() => toggleSort("status")} active={sortKey === "status"} dir={sortDir} />
              <Th label="Alerts" onClick={() => toggleSort("needsAttention")} active={sortKey === "needsAttention"} dir={sortDir} />
              <Th label="Warmup" onClick={() => toggleSort("warmup")} active={sortKey === "warmup"} dir={sortDir} />
              <Th label="Daily" onClick={() => toggleSort("dailyLimit")} active={sortKey === "dailyLimit"} dir={sortDir} />
              <Th label="Sent today" onClick={() => toggleSort("sentToday")} active={sortKey === "sentToday"} dir={sortDir} />
              <Th label="Bounce 7d" onClick={() => toggleSort("bounceRate7d")} active={sortKey === "bounceRate7d"} dir={sortDir} />
              <Th label="Reply 7d" onClick={() => toggleSort("replyRate7d")} active={sortKey === "replyRate7d"} dir={sortDir} />
              <Th label="Last sent" onClick={() => toggleSort("lastSentAt")} active={sortKey === "lastSentAt"} dir={sortDir} />
              <Th label="Health" onClick={() => toggleSort("healthCheckedAt")} active={sortKey === "healthCheckedAt"} dir={sortDir} />
              <Th label="Last test" onClick={() => toggleSort("testAt")} active={sortKey === "testAt"} dir={sortDir} />
              <th className="table-cell text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white/60">
            {filteredSorted.map((r) => {
              const healthErr = r.health?.smtp?.error || r.health?.imap?.error || "";
              return (
                <tr
                  key={r.id}
                  className={cx(
                    "table-row",
                    r.needsAttention && "bg-red-50/40"
                  )}
                >
                  <td className="table-cell">
                    <input
                      type="checkbox"
                      checked={!!selected[r.id]}
                      onChange={(e) => setSelected((s) => ({ ...s, [r.id]: e.target.checked }))}
                    />
                  </td>

                  <td className="table-cell">
                    <div className="font-medium text-slate-900">{r.name}</div>
                    <div className="text-slate-600">{r.fromEmail}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {r.smtpHost}:{r.smtpPort}
                      {r.localAddress ? ` • bind ${r.localAddress}` : ""}
                    </div>
                  </td>

                  <td className="table-cell">
                    <div className="flex flex-wrap gap-1">
                      <Pill tone={r.isActive ? "success" : "neutral"}>{r.isActive ? "active" : "disabled"}</Pill>
                      {r.cooldown?.active && r.cooldown?.until ? (
                        <Pill tone="warning">cooldown {fmtRemaining(r.cooldown.until)}</Pill>
                      ) : null}
                    </div>
                    {!r.isActive ? <div className="text-xs text-slate-500 mt-1">—</div> : null}
                  </td>

                  <td className="table-cell">
                    <div className="flex flex-wrap gap-1">
                      {r.needsAttention ? <Pill tone="danger">needs attention</Pill> : <Pill tone="neutral">ok</Pill>}
                      {r.cooldown?.active ? <Pill tone="warning">throttled</Pill> : null}
                    </div>
                    {r.attentionReasons?.length ? (
                      <div className="text-xs text-slate-600 mt-1">
                        {clipText(r.attentionReasons.join(" • "), 90)}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500 mt-1">—</div>
                    )}
                  </td>

                  <td className="table-cell">
                    <Pill tone={r.warmupEnabled ? "info" : "neutral"}>{r.warmupEnabled ? "on" : "off"}</Pill>
                  </td>

                  <td className="table-cell font-medium text-slate-900">{r.dailyLimit}</td>
                  <td className="table-cell">{r.sentToday}</td>

                  <td className="table-cell">
                    <span className={cx(r.bounceRate7d >= 0.1 && r.sent7d >= 20 && "text-red-600 font-medium")}>{fmtPct(r.bounceRate7d)}</span>
                    <div className="text-xs text-slate-500">{r.bounced7d}/{r.sent7d || 0}</div>
                    <div className={cx("text-xs mt-0.5", r.bounceRate24h >= 0.08 && r.sent24h >= 20 ? "text-red-600" : "text-slate-500")}>
                      24h: {fmtPct(r.bounceRate24h)} ({r.bounced24h}/{r.sent24h || 0})
                    </div>
                  </td>

                  <td className="table-cell">
                    <span className={cx(r.replyRate7d >= 0.03 && r.sent7d >= 20 && "text-emerald-700 font-medium")}>{fmtPct(r.replyRate7d)}</span>
                    <div className="text-xs text-slate-500">{r.replied7d}/{r.sent7d || 0}</div>
                  </td>

                  <td className="table-cell text-slate-700">{fmtWhen(r.lastSentAt)}</td>

                  <td className="table-cell">
                    <div className="flex flex-wrap gap-1">
                      {r.health?.pending || healthBusy[r.id] ? <Pill tone="info">checking…</Pill> : null}
                      <Pill tone={r.health?.ok ? "success" : r.health?.checkedAt ? "danger" : "neutral"}>
                        {r.health?.checkedAt ? (r.health.ok ? "healthy" : "unhealthy") : "—"}
                      </Pill>
                      <Pill tone={r.health?.smtp ? (r.health.smtp.ok ? "success" : "danger") : "neutral"}>
                        SMTP {r.health?.smtp ? (r.health.smtp.ok ? "ok" : "fail") : "—"}
                      </Pill>
                      <Pill
                        tone={
                          r.health?.imap
                            ? (r.health.imap.skipped ? "neutral" : r.health.imap.ok ? "success" : "danger")
                            : "neutral"
                        }
                      >
                        IMAP {r.health?.imap ? (r.health.imap.skipped ? "n/a" : r.health.imap.ok ? "ok" : "fail") : "—"}
                      </Pill>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{fmtWhen(r.health?.checkedAt || null)}</div>

                    {healthErr ? (
                      <div className="mt-1 flex items-start justify-between gap-2">
                        <div className="text-xs text-red-600">{clipText(healthErr, 90)}</div>
                        <button
                          className="text-xs text-slate-600 hover:text-slate-900 underline"
                          onClick={async () => {
                            const ok = await copyToClipboard(healthErr);
                            setNotice(ok ? "Copied error" : "Copy failed");
                            setTimeout(() => setNotice(null), 2000);
                          }}
                          title="Copy error"
                        >
                          Copy
                        </button>
                      </div>
                    ) : null}

                    {r.healthFailCount24h >= 3 ? (
                      <div className="text-xs text-red-600 mt-1">Fails 24h: {r.healthFailCount24h}</div>
                    ) : null}
                  </td>

                  <td className="table-cell">
                    <div className="flex flex-wrap gap-1">
                      {r.lastTest?.pending ? <Pill tone="info">sending…</Pill> : null}
                      {typeof r.lastTest?.ok === "boolean" ? (
                        <Pill tone={r.lastTest.ok ? "success" : "danger"}>{r.lastTest.ok ? "sent" : "failed"}</Pill>
                      ) : (
                        <Pill tone="neutral">—</Pill>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {r.lastTest?.to ? `to ${r.lastTest.to}` : "—"} • {fmtWhen(r.lastTest?.at || null)}
                    </div>
                    {r.lastTest?.error ? <div className="text-xs text-red-600 mt-1">{clipText(r.lastTest.error, 90)}</div> : null}
                  </td>

                  <td className="table-cell text-right">
                    <div className="inline-flex items-center gap-2">
                      <Button type="button" variant="ghost" onClick={() => runHealthcheck([r.id])} disabled={!!healthBusy[r.id]}>
                        Check
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => openTestModal(r)}>
                        Test
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => openDrawer(r)}>
                        Edit
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {!loading && filteredSorted.length === 0 ? (
              <tr>
                <td colSpan={13} className="table-cell py-6 text-center text-slate-600">
                  No mailboxes found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
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
