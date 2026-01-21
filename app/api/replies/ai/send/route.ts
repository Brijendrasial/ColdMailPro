import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mailer";

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

    const inReplyTo = threadMsg.messageId || threadMsg.inReplyTo || null;
    const references = threadMsg.messageId || null;

    const info = await sendEmail({
      mailboxId: threadMsg.mailboxId,
      to: ai.lead.email,
      subject: ai.draftSubject,
      text: ai.draftBodyText,
      inReplyTo: inReplyTo || undefined,
      references: references || undefined,
    });

    const now = new Date();
    const newMsg = await prisma.message.create({
      data: {
        workspaceId: s.wid,
        mailboxId: threadMsg.mailboxId,
        leadId: ai.lead.id,
        subject: ai.draftSubject,
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
