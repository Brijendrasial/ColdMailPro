import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const poolId = String(searchParams.get("poolId") || "");
  if (!poolId) return NextResponse.json({ error: "poolId required" }, { status: 400 });

  const pool = await prisma.mailboxPool.findFirst({
    where: { id: poolId, workspaceId: s.wid },
    select: { id: true, name: true },
  });
  if (!pool) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const [members, mailboxes] = await Promise.all([
    prisma.mailboxPoolMember.findMany({
      where: { poolId: pool.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        mailboxId: true,
        weight: true,
        isActive: true,
        mailbox: {
          select: {
            id: true,
            name: true,
            fromEmail: true,
            isActive: true,
            warmupEnabled: true,
            dailyLimit: true,
            localAddress: true,
          },
        },
      },
    }),
    prisma.mailbox.findMany({
      where: { workspaceId: s.wid },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        fromEmail: true,
        isActive: true,
        warmupEnabled: true,
        dailyLimit: true,
        localAddress: true,
      },
    }),
  ]);

  return NextResponse.json({ pool, members, mailboxes });
}
