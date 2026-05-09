import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  let s: any;
  try { s = await requireSession(); } catch { return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }); }

  const url = new URL(req.url);
  const id = String(url.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const thread = await prisma.warmupThread.findFirst({
    where: { id, workspaceId: s.wid },
    include: {
      fromMailbox: { select: { id: true, name: true, fromEmail: true } },
      toMailbox: { select: { id: true, name: true, fromEmail: true } },
      toSeedInbox: { select: { id: true, name: true, email: true } },
      messages: { orderBy: { createdAt: "asc" }, select: {
        id: true,
        direction: true,
        fromEmail: true,
        toEmail: true,
        subject: true,
        text: true,
        html: true,
        sentAt: true,
        receivedAt: true,
        placement: true,
        placementFolder: true,
        error: true,
        openedAt: true,
        starredAt: true,
        rescuedToInboxAt: true,
        archivedAt: true,
        createdAt: true,
      } } as any,
    } as any,
  });

  if (!thread) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json({ thread });
}
