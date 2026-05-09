import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


export async function GET(req: Request) {
  const s = await requireSession();
  const url = new URL(req.url);

  const take = Math.min(Math.max(Number(url.searchParams.get("take") || 100), 1), 200);
  const cursor = url.searchParams.get("cursor");

  const level = url.searchParams.get("level") || "";
  const category = url.searchParams.get("category") || "";
  const event = url.searchParams.get("event") || "";
  const q = url.searchParams.get("q") || "";
  const includeSystem = url.searchParams.get("system") === "1";

  const where: any = {
    OR: includeSystem
      ? [{ workspaceId: s.wid }, { workspaceId: null }]
      : [{ workspaceId: s.wid }],
  };

  if (level) where.level = String(level);
  if (category) where.category = String(category);
  if (event) where.event = String(event);
  if (q) {
    where.AND = [
      {
        OR: [
          { message: { contains: q } },
          { category: { contains: q } },
          { event: { contains: q } },
          { entityId: { contains: q } },
        ],
      },
    ];
  }

  const logs = await (prisma as any).appLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const nextCursor = logs.length === take ? String(logs[logs.length - 1].id) : null;

  return NextResponse.json({ ok: true, logs, nextCursor });
}
