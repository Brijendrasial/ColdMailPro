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

function preserveThreadSubject(...candidates: any[]): string {
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value) return normalizeReplySubject(value);
  }
  return 'Re:';
}

export async function POST(req: NextRequest) {
  try {
    const s = await requireSession();
    const body = (await req.json().catch(() => ({}))) as any;
    const aiActionId = String(body.aiActionId || "");
    if (!aiActionId) return NextResponse.json({ ok: false, error: "INVALID" }, { status: 400 });

    const ai = await prisma.replyAiAction.findFirst({
      where: { id: aiActionId, workspaceId: s.wid },
      include: {
        replyEvent: { include: { message: { include: { mailbox: true } } } },
        lead: { select: { id: true, email: true } },
      },
    });
    if (!ai) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    if (!ai.draftSubject || !ai.draftBodyText) return NextResponse.json({ ok: false, error: "NO_DRAFT" }, { status: 400 });

    const threadMsg = ai.replyEvent.message;
    if (!threadMsg.mailboxId) return NextResponse.json({ ok: false, error: "NO_MAILBOX" }, { status: 400 });

    const replyMeta = safeJsonParse((ai.replyEvent as any).meta || null);
    const inboundReplyMessageId = cleanMsgId(replyMeta.replyMessageId || replyMeta.messageId || null);
    const originalOutboundMessageId = cleanMsgId(threadMsg.messageId || threadMsg.inReplyTo || null);
    const inReplyTo = inboundReplyMessageId || originalOutboundMessageId || null;
    const references = collectMsgIds(originalOutboundMessageId, replyMeta.references, inboundReplyMessageId).join(" ") || undefined;
    const subject = preserveThreadSubject(replyMeta.subject, threadMsg.subject, ai.draftSubject);

    const info = await sendEmail({
      mailboxId: threadMsg.mailboxId,
      to: ai.lead.email,
      subject,
      text: ai.draftBodyText,
      inReplyTo: inReplyTo || undefined,
      references,
      headers: {
        "X-ColdMailPro-AIReply": "1",
        "X-ColdMailPro-ReplyEvent": ai.replyEventId,
        "X-ColdMailPro-AIAction": ai.id,
      },
    });

    const now = new Date();
    const newMsg = await prisma.message.create({
      data: {
        workspaceId: s.wid,
        mailboxId: threadMsg.mailboxId,
        leadId: ai.lead.id,
        subject,
        bodyText: ai.draftBodyText,
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
        meta: JSON.stringify({ kind: "ai_reply", replyEventId: ai.replyEventId, aiActionId: ai.id }),
      },
    });

    await prisma.replyAiAction.update({
      where: { id: ai.id },
      data: { action: "sent", sentMessageId: newMsg.id },
    });

    // Convenience label so humans can filter quickly
    try {
      const cur = await prisma.replyLeadState.findUnique({ where: { workspaceId_leadId: { workspaceId: s.wid, leadId: ai.leadId } } });
      const labels: string[] = Array.isArray((cur as any)?.labels) ? (cur as any).labels.map(String) : [];
      if (!labels.includes("ai_sent")) labels.push("ai_sent");
      await prisma.replyLeadState.upsert({
        where: { workspaceId_leadId: { workspaceId: s.wid, leadId: ai.leadId } },
        create: { workspaceId: s.wid, leadId: ai.leadId, status: "open", labels: labels as any },
        update: { labels: labels as any },
      });
    } catch {}

    return NextResponse.json({ ok: true, messageId: newMsg.id });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ ok: false, error: "FAILED", detail: String(e?.message || e) }, { status: 500 });
  }
}
