import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aiSuggestLeadViews } from "@/lib/ai";

function norm(s: string) {
  return s.trim().toLowerCase();
}

function splitTags(s?: string | null): string[] {
  return String(s || "")
    .split(",")
    .map((t) => norm(t))
    .filter(Boolean);
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  await req.json().catch(() => ({} as any)); // reserved for future inputs

  const total = await prisma.lead.count({ where: { workspaceId: s.wid } });

  const grouped = await prisma.lead.groupBy({
    by: ["status"],
    where: { workspaceId: s.wid },
    _count: { _all: true },
  });

  const statusCounts: Record<string, number> = {};
  for (const g of grouped as any[]) {
    statusCounts[String(g.status || "unknown")] = Number(g._count?._all || 0);
  }

  // Approximate top tags by sampling up to N leads.
  const sample = await prisma.lead.findMany({
    where: { workspaceId: s.wid },
    select: { tags: true },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

  const tagCounts = new Map<string, number>();
  for (const row of sample) {
    for (const t of splitTags(row.tags)) {
      tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }
  }

  const topTags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([tag, count]) => ({ tag, count }));

  try {
    const out = await aiSuggestLeadViews({ total, statusCounts, topTags });
    return NextResponse.json({ ok: true, views: out.views || [] });
  } catch (e: any) {
    const msg = String(e?.message || e || "FAILED");
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
