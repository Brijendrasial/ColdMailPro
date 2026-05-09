import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Update = { id: string; weight: number; isActive: boolean };
type Add = { mailboxId: string; weight: number };

function clampInt(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

export async function POST(req: Request) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const poolId = String(body?.poolId || "");
  if (!poolId) return NextResponse.json({ error: "poolId required" }, { status: 400 });

  const pool = await prisma.mailboxPool.findFirst({ where: { id: poolId, workspaceId: s.wid }, select: { id: true, name: true } });
  if (!pool) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const updates: Update[] = Array.isArray(body?.updates) ? body.updates : [];
  const adds: Add[] = Array.isArray(body?.adds) ? body.adds : [];
  const removes: string[] = Array.isArray(body?.removes) ? body.removes : [];

  // Validate adds mailboxes belong to same workspace
  const addMailboxIds = Array.from(new Set(adds.map((a) => String(a.mailboxId || "").trim()).filter(Boolean)));
  if (addMailboxIds.length) {
    const cnt = await prisma.mailbox.count({ where: { workspaceId: s.wid, id: { in: addMailboxIds } } });
    if (cnt !== addMailboxIds.length) return NextResponse.json({ error: "INVALID_MAILBOX" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    // Remove
    const rmIds = removes.map((x) => String(x || "").trim()).filter(Boolean);
    if (rmIds.length) {
      await tx.mailboxPoolMember.deleteMany({ where: { id: { in: rmIds }, poolId: pool.id } });
    }

    // Update
    for (const u of updates) {
      const id = String(u?.id || "").trim();
      if (!id) continue;
      const weight = clampInt(Number(u?.weight ?? 1), 1, 100);
      const isActive = !!u?.isActive;
      await tx.mailboxPoolMember.updateMany({ where: { id, poolId: pool.id }, data: { weight, isActive } });
    }

    // Add
    for (const a of adds) {
      const mailboxId = String(a?.mailboxId || "").trim();
      if (!mailboxId) continue;
      const weight = clampInt(Number(a?.weight ?? 1), 1, 100);
      await tx.mailboxPoolMember.upsert({
        where: { poolId_mailboxId: { poolId: pool.id, mailboxId } },
        update: { weight, isActive: true },
        create: { poolId: pool.id, mailboxId, weight, isActive: true },
      });
    }
  });

  // Return updated detail so UI can refresh without another call.
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

  return NextResponse.json({ pool: { id: pool.id, name: pool.name }, members, mailboxes });
}
