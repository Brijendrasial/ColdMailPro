import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startOfLocalDayUtc, warmupTargetForToday } from "@/lib/warmupTime";

export async function GET() {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const mailboxes = await prisma.mailbox.findMany({
    where: { workspaceId: s.wid },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      fromEmail: true,
      isActive: true,
      warmupEnabled: true,
      warmupProfile: true,
    },
  });

  const now = new Date();
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Build per-mailbox "local day" windows and warmup targets.
  const windows = new Map<string, { tz: string; start: Date; end: Date; targetToday: number | null }>();
  let earliestStart: Date | null = null;
  let latestEnd: Date | null = null;

  for (const mb of mailboxes as any[]) {
    const p = mb.warmupProfile;
    const tz = (p?.timezone || "UTC") as string;
    if (!p) {
      windows.set(mb.id, { tz, start: now, end: now, targetToday: null });
      continue;
    }
    const start = startOfLocalDayUtc(now, tz);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const targetToday = warmupTargetForToday({
      now,
      startedAt: new Date(p.startedAt as any),
      startPerDay: p.startPerDay,
      increasePerDay: p.increasePerDay,
      maxPerDay: p.maxPerDay,
      weekdaysOnly: p.weekdaysOnly,
      timeZone: tz,
    });

    windows.set(mb.id, { tz, start, end, targetToday });
    if (!earliestStart || start.getTime() < earliestStart.getTime()) earliestStart = start;
    if (!latestEnd || end.getTime() > latestEnd.getTime()) latestEnd = end;
  }

  // Outbound sent counts within each mailbox's local day.
  const sentTodayMap = new Map<string, number>();
  if (earliestStart && latestEnd) {
    const recentOutbound = await prisma.warmupMessage.findMany({
      where: {
        workspaceId: s.wid,
        direction: "outbound",
        sentAt: { gte: earliestStart, lt: latestEnd },
      },
      select: { mailboxId: true, sentAt: true },
    });

    for (const m of recentOutbound as any[]) {
      const w = windows.get(m.mailboxId);
      const ts = m.sentAt ? new Date(m.sentAt as any).getTime() : null;
      if (!w || !ts) continue;
      if (ts >= w.start.getTime() && ts < w.end.getTime()) {
        sentTodayMap.set(m.mailboxId, (sentTodayMap.get(m.mailboxId) || 0) + 1);
      }
    }
  }

  // Placement stats (7d) for seed inboxes.
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
  for (const m of lastPlacement as any[]) {
    if (!lastMap.has(m.mailboxId)) lastMap.set(m.mailboxId, m.receivedAt!.toISOString());
  }

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
    const w = windows.get(mb.id);

    return {
      mailboxId: mb.id,
      mailboxName: mb.name,
      fromEmail: mb.fromEmail,
      isActive: mb.isActive,
      warmupEnabled: mb.warmupEnabled,
      profile: mb.warmupProfile
        ? {
            id: mb.warmupProfile.id,
            mode: mb.warmupProfile.mode,
            startedAt: mb.warmupProfile.startedAt,
            updatedAt: mb.warmupProfile.updatedAt,
            startPerDay: mb.warmupProfile.startPerDay,
            increasePerDay: mb.warmupProfile.increasePerDay,
            maxPerDay: mb.warmupProfile.maxPerDay,
            timezone: mb.warmupProfile.timezone,
            windowStartMin: mb.warmupProfile.windowStartMin,
            windowEndMin: mb.warmupProfile.windowEndMin,
            weekdaysOnly: mb.warmupProfile.weekdaysOnly,
          }
        : null,
      stats: {
        sentToday: sentTodayMap.get(mb.id) || 0,
        targetToday: w?.targetToday ?? null,
        tz: w?.tz ?? (mb.warmupProfile?.timezone || "UTC"),
        inbox7d: st.inbox,
        spam7d: st.spam,
        unknown7d: st.unknown,
        lastPlacementAt: lastMap.get(mb.id) || null,
      },
    };
  });

  return NextResponse.json({ profiles });
}
