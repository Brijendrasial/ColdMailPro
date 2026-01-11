import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireSession();

  // touch current session (best-effort)
  await prisma.userSession.updateMany({
    where: { id: s.sid, revokedAt: null },
    data: { lastSeenAt: new Date() },
  }).catch(() => null);

  const sessions = await prisma.userSession.findMany({
    where: { userId: s.uid, workspaceId: s.wid },
    orderBy: { lastSeenAt: "desc" },
    take: 50,
    select: {
      id: true,
      ip: true,
      userAgent: true,
      createdAt: true,
      lastSeenAt: true,
      revokedAt: true,
      revokedReason: true,
    },
  });

  return NextResponse.json({ ok: true, currentSid: s.sid, sessions });
}
