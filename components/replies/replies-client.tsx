"use client";

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { Badge, Button, Card, Input, TextArea } from "@/components/ui";
import { formatDateTimeUTC } from "@/lib/date";

export type ReplyListItem = {
  id: string; // Event.id
  createdAt: string; // ISO
  meta: {
    from?: string | null;
    fromAddress?: string | null;
    subject?: string | null;
    date?: string | null;
    snippet?: string | null;
    uid?: number | null;
  };
  message: {
    id: string;
    subject?: string | null;
    mailbox?: { id: string; fromEmail: string; name: string } | null;
    lead?: { email: string } | null;
    campaign?: { name: string } | null;
  };
};

type ReplyDetail = {
  eventId: string;
  createdAt: string;
  meta: any;
  message: {
    id: string;
    subject?: string | null;
    bodyText?: string | null;
    bodyHtml?: string | null;
    messageId?: string | null;
    mailbox?: { id: string; fromEmail: string; name: string } | null;
    lead?: { email: string } | null;
    campaign?: { name: string } | null;
  };
};

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n) : s;
}

function pickEmailAddress(v: any): string | null {
  if (!v) return null;
  const s = String(v);
  const m = s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

function sanitizeHtml(html: string): string {
  let out = html;
  // remove high-risk tags
  out = out.replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, "");
  out = out.replace(/<\s*style[^>]*>[\s\S]*?<\s*\/\s*style\s*>/gi, "");
  out = out.replace(/<\s*iframe[^>]*>[\s\S]*?<\s*\/\s*iframe\s*>/gi, "");
  out = out.replace(/<\s*(object|embed)[^>]*>[\s\S]*?<\s*\/\s*(object|embed)\s*>/gi, "");
  // strip inline event handlers (onclick, onload, ...)
  out = out.replace(/\son\w+\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\son\w+\s*=\s*'[^']*'/gi, "");
  return out;
}

function niceSubject(s: string | null | undefined) {
  const v = (s || "").trim();
  return v || "(no subject)";
}

export function RepliesClient({ items }: { items: ReplyListItem[] }) {
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id || null);
  const [detail, setDetail] = useState<ReplyDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((x) => {
      const parts = [
        x.meta?.from,
        x.meta?.fromAddress,
        x.meta?.subject,
        x.message?.lead?.email,
        x.message?.mailbox?.fromEmail,
        x.message?.campaign?.name,
      ]
        .filter(Boolean)
        .map((v) => String(v).toLowerCase());
      return parts.some((p) => p.includes(s));
    });
  }, [items, q]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setDetail(null);
    fetch(`/api/replies/${encodeURIComponent(selectedId)}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return (await r.json()) as ReplyDetail;
      })
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
      })
      .catch(() => {
        if (cancelled) return;
        setDetail(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  function openComposer() {
    if (!detail) return;
    const meta = detail.meta || {};
    const to = pickEmailAddress(meta.fromAddress || meta.from || detail.message.lead?.email) || "";
    const subj0 = meta.subject || detail.message.subject || "";
    const subj = subj0.match(/^\s*re\s*:/i) ? subj0 : `Re: ${subj0 || ""}`.trim();

    const replyAt = meta.date ? formatDateTimeUTC(meta.date) : formatDateTimeUTC(detail.createdAt);
    const quoted =
      meta.bodyText || meta.text || "";

    const quoteBlock = quoted
      ? `\n\n\nOn ${replyAt}, ${meta.from || to || "sender"} wrote:\n> ${String(quoted)
          .split(/\r?\n/)
          .map((l) => l || "")
          .join("\n> ")}`
      : "";

    setComposeTo(to);
    setComposeSubject(subj || "Re:");
    setComposeBody(quoteBlock ? `Hi,\n\n${quoteBlock}` : "Hi,\n\n");
    setComposeOpen(true);
  }

  async function sendReply() {
    if (!detail) return;
    const to = composeTo.trim();
    const subject = composeSubject.trim() || "Re:";
    const text = composeBody.trim();
    if (!to || !to.includes("@")) {
      toast.error("Invalid To address");
      return;
    }
    if (!text) {
      toast.error("Reply body is empty");
      return;
    }

    setSending(true);
    try {
      const r = await fetch(`/api/replies/${encodeURIComponent(detail.eventId)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, text }),
      });
      if (!r.ok) throw new Error(await r.text());
      setComposeOpen(false);
      toast.success("Reply sent");
    } catch (e: any) {
      toast.error(`Send failed: ${clip(String(e?.message || e), 120)}`);
    } finally {
      setSending(false);
    }
  }

  const active = useMemo(() => filtered.find((x) => x.id === selectedId) || null, [filtered, selectedId]);

  const meta = detail?.meta || {};
  const fromLine = meta.from || active?.meta?.from || active?.message?.lead?.email || "Unknown sender";
  const toLine = detail?.message?.mailbox?.fromEmail || active?.message?.mailbox?.fromEmail || "Mailbox";
  const subjectLine = niceSubject(meta.subject || detail?.message?.subject || active?.meta?.subject || active?.message?.subject);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-xl font-semibold">Replies</div>
        <Badge>Last 100</Badge>
      </div>


      <Card
        title="Inbound replies (auto-detected via IMAP)"
        subtitle="Click any reply to read it like Gmail, and send a manual reply back."
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search replies (from, subject, lead, campaign…)"
            />
            <Button variant="ghost" type="button" onClick={() => setQ("")}>Clear</Button>
          </div>

          <div className="rounded-2xl border border-black/10 dark:border-white/10 overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-[360px_1fr]">
              {/* list */}
              <div className="border-b md:border-b-0 md:border-r border-black/10 dark:border-white/10">
                <div className="max-h-[70vh] overflow-auto">
                  {filtered.map((e) => {
                    const isActive = e.id === selectedId;
                    const when = e.meta?.date || e.createdAt;
                    const line2 = e.meta?.subject || e.message.subject || "(no subject)";
                    const line1 = e.meta?.fromAddress || e.meta?.from || e.message.lead?.email || "Unknown";
                    const snippet = e.meta?.snippet || "";
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => setSelectedId(e.id)}
                        className={
                          "w-full text-left px-4 py-3 border-b border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 transition " +
                          (isActive ? "bg-black/5 dark:bg-white/5" : "")
                        }
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium truncate">{line1}</div>
                          <div className="text-xs opacity-70 shrink-0">{formatDateTimeUTC(when)}</div>
                        </div>
                        <div className="text-sm opacity-85 truncate mt-0.5">{line2}</div>
                        {snippet ? <div className="text-xs opacity-60 truncate mt-0.5">{snippet}</div> : null}
                        <div className="text-xs opacity-60 mt-1 flex flex-wrap gap-2">
                          <span>Campaign: {e.message.campaign?.name || "-"}</span>
                          <span>Lead: {e.message.lead?.email || "-"}</span>
                        </div>
                      </button>
                    );
                  })}

                  {filtered.length === 0 ? (
                    <div className="p-4 text-sm opacity-70">No replies match your search.</div>
                  ) : null}
                </div>
              </div>

              {/* reader */}
              <div className="p-4">
                {!selectedId ? (
                  <div className="text-sm opacity-70">Select a reply to read.</div>
                ) : loading ? (
                  <div className="text-sm opacity-70">Loading…</div>
                ) : !detail ? (
                  <div className="text-sm opacity-70">Could not load this reply.</div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="text-lg font-semibold break-words">{subjectLine}</div>
                        <div className="text-sm opacity-80 mt-1 break-words">
                          <span className="font-medium">From:</span> {fromLine}
                        </div>
                        <div className="text-sm opacity-80 break-words">
                          <span className="font-medium">To:</span> {toLine}
                        </div>
                        <div className="text-xs opacity-70 mt-1">
                          {formatDateTimeUTC(meta.date || detail.createdAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button type="button" onClick={openComposer}>Reply</Button>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-black/10 dark:border-white/10 overflow-hidden">
                      <div className="p-4">
                        {meta.bodyHtml ? (
                          <div
                            className="prose prose-sm max-w-none dark:prose-invert"
                            dangerouslySetInnerHTML={{ __html: sanitizeHtml(String(meta.bodyHtml)) }}
                          />
                        ) : meta.bodyText ? (
                          <pre className="whitespace-pre-wrap text-sm leading-6">{String(meta.bodyText)}</pre>
                        ) : (
                          <div className="text-sm opacity-70">
                            Reply body is not stored yet. (Update worker: new replies will include body.)
                          </div>
                        )}
                      </div>
                    </div>

                    <details className="rounded-2xl border border-black/10 dark:border-white/10 p-3">
                      <summary className="cursor-pointer text-sm font-medium">Original outbound message</summary>
                      <div className="mt-3">
                        {detail.message.bodyHtml ? (
                          <div
                            className="prose prose-sm max-w-none dark:prose-invert"
                            dangerouslySetInnerHTML={{ __html: sanitizeHtml(String(detail.message.bodyHtml)) }}
                          />
                        ) : detail.message.bodyText ? (
                          <pre className="whitespace-pre-wrap text-sm leading-6">{String(detail.message.bodyText)}</pre>
                        ) : (
                          <div className="text-sm opacity-70">(No body saved for the original message)</div>
                        )}
                      </div>
                    </details>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* compose modal */}
      {composeOpen ? (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30 p-3">
          <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-black border border-black/10 dark:border-white/10 shadow-xl overflow-hidden">
            <div className="p-4 border-b border-black/10 dark:border-white/10 flex items-center justify-between gap-2">
              <div className="font-semibold">Reply</div>
              <Button variant="ghost" type="button" onClick={() => setComposeOpen(false)}>
                Close
              </Button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <div className="text-xs opacity-70 mb-1">To</div>
                <Input value={composeTo} onChange={(e) => setComposeTo(e.target.value)} placeholder="recipient@example.com" />
              </div>
              <div>
                <div className="text-xs opacity-70 mb-1">Subject</div>
                <Input value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} placeholder="Re: …" />
              </div>
              <div>
                <div className="text-xs opacity-70 mb-1">Message</div>
                <TextArea value={composeBody} onChange={(e) => setComposeBody(e.target.value)} />
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" type="button" onClick={() => setComposeOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" onClick={sendReply} disabled={sending}>
                  {sending ? "Sending…" : "Send"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
