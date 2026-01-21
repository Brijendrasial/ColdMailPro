import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  let s: any;
  try { s = await requireSession(); } catch { return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }); }

  const url = new URL(req.url);
  const mailboxId = String(url.searchParams.get("mailboxId") || "").trim();
  const q = String(url.searchParams.get("q") || "").trim();
  const take = Math.min(200, Math.max(20, parseInt(url.searchParams.get("take") || "80", 10) || 80));

  const where: any = { workspaceId: s.wid };
  if (mailboxId) where.OR = [{ fromMailboxId: mailboxId }, { toMailboxId: mailboxId }];
  if (q) {
    where.AND = (where.AND || []).concat([
      {
        OR: [
          { subject: { contains: q } },
          { fromMailbox: { fromEmail: { contains: q } } },
          { toMailbox: { fromEmail: { contains: q } } },
          { toSeedInbox: { email: { contains: q } } },
        ],
      },
    ]);
  }

  const threads = await prisma.warmupThread.findMany({
    where,
    orderBy: { lastActivityAt: "desc" },
    take,
    include: {
      fromMailbox: { select: { id: true, name: true, fromEmail: true } },
      toMailbox: { select: { id: true, name: true, fromEmail: true } },
      toSeedInbox: { select: { id: true, name: true, email: true } },
      _count: { select: { messages: true } },
    } as any,
  });

  return NextResponse.json({ threads: threads.map((t: any) => ({
    id: t.id,
    subject: t.subject,
    status: t.status,
    createdAt: t.createdAt,
    lastActivityAt: t.lastActivityAt,
    messageCount: t._count?.messages || 0,
    fromMailbox: t.fromMailbox,
    toMailbox: t.toMailbox,
    toSeedInbox: t.toSeedInbox,
  })) });
}
