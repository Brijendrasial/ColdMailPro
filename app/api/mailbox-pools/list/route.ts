import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const pools = await prisma.mailboxPool.findMany({
    where: { workspaceId: s.wid },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      updatedAt: true,
      _count: { select: { members: true } },
    },
  });

  return NextResponse.json({
    pools: pools.map((p) => ({
      id: p.id,
      name: p.name,
      updatedAt: p.updatedAt.toISOString(),
      memberCount: (p as any)._count?.members || 0,
    })),
  });
}
