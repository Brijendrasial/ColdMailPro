import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mailer";

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

    // RFC message-id for threading (best effort)
    const inReplyTo = replyTo.messageId || replyTo.inReplyTo || null;
    const references = replyTo.messageId || null;

    const info = await sendEmail({
      mailboxId: replyTo.mailboxId,
      to: lead.email,
      subject,
      text: bodyText,
      inReplyTo: inReplyTo || undefined,
      references: references || undefined,
    });

    const now = new Date();
    const newMsg = await prisma.message.create({
      data: {
        workspaceId: s.wid,
        mailboxId: replyTo.mailboxId,
        leadId: lead.id,
        subject,
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
