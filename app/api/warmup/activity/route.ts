import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function clampInt(v: string | null, def: number, min: number, max: number) {
  const n = v ? parseInt(v, 10) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export async function GET(req: Request) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const url = new URL(req.url);
  const mailboxId = url.searchParams.get("mailboxId") || undefined;
  const placement = url.searchParams.get("placement") || undefined; // inbox|spam|unknown
  const direction = url.searchParams.get("direction") || undefined; // outbound|inbound
  const q = (url.searchParams.get("q") || "").trim();
  const take = clampInt(url.searchParams.get("take"), 100, 10, 250);

  const now = new Date();
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const since14d = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const whereBase: any = { workspaceId: s.wid };
  if (mailboxId) whereBase.mailboxId = mailboxId;
  if (direction) whereBase.direction = direction;
  if (placement) whereBase.placement = placement;

  if (q) {
    whereBase.OR = [
      { subject: { contains: q } },
      { fromEmail: { contains: q } },
      { toEmail: { contains: q } },
      { placementFolder: { contains: q } },
    ];
  }

  // Summary (7d)
  const [sent7d, placement7d] = await Promise.all([
    prisma.warmupMessage.count({
      where: {
        workspaceId: s.wid,
        ...(mailboxId ? { mailboxId } : {}),
        direction: "outbound",
        sentAt: { gte: since7d },
      },
    }),
    prisma.warmupMessage.groupBy({
      by: ["placement"],
      where: {
        workspaceId: s.wid,
        ...(mailboxId ? { mailboxId } : {}),
        receivedAt: { gte: since7d },
      },
      _count: { _all: true },
    }),
  ]);

  const placementTotals = { inbox: 0, spam: 0, unknown: 0 };
  for (const r of placement7d as any[]) {
    const k = r.placement === "inbox" ? "inbox" : r.placement === "spam" ? "spam" : "unknown";
    placementTotals[k] += r._count._all;
  }

  // By mailbox (7d)
  const [sentByMailbox, placementByMailbox, mailboxes] = await Promise.all([
    prisma.warmupMessage.groupBy({
      by: ["mailboxId"],
      where: { workspaceId: s.wid, direction: "outbound", sentAt: { gte: since7d } },
      _count: { _all: true },
    }),
    prisma.warmupMessage.groupBy({
      by: ["mailboxId", "placement"],
      where: { workspaceId: s.wid, receivedAt: { gte: since7d } },
      _count: { _all: true },
    }),
    prisma.mailbox.findMany({
      where: { workspaceId: s.wid },
      select: { id: true, name: true, fromEmail: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const mbMap = new Map<string, { id: string; name: string; fromEmail: string }>();
  for (const mb of mailboxes as any[]) mbMap.set(mb.id, mb);

  const sentMap = new Map<string, number>();
  for (const r of sentByMailbox as any[]) sentMap.set(r.mailboxId, r._count._all);

  const placeMap = new Map<string, { inbox: number; spam: number; unknown: number }>();
  for (const r of placementByMailbox as any[]) {
    const cur = placeMap.get(r.mailboxId) || { inbox: 0, spam: 0, unknown: 0 };
    const k = r.placement === "inbox" ? "inbox" : r.placement === "spam" ? "spam" : "unknown";
    cur[k] += r._count._all;
    placeMap.set(r.mailboxId, cur);
  }

  const byMailbox = Array.from(mbMap.values()).map((mb) => {
    const p = placeMap.get(mb.id) || { inbox: 0, spam: 0, unknown: 0 };
    return {
      mailboxId: mb.id,
      mailboxName: mb.name,
      fromEmail: mb.fromEmail,
      sent7d: sentMap.get(mb.id) || 0,
      inbox7d: p.inbox,
      spam7d: p.spam,
      unknown7d: p.unknown,
    };
  });

  // Recent messages (14d, filtered)
  const messages = await prisma.warmupMessage.findMany({
    where: {
      ...whereBase,
      createdAt: { gte: since14d },
    },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      direction: true,
      fromEmail: true,
      toEmail: true,
      subject: true,
      sentAt: true,
      receivedAt: true,
      placement: true,
      placementFolder: true,
      error: true,
      mailbox: { select: { name: true, fromEmail: true } },
      seedInbox: { select: { name: true, email: true } },
    },
  });

  return NextResponse.json({
    summary: {
      sent7d,
      placement7d: placementTotals,
    },
    byMailbox,
    messages,
  });
}
