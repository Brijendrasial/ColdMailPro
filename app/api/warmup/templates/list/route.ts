import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  let s: any;
  try { s = await requireSession(); } catch { return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }); }
  const templates = await prisma.warmupTemplate.findMany({
    where: { workspaceId: s.wid },
    orderBy: [{ type: "asc" }, { createdAt: "desc" }],
    select: { id: true, type: true, source: true, name: true, subject: true, text: true, isActive: true },
  });
  return NextResponse.json({ templates });
}
