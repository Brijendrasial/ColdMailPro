import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const s = await requireSession();
  const id = String(params.id || "");
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

  const lead = await prisma.lead.findFirst({
    where: { id, workspaceId: s.wid },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      list: { select: { id: true, name: true } },
      notes: {
        select: { id: true, kind: true, body: true, createdAt: true, authorUserId: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
      tasks: {
        select: { id: true, title: true, dueAt: true, completedAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
      activities: {
        select: { id: true, type: true, text: true, meta: true, createdAt: true, actorUserId: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      },
      enrollments: {
        include: { campaign: { select: { id: true, name: true, status: true } } },
        orderBy: { updatedAt: "desc" },
      },
      messages: {
        select: {
          id: true,
          status: true,
          subject: true,
          bodyText: true,
          bodyHtml: true,
          sentAt: true,
          createdAt: true,
          campaign: { select: { id: true, name: true } },
          mailbox: { select: { id: true, name: true, fromEmail: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 30,
      },
    },
  });

  if (!lead) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true, lead });
}
