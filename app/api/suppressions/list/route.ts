import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function norm(s: string) {
  return s.trim().toLowerCase();
}

export async function GET(req: NextRequest) {
  const s = await requireSession();
  const url = new URL(req.url);
  const q = norm(url.searchParams.get("q") || "");
  const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
  const pageSize = Math.min(200, Math.max(20, Number(url.searchParams.get("pageSize") || 50) || 50));
  const skip = (page - 1) * pageSize;

  const where: any = { workspaceId: s.wid };
  if (q) {
    where.OR = [
      { email: { contains: q } },
      { reason: { contains: q } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.suppression.count({ where }),
    prisma.suppression.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      select: { id: true, email: true, reason: true, createdAt: true },
    }),
  ]);

  return NextResponse.json({ ok: true, page, pageSize, total, items: rows });
}
