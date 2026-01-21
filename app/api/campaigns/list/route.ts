import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireSession();
  const campaigns = await prisma.campaign.findMany({
    where: { workspaceId: s.wid, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, status: true },
  });
  return NextResponse.json({ ok: true, campaigns });
}
