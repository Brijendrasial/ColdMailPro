import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  ctx: { params: { eventId: string } }
) {
  const s = await requireSession();
  const { eventId } = ctx.params;

  const ev = await prisma.event.findFirst({
    where: { id: eventId, type: "reply", message: { workspaceId: s.wid } },
    include: {
      message: {
        include: {
          mailbox: { select: { id: true, fromEmail: true, name: true } },
          lead: { select: { email: true } },
          campaign: { select: { name: true } },
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

  return NextResponse.json(
    {
      eventId: ev.id,
      createdAt: ev.createdAt.toISOString(),
      meta,
      message: {
        id: ev.message.id,
        subject: ev.message.subject,
        bodyText: ev.message.bodyText,
        bodyHtml: ev.message.bodyHtml,
        messageId: ev.message.messageId,
        mailbox: ev.message.mailbox,
        lead: ev.message.lead,
        campaign: ev.message.campaign,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
