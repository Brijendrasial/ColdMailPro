import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

export async function GET() {
  let s: any;
  try { s = await requireSession(); } catch { return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }); }

  const mailboxes = await prisma.mailbox.findMany({
    where: { workspaceId: s.wid },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, fromEmail: true, isActive: true, warmupEnabled: true,
      warmupProfile: true,
    },
  });

  const now = new Date();
  const today = startOfUtcDay(now);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Sent today per mailbox
  const sentToday = await prisma.warmupMessage.groupBy({
    by: ["mailboxId"],
    where: { workspaceId: s.wid, direction: "outbound", sentAt: { gte: today, lt: tomorrow } },
    _count: { _all: true },
  });

  const placement7d = await prisma.warmupMessage.groupBy({
    by: ["mailboxId", "placement"],
    where: { workspaceId: s.wid, seedInboxId: { not: null }, receivedAt: { gte: since7d } },
    _count: { _all: true },
  });

  const lastPlacement = await prisma.warmupMessage.findMany({
    where: { workspaceId: s.wid, seedInboxId: { not: null }, receivedAt: { not: null } },
    orderBy: { receivedAt: "desc" },
    take: 2000,
    select: { mailboxId: true, receivedAt: true },
  });
  const lastMap = new Map<string, string>();
  for (const m of lastPlacement) {
    if (!lastMap.has(m.mailboxId)) lastMap.set(m.mailboxId, m.receivedAt!.toISOString());
  }

  const sentTodayMap = new Map(sentToday.map((r: any) => [r.mailboxId, r._count._all]));
  const inboxMap = new Map<string, { inbox: number; spam: number; unknown: number }>();
  for (const r of placement7d as any[]) {
    const cur = inboxMap.get(r.mailboxId) || { inbox: 0, spam: 0, unknown: 0 };
    if (r.placement === "inbox") cur.inbox += r._count._all;
    else if (r.placement === "spam") cur.spam += r._count._all;
    else cur.unknown += r._count._all;
    inboxMap.set(r.mailboxId, cur);
  }

  const profiles = mailboxes.map((mb: any) => {
    const st = inboxMap.get(mb.id) || { inbox: 0, spam: 0, unknown: 0 };
    return {
      mailboxId: mb.id,
      mailboxName: mb.name,
      fromEmail: mb.fromEmail,
      isActive: mb.isActive,
      warmupEnabled: mb.warmupEnabled,
      profile: mb.warmupProfile ? {
        id: mb.warmupProfile.id,
        mode: mb.warmupProfile.mode,
        startPerDay: mb.warmupProfile.startPerDay,
        increasePerDay: mb.warmupProfile.increasePerDay,
        maxPerDay: mb.warmupProfile.maxPerDay,
        timezone: mb.warmupProfile.timezone,
        windowStartMin: mb.warmupProfile.windowStartMin,
        windowEndMin: mb.warmupProfile.windowEndMin,
        weekdaysOnly: mb.warmupProfile.weekdaysOnly,
      } : null,
      stats: {
        sentToday: sentTodayMap.get(mb.id) || 0,
        inbox7d: st.inbox,
        spam7d: st.spam,
        unknown7d: st.unknown,
        lastPlacementAt: lastMap.get(mb.id) || null,
      },
    };
  });

  return NextResponse.json({ profiles });
}
