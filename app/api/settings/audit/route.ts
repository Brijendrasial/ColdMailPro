import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const s = await requireSession();
  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(10, Number(url.searchParams.get("limit") || 75)));
  const action = url.searchParams.get("action") ? String(url.searchParams.get("action")) : null;

  const items = await prisma.auditLog.findMany({
    where: {
      workspaceId: s.wid,
      ...(action ? { action } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      ip: true,
      createdAt: true,
      meta: true,
      actor: { select: { id: true, email: true, name: true } },
    },
  });

  return NextResponse.json({
    ok: true,
    items: items.map((x) => ({
      ...x,
      createdAt: x.createdAt.toISOString(),
    })),
  });
}
