import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mailer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cleanMsgId(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/<[^>]+>/);
  return (m ? m[0] : s) || null;
}

function collectMsgIds(...values: any[]): string[] {
  const out: string[] = [];
  const add = (value: any) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) add(item);
      return;
    }
    const raw = String(value);
    const matches = raw.match(/<[^>]+>/g);
    if (matches?.length) {
      for (const m of matches) {
        const id = cleanMsgId(m);
        if (id && !out.includes(id)) out.push(id);
      }
      return;
    }
    const id = cleanMsgId(raw);
    if (id && !out.includes(id)) out.push(id);
  };
  for (const value of values) add(value);
  return out;
}

function safeJsonParse(s: string | null | undefined): any {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}

function normalizeReplySubject(subject: any, fallbackSubject?: any): string {
  const raw = String(subject || fallbackSubject || '').trim();
  const base = raw || 'Re:';
  return /^\s*re\s*:/i.test(base) ? base : `Re: ${base}`;
}

// Send a manual reply from the Replies tab.
// Creates a new Message row and a sent event for audit.

export async function POST(req: NextRequest) {
  try {
    const s = await requireSession();
    const body = (await req.json().catch(() => ({}))) as any;
    const leadId = String(body.leadId || "");
    const replyToMessageDbId = String(body.replyToMessageDbId || "");
    const subject = String(body.subject || "").trim();
    const bodyText = String(body.bodyText || "").trim();
    if (!leadId || !replyToMessageDbId || !subject || !bodyText) {
      return NextResponse.json({ error: "INVALID" }, { status: 400 });
    }

    const lead = await prisma.lead.findFirst({ where: { id: leadId, workspaceId: s.wid } });
    if (!lead) return NextResponse.json({ error: "LEAD_NOT_FOUND" }, { status: 404 });

    const replyTo = await prisma.message.findFirst({
      where: { id: replyToMessageDbId, workspaceId: s.wid },
      include: { mailbox: true },
    });
    if (!replyTo) return NextResponse.json({ error: "THREAD_TARGET_NOT_FOUND" }, { status: 404 });
    if (!replyTo.mailboxId) return NextResponse.json({ error: "NO_MAILBOX" }, { status: 400 });

    const latestInbound = await prisma.event.findFirst({
      where: { messageId: replyTo.id, type: "reply" },
      orderBy: { createdAt: "desc" },
      select: { id: true, meta: true },
    }).catch(() => null as any);
    const latestInboundMeta = safeJsonParse(latestInbound?.meta || null);

    // RFC message-id threading. Reply to the inbound reply when available; keep the outbound message in References.
    const inboundReplyMessageId = cleanMsgId(latestInboundMeta.replyMessageId || latestInboundMeta.messageId || null);
    const originalOutboundMessageId = cleanMsgId(replyTo.messageId || replyTo.inReplyTo || null);
    const inReplyTo = inboundReplyMessageId || originalOutboundMessageId || null;
    const references = collectMsgIds(originalOutboundMessageId, latestInboundMeta.references, inboundReplyMessageId).join(" ") || undefined;
    const replySubject = normalizeReplySubject(subject, latestInboundMeta.subject || replyTo.subject || "Re:");

    const info = await sendEmail({
      mailboxId: replyTo.mailboxId,
      to: lead.email,
      subject: replySubject,
      text: bodyText,
      inReplyTo: inReplyTo || undefined,
      references,
      headers: latestInbound?.id ? { "X-ColdMailPro-ReplyEvent": latestInbound.id } : undefined,
    });

    const now = new Date();
    const newMsg = await prisma.message.create({
      data: {
        workspaceId: s.wid,
        mailboxId: replyTo.mailboxId,
        leadId: lead.id,
        subject: replySubject,
        bodyText,
        bodyHtml: null,
        messageId: info.messageId,
        inReplyTo: inReplyTo || undefined,
        status: "sent",
        sentAt: now,
      },
    });

    await prisma.event.create({
      data: {
        messageId: newMsg.id,
        type: "sent",
        meta: JSON.stringify({ kind: "manual_reply", replyToMessageDbId }),
      },
    });

    return NextResponse.json({ ok: true, messageId: newMsg.id });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: "FAILED" }, { status: 500 });
  }
}
