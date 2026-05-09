import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const p: any = prisma as any;
  if (!p?.incident?.findMany) {
    return NextResponse.json({ ok: false, error: "Incidents not available (run prisma generate)" }, { status: 500 });
  }

  const s = await requireSession();
  const url = new URL(req.url);
  const status = String(url.searchParams.get("status") || "open");
  const take = Math.min(200, Math.max(1, Number(url.searchParams.get("take") || 50)));

  // Workspace-scoped incidents by default
  const items = await p.incident.findMany({
    where: {
      workspaceId: s.wid,
      status,
    },
    orderBy: { createdAt: "desc" },
    take,
  });

  return NextResponse.json({ ok: true, items });
}
