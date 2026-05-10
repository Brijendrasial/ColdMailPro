import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aiExtractMeetingTimeFromReply } from "@/lib/ai";
import { createGoogleMeetEvent } from "@/lib/google-calendar";
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

function getGcalCfg(settingsJson: any) {
  const gc = (settingsJson || {})?.repliesAi?.googleCalendar || {};
  return {
    enabled: Boolean(gc.enabled),
    minTimeConfidence: typeof gc.minTimeConfidence === "number" ? gc.minTimeConfidence : Number(gc.minTimeConfidence || 0.8),
    defaultDurationMin: typeof gc.defaultDurationMin === "number" ? gc.defaultDurationMin : Number(gc.defaultDurationMin || 30),
    timezone: typeof gc.timezone === "string" ? gc.timezone : "Asia/Kolkata",
  };
}

export async function POST(req: NextRequest) {
  try {
    const s = await requireSession();
    const body = (await req.json().catch(() => ({}))) as any;
    const aiActionId = String(body.aiActionId || "");
    const sendNow = body.sendNow !== false;
    if (!aiActionId) return NextResponse.json({ ok: false, error: "INVALID" }, { status: 400 });

    const ws = await prisma.workspace.findUnique({ where: { id: s.wid }, select: { settingsJson: true } });
    const cfg = getGcalCfg(ws?.settingsJson as any);
    if (!cfg.enabled) return NextResponse.json({ ok: false, error: "GCAL_DISABLED" }, { status: 400 });

    const ai = await prisma.replyAiAction.findFirst({
      where: { id: aiActionId, workspaceId: s.wid },
      include: {
        replyEvent: { include: { message: { include: { mailbox: true } } } },
        lead: { select: { id: true, email: true } },
      },
    });
    if (!ai) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

    const metaRaw = (ai.replyEvent as any)?.meta as string | null;
    let inboundSubject: string | null = null;
    let inboundBodyText: string = "";
    try {
      const m = metaRaw ? JSON.parse(metaRaw) : {};
      inboundSubject = typeof m.subject === "string" ? m.subject : null;
      inboundBodyText = typeof m.bodyText === "string" ? m.bodyText : "";
    } catch {}

    // If we can't parse inbound, fall back to existing draft only.
    if (!inboundBodyText) inboundBodyText = ai.draftBodyText || "";

    const mt = await aiExtractMeetingTimeFromReply({
      inboundSubject,
      inboundBodyText,
      defaultTimezone: cfg.timezone,
      defaultDurationMin: cfg.defaultDurationMin,
    });

    const minT = Math.max(0, Math.min(1, Number(cfg.minTimeConfidence || 0.8)));
    if (!mt.hasTime || (mt.confidence || 0) < minT || !mt.startIso || !mt.endIso) {
      return NextResponse.json({ ok: true, scheduled: false, confidence: mt.confidence || 0 });
    }

    const ev = await createGoogleMeetEvent({
      workspaceId: s.wid,
      attendeeEmail: ai.lead.email,
      summary: `Meeting with ${ai.lead.email}`,
      description: `Scheduled from Replies tab (AI).\n\nReply snippet:\n${(inboundBodyText || "").slice(0, 1200)}`,
      startIso: mt.startIso,
      endIso: mt.endIso,
      timezone: mt.timezone || cfg.timezone,
    });

    const meetLink = ev.meetLink || null;
    const when = mt.startIso;
    const tz = mt.timezone || cfg.timezone || "";
    const subject = normalizeReplySubject(ai.draftSubject, inboundSubject || "Re:");
    const replyText = `Perfect — I’ve sent a calendar invite for ${when}${tz ? " (" + tz + ")" : ""}.` +
      (meetLink ? `\n\nGoogle Meet: ${meetLink}` : "") +
      `\n\nIf you need a different time, just reply with your availability.`;

    await prisma.replyAiAction.update({
      where: { id: ai.id },
      data: {
        scheduledProvider: "google",
        scheduledEventId: ev.eventId || null,
        scheduledMeetLink: meetLink,
        scheduledStart: new Date(mt.startIso),
        scheduledEnd: new Date(mt.endIso),
        scheduledConfidence: mt.confidence,
        draftSubject: subject,
        draftBodyText: replyText,
        action: "drafted",
      },
    });

    // label for filtering
    try {
      const cur = await prisma.replyLeadState.findUnique({ where: { workspaceId_leadId: { workspaceId: s.wid, leadId: ai.leadId } } });
      const labels: string[] = Array.isArray((cur as any)?.labels) ? (cur as any).labels.map(String) : [];
      if (!labels.includes("ai_meeting_scheduled")) labels.push("ai_meeting_scheduled");
      await prisma.replyLeadState.upsert({
        where: { workspaceId_leadId: { workspaceId: s.wid, leadId: ai.leadId } },
        create: { workspaceId: s.wid, leadId: ai.leadId, status: "follow_up", labels: labels as any },
        update: { labels: labels as any },
      });
    } catch {}

    if (!sendNow) {
      return NextResponse.json({ ok: true, scheduled: true, sent: false, meetLink });
    }

    const threadMsg = ai.replyEvent.message;
    if (!threadMsg.mailboxId) return NextResponse.json({ ok: false, error: "NO_MAILBOX" }, { status: 400 });

    const replyMeta = safeJsonParse((ai.replyEvent as any).meta || null);
    const inboundReplyMessageId = cleanMsgId(replyMeta.replyMessageId || replyMeta.messageId || null);
    const originalOutboundMessageId = cleanMsgId(threadMsg.messageId || threadMsg.inReplyTo || null);
    const inReplyTo = inboundReplyMessageId || originalOutboundMessageId || null;
    const references = collectMsgIds(originalOutboundMessageId, replyMeta.references, inboundReplyMessageId).join(" ") || undefined;

    const info = await sendEmail({
      mailboxId: threadMsg.mailboxId,
      to: ai.lead.email,
      subject,
      text: replyText,
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
        bodyText: replyText,
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
        meta: JSON.stringify({ kind: "ai_reply", replyEventId: ai.replyEventId, aiActionId: ai.id, scheduledEventId: ev.eventId || null }),
      },
    }).catch(() => {});

    await prisma.replyAiAction.update({ where: { id: ai.id }, data: { action: "sent", sentMessageId: newMsg.id } });

    return NextResponse.json({ ok: true, scheduled: true, sent: true, meetLink, messageId: newMsg.id });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ ok: false, error: "FAILED", detail: String(e?.message || e) }, { status: 500 });
  }
}
