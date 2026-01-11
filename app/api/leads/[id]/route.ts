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
