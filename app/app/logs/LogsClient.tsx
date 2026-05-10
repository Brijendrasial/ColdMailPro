"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Badge, Button, Divider, Input, Pill, Select } from "@/components/ui";

type LogRow = {
  id: string;
  createdAt: string;
  level: string;
  category: string;
  event: string;
  message: string | null;
  data: any;
  workspaceId: string | null;
  userId: string | null;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  entityType: string | null;
  entityId: string | null;
};

function toneForLevel(level: string): "danger" | "warning" | "neutral" | "info" | "success" {
  const s = String(level || "").toLowerCase();
  if (s === "error") return "danger";
  if (s === "warn") return "warning";
  if (s === "debug") return "neutral";
  return "info";
}

function glowForLevel(level: string) {
  const s = String(level || "").toLowerCase();
  if (s === "error") return "from-rose-500 to-orange-500";
  if (s === "warn") return "from-amber-400 to-orange-500";
  if (s === "debug") return "from-slate-400 to-slate-700";
  return "from-indigo-500 to-cyan-500";
}

function prettyTime(v: any) {
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v || "-");
  }
}

function timeAgo(v: any) {
  try {
    const ms = Date.now() - new Date(v).getTime();
    if (!Number.isFinite(ms)) return "";
    const mins = Math.max(0, Math.round(ms / 60000));
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  } catch {
    return "";
  }
}

function logSummary(row: LogRow) {
  const bits = [row.category, row.event, row.entityType].filter(Boolean);
  return bits.join(" / ") || "system event";
}

export default function LogsClient({ initialLogs, initialCursor }: { initialLogs: LogRow[]; initialCursor: string | null }) {
  const [logs, setLogs] = useState<LogRow[]>(initialLogs || []);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(initialLogs?.[0]?.id || null);

  const [level, setLevel] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [event, setEvent] = useState<string>("");
  const [q, setQ] = useState<string>("");
  const [system, setSystem] = useState<boolean>(true);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const l of logs) if (l.category) set.add(String(l.category));
    return Array.from(set).sort();
  }, [logs]);

  const counts = useMemo(() => {
    return logs.reduce(
      (acc, l) => {
        const key = String(l.level || "info").toLowerCase();
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
  }, [logs]);

  const selected = useMemo(() => logs.find((l) => l.id === selectedId) || logs[0] || null, [logs, selectedId]);

  async function fetchPage(opts?: { reset?: boolean }) {
    if (loading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("take", "100");
      if (!opts?.reset && cursor) params.set("cursor", cursor);
      if (level) params.set("level", level);
      if (category) params.set("category", category);
      if (event) params.set("event", event);
      if (q) params.set("q", q);
      if (system) params.set("system", "1");

      const res = await fetch(`/api/logs/list?${params.toString()}`);
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "LOG_FETCH_FAILED");

      const newRows = (json.logs || []) as LogRow[];
      const next = json.nextCursor ? String(json.nextCursor) : null;

      if (opts?.reset) {
        setLogs(newRows);
        setSelectedId(newRows?.[0]?.id || null);
      } else {
        setLogs((prev) => [...prev, ...newRows]);
      }
      setCursor(next);
    } catch (e) {
      // Keep the observability page non-blocking if logs are temporarily unavailable.
    } finally {
      setLoading(false);
    }
  }

  function clearFilters() {
    setLevel("");
    setCategory("");
    setEvent("");
    setQ("");
    setSystem(true);
  }

  useEffect(() => {
    setCursor(null);
    fetchPage({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, category, event, q, system]);

  return (
    <section className="premium-card min-h-[840px]">
      <div className="p-4 sm:p-5 lg:p-6">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-indigo-500 shadow-[0_0_0_4px_rgba(99,102,241,0.13)]" />
              <h2 className="card-title">Unified event stream</h2>
            </div>
            <p className="card-subtitle">Filter, inspect, and trace every important app, worker, database, and mail event.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={clearFilters}>Clear</Button>
            <Button variant="secondary" onClick={() => fetchPage({ reset: true })} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Info", counts.info || 0, "info"],
            ["Warnings", counts.warn || 0, "warning"],
            ["Errors", counts.error || 0, "danger"],
            ["Debug", counts.debug || 0, "neutral"],
          ].map(([label, value, tone]) => (
            <button
              key={String(label)}
              onClick={() => setLevel(String(label).toLowerCase() === "warnings" ? "warn" : String(label).toLowerCase())}
              className="rounded-[1.35rem] border border-slate-200/80 bg-white/78 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_16px_38px_rgba(15,23,42,0.07)]"
            >
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{String(label)}</div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <div className="text-3xl font-semibold text-slate-950">{String(value)}</div>
                <Pill tone={tone as any}>filter</Pill>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-5 rounded-[1.6rem] border border-slate-200/80 bg-white/76 p-3 shadow-sm">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Level</div>
              <Select value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="">All levels</option>
                <option value="debug">debug</option>
                <option value="info">info</option>
                <option value="warn">warn</option>
                <option value="error">error</option>
              </Select>
            </div>
            <div className="md:col-span-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Category</div>
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div className="md:col-span-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Event</div>
              <Input value={event} onChange={(e) => setEvent(e.target.value)} placeholder="write / send_ok / heartbeat" />
            </div>
            <div className="md:col-span-4">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Search</div>
              <div className="flex gap-2">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="message / entity / request id / IP" />
                <Button
                  variant={system ? "secondary" : "ghost"}
                  onClick={() => setSystem((v) => !v)}
                  title="Include system logs (workspaceId=null)"
                  className="shrink-0"
                >
                  System
                </Button>
              </div>
            </div>
          </div>
        </div>

        <Divider className="my-5" />

        <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-3">
            {logs.map((l, idx) => {
              const isOpen = !!expanded[l.id];
              const active = selected?.id === l.id;
              return (
                <article
                  key={l.id}
                  className={`relative overflow-hidden rounded-[1.5rem] border bg-white/78 shadow-sm transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_18px_45px_rgba(15,23,42,0.08)] ${active ? "border-indigo-300 ring-4 ring-indigo-100/70" : "border-slate-200/80"}`}
                >
                  <div className={`absolute left-0 top-0 h-full w-1.5 bg-gradient-to-b ${glowForLevel(l.level)}`} />
                  <button type="button" className="block w-full p-4 text-left" onClick={() => setSelectedId(l.id)}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Pill tone={toneForLevel(l.level)}>{l.level || "info"}</Pill>
                          <Badge>{l.category || "uncategorized"}</Badge>
                          <Badge>{l.event || "event"}</Badge>
                          {idx === 0 ? <Pill tone="success">latest</Pill> : null}
                        </div>
                        <div className="mt-3 text-sm font-semibold text-slate-950 break-words">
                          {l.message || <span className="text-slate-500">(no message)</span>}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                          <span>{prettyTime(l.createdAt)}</span>
                          <span>{timeAgo(l.createdAt)}</span>
                          {l.requestId ? <span>req {String(l.requestId).slice(0, 12)}</span> : null}
                          {l.ip ? <span>{l.ip}</span> : null}
                          {l.entityType && l.entityId ? <span>{l.entityType}:{String(l.entityId).slice(0, 10)}</span> : null}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Trace</div>
                        <div className="mt-1 max-w-[160px] truncate text-xs font-medium text-slate-700">{logSummary(l)}</div>
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center justify-between border-t border-slate-200/70 px-4 py-3">
                    <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                      {l.workspaceId ? <Badge>workspace</Badge> : <Badge>system</Badge>}
                      {l.userId ? <Badge>user {String(l.userId).slice(0, 8)}</Badge> : null}
                    </div>
                    <Button variant="ghost" onClick={() => setExpanded((prev) => ({ ...prev, [l.id]: !isOpen }))}>
                      {isOpen ? "Hide JSON" : "Inspect JSON"}
                    </Button>
                  </div>

                  {isOpen ? (
                    <div className="px-4 pb-4">
                      <div className="max-h-[420px] overflow-auto rounded-[1.2rem] border border-slate-800 bg-slate-950 p-4 text-xs text-slate-100 shadow-inner">
                        <pre className="whitespace-pre-wrap break-words">{JSON.stringify(l, null, 2)}</pre>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}

            {logs.length === 0 ? (
              <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-white/60 p-10 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">✨</div>
                <div className="mt-4 font-semibold text-slate-950">No events match this view</div>
                <div className="mt-1 text-sm text-slate-600">Clear filters or include system logs to widen the stream.</div>
              </div>
            ) : null}

            <div className="flex items-center justify-between rounded-[1.35rem] border border-slate-200/80 bg-white/70 p-3">
              <div className="text-xs text-slate-500">Showing {logs.length} events</div>
              <Button variant="ghost" disabled={loading || !cursor} onClick={() => fetchPage()}>
                {cursor ? (loading ? "Loading..." : "Load more events") : "End of stream"}
              </Button>
            </div>
          </div>

          <aside className="hidden 2xl:block">
            <div className="sticky top-6 rounded-[1.6rem] border border-slate-200/80 bg-slate-950 p-5 text-white shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Selected event</div>
              {selected ? (
                <div className="mt-4 space-y-4">
                  <div>
                    <Pill tone={toneForLevel(selected.level)}>{selected.level || "info"}</Pill>
                    <div className="mt-3 text-lg font-semibold leading-6">{selected.message || "(no message)"}</div>
                    <div className="mt-2 text-xs text-slate-400">{prettyTime(selected.createdAt)}</div>
                  </div>
                  <div className="grid gap-2 text-xs">
                    <div className="rounded-2xl bg-white/8 p-3">
                      <div className="text-slate-500">Category</div>
                      <div className="mt-1 font-semibold">{selected.category || "-"}</div>
                    </div>
                    <div className="rounded-2xl bg-white/8 p-3">
                      <div className="text-slate-500">Event</div>
                      <div className="mt-1 font-semibold">{selected.event || "-"}</div>
                    </div>
                    <div className="rounded-2xl bg-white/8 p-3">
                      <div className="text-slate-500">Entity</div>
                      <div className="mt-1 break-all font-semibold">{selected.entityType && selected.entityId ? `${selected.entityType}:${selected.entityId}` : "-"}</div>
                    </div>
                    <div className="rounded-2xl bg-white/8 p-3">
                      <div className="text-slate-500">Request</div>
                      <div className="mt-1 break-all font-semibold">{selected.requestId || "-"}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 text-sm text-slate-400">Select an event from the stream.</div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
