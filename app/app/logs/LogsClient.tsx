"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Card, Input, Select, Button, Pill, Badge, Divider } from "@/components/ui";

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

function toneForLevel(level: string): any {
  const s = String(level || "").toLowerCase();
  if (s === "error") return "danger";
  if (s === "warn") return "warning";
  if (s === "debug") return "neutral";
  return "info";
}

function prettyTime(v: any) {
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

export default function LogsClient({ initialLogs, initialCursor }: { initialLogs: LogRow[]; initialCursor: string | null }) {
  const [logs, setLogs] = useState<LogRow[]>(initialLogs || []);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [level, setLevel] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [event, setEvent] = useState<string>("");
  const [q, setQ] = useState<string>("");
  const [system, setSystem] = useState<boolean>(true);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const l of logs) set.add(String(l.category || ""));
    return Array.from(set).sort();
  }, [logs]);

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
      } else {
        setLogs((prev) => [...prev, ...newRows]);
      }
      setCursor(next);
    } catch (e) {
      // ignore; toast will show via caller if needed
    } finally {
      setLoading(false);
    }
  }

  // Refetch when filters change
  useEffect(() => {
    setCursor(null);
    fetchPage({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, category, event, q, system]);

  return (
    <Card
      title="Unified Logs"
      subtitle="Everything that happens in the app: DB writes, worker jobs, mail sends, webhooks, UI errors, and more."
      right={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => fetchPage({ reset: true })}>
            Refresh
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
        <div>
          <div className="text-xs text-slate-500 mb-1">Level</div>
          <Select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">All</option>
            <option value="debug">debug</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </Select>
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-1">Category</div>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-1">Event</div>
          <Input value={event} onChange={(e) => setEvent(e.target.value)} placeholder="e.g. write / send_ok" />
        </div>
        <div className="sm:col-span-2">
          <div className="text-xs text-slate-500 mb-1">Search</div>
          <div className="flex gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="message / entity / category" />
            <Button
              variant={system ? "secondary" : "ghost"}
              onClick={() => setSystem((v) => !v)}
              title="Include system logs (workspaceId=null)"
            >
              System
            </Button>
          </div>
        </div>
      </div>

      <Divider className="my-4" />

      <div className="grid gap-2">
        {logs.map((l) => {
          const isOpen = !!expanded[l.id];
          return (
            <div key={l.id} className="rounded-2xl border border-slate-200 bg-white/60">
              <div className="p-3 sm:p-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Pill tone={toneForLevel(l.level)}>{l.level}</Pill>
                    <Badge>{l.category}</Badge>
                    <Badge>{l.event}</Badge>
                    {l.entityType && l.entityId ? (
                      <Badge>
                        {l.entityType}:{String(l.entityId).slice(0, 10)}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-2 text-sm text-slate-900 break-words">
                    {l.message || <span className="text-slate-500">(no message)</span>}
                  </div>
                  <div className="mt-1 text-xs text-slate-500 flex gap-2 flex-wrap">
                    <span>{prettyTime(l.createdAt)}</span>
                    {l.requestId ? <span>req: {String(l.requestId).slice(0, 12)}</span> : null}
                    {l.ip ? <span>ip: {l.ip}</span> : null}
                  </div>
                </div>

                <div className="shrink-0 flex items-center gap-2">
                  <Button variant="ghost" onClick={() => setExpanded((prev) => ({ ...prev, [l.id]: !isOpen }))}>
                    {isOpen ? "Hide" : "Details"}
                  </Button>
                </div>
              </div>

              {isOpen ? (
                <div className="px-3 sm:px-4 pb-4">
                  <div className="rounded-2xl bg-slate-900 text-slate-100 p-3 overflow-auto text-xs">
                    <pre className="whitespace-pre-wrap break-words">{JSON.stringify(l, null, 2)}</pre>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}

        {logs.length === 0 ? <div className="text-sm text-slate-600">No logs yet.</div> : null}

        <div className="flex items-center justify-between pt-2">
          <div className="text-xs text-slate-500">Showing {logs.length} events</div>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={loading || !cursor} onClick={() => fetchPage()}>
              {cursor ? (loading ? "Loading..." : "Load more") : "End"}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
