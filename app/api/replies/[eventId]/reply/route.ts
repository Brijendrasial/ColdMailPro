import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mailer";

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n) : s;
}

function pickEmailAddress(v: any): string | null {
  if (!v) return null;
  const s = String(v);
  const m = s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

export async function POST(
  req: Request,
  ctx: { params: { eventId: string } }
) {
  const s = await requireSession();
  const eventId = String(ctx.params.eventId || "");

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const to = String(body.to || "").trim();
  const subject = clip(String(body.subject || "Re:").trim() || "Re:", 200);
  const text = clip(String(body.text || "").trim(), 40_000);

  if (!to || !to.includes("@")) {
    return NextResponse.json({ error: "INVALID_TO" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "EMPTY_BODY" }, { status: 400 });
  }

  const ev = await prisma.event.findFirst({
    where: { id: eventId, type: "reply", message: { workspaceId: s.wid } },
    include: {
      message: {
        include: {
          mailbox: true,
          lead: true,
          campaign: true,
        },
      },
    },
  });

  if (!ev) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  let meta: any = {};
  try {
    meta = JSON.parse(ev.meta || "{}");
  } catch {
    meta = {};
  }

  const mailboxId = ev.message.mailboxId || meta.mailboxId || ev.message.mailbox?.id || null;
  if (!mailboxId) return NextResponse.json({ error: "MISSING_MAILBOX" }, { status: 400 });

  // Ensure the reply goes back to the same person who replied.
  // If client passes some other address, we still allow it but we also keep a safe default.
  const defaultTo = pickEmailAddress(meta.fromAddress || meta.from || ev.message.lead?.email) || to.toLowerCase();
  const finalTo = pickEmailAddress(to) || defaultTo;

  const inReplyTo = String(meta.replyMessageId || meta.messageId || ev.message.messageId || "").trim() || undefined;
  const references = [ev.message.messageId, meta.replyMessageId]
    .filter(Boolean)
    .map((x) => String(x))
    .join(" ") || undefined;

  // Link to a Lead so future replies can fallback-match even when headers are missing.
  const leadEmail = finalTo.toLowerCase();
  const lead = await prisma.lead
    .upsert({
      where: { workspaceId_email: { workspaceId: s.wid, email: leadEmail } },
      update: {},
      create: { workspaceId: s.wid, email: leadEmail },
    })
    .catch(() => null);

  const msg = await prisma.message.create({
    data: {
      workspaceId: s.wid,
      mailboxId,
      campaignId: ev.message.campaignId,
      leadId: lead?.id || null,
      subject,
      bodyText: text,
      inReplyTo: inReplyTo || null,
      status: "queued",
    },
  });

  try {
    const res = await sendEmail({
      mailboxId,
      to: finalTo,
      subject,
      text,
      inReplyTo,
      references,
      headers: {
        "X-ColdMailPro-ManualReply": "1",
        "X-ColdMailPro-ReplyEvent": ev.id,
        "X-ColdMailPro-Message": msg.id,
      },
    });

    await prisma.message
      .update({
        where: { id: msg.id },
        data: {
          status: "sent",
          sentAt: new Date(),
          messageId: res.messageId || null,
          leadId: lead?.id || null,
        },
      })
      .catch(() => {});

    await prisma.event
      .create({
        data: {
          messageId: msg.id,
          type: "sent",
          meta: JSON.stringify({ kind: "manual_reply", to: finalTo, replyEventId: ev.id }),
        },
      })
      .catch(() => {});

    return NextResponse.json({ ok: true, messageId: res.messageId || null });
  } catch (e: any) {
    const err = clip(String(e?.message || e), 2000);
    await prisma.message.update({ where: { id: msg.id }, data: { status: "failed", error: err } }).catch(() => {});
    return NextResponse.json({ error: "SEND_FAILED", detail: clip(err, 300) }, { status: 500 });
  }
}
