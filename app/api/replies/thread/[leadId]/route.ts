import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function safeJsonParse(s: string | null | undefined) {
  if (!s) return {} as any;
  try {
    return JSON.parse(s);
  } catch {
    return {} as any;
  }
}

function normalizeLabels(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 25);
  if (typeof v === "string") {
    return v
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 25);
  }
  return [];
}

export async function GET(_req: Request, ctx: { params: { leadId: string } }) {
  try {
    const s = await requireSession();
    const leadId = String(ctx.params.leadId || "");

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, workspaceId: s.wid },
      select: { id: true, email: true, firstName: true, lastName: true, company: true },
    });
    if (!lead) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

    const stateRow = await prisma.replyLeadState.findUnique({
      where: { workspaceId_leadId: { workspaceId: s.wid, leadId } },
    });

    const state = {
      status: stateRow?.status || "open",
      isPinned: Boolean(stateRow?.isPinned),
      isStarred: Boolean(stateRow?.isStarred),
      snoozeUntil: stateRow?.snoozeUntil ? stateRow.snoozeUntil.toISOString() : null,
      labels: normalizeLabels(stateRow?.labels),
      assignedToUserId: stateRow?.assignedToUserId || null,
    };

    // Which outbound message does the latest inbound reply map to?
    const latestReply = await prisma.event.findFirst({
      where: { type: "reply", message: { workspaceId: s.wid, leadId } },
      orderBy: { createdAt: "desc" },
      include: { message: { select: { id: true, mailboxId: true, messageId: true, subject: true, mailbox: { select: { fromEmail: true } } } } },
    });

    const target = latestReply
      ? {
          replyToMessageDbId: latestReply.message.id,
          mailboxId: latestReply.message.mailboxId || null,
          mailboxFromEmail: latestReply.message.mailbox?.fromEmail || null,
          inReplyTo: latestReply.message.messageId || null,
          references: latestReply.message.messageId || null,
          subjectHint: latestReply.message.subject || null,
        }
      : null;

    // Pull timeline: outbound sent messages + inbound replies (events)
    const messages = await prisma.message.findMany({
      where: { workspaceId: s.wid, leadId },
      include: {
        mailbox: { select: { fromEmail: true, name: true } },
        events: { where: { type: "reply" }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    });

    const timeline: any[] = [];
    for (const m of messages) {
      // Outbound: show messages that were actually sent (campaign or manual)
      if (m.sentAt || m.status === "sent") {
        timeline.push({
          kind: "outbound",
          createdAt: (m.sentAt || m.createdAt).toISOString(),
          subject: m.subject || null,
          fromMailbox: m.mailbox?.fromEmail || null,
          bodyText: m.bodyText || null,
          bodyHtml: m.bodyHtml || null,
          status: m.status,
        });
      }
      for (const e of m.events) {
        const meta = safeJsonParse(e.meta);
        timeline.push({
          kind: "inbound",
          createdAt: e.createdAt.toISOString(),
          subject: meta.subject || null,
          from: meta.fromAddress || meta.from || null,
          bodyText: meta.bodyText || null,
          bodyHtml: meta.bodyHtml || null,
          snippet: meta.snippet || null,
        });
      }
    }

    timeline.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return NextResponse.json({ lead, state, target, timeline });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: "FAILED" }, { status: 500 });
  }
}
