import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocalYmd, startOfLocalDayUtc, warmupTargetForDay } from "@/lib/warmupTime";

function ymdFromParts(y: number, m: number, d: number) {
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

export async function GET(req: Request) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const url = new URL(req.url);
  const days = Math.min(60, Math.max(7, parseInt(url.searchParams.get("days") || "14", 10) || 14));

  const mailboxes = await prisma.mailbox.findMany({
    where: { workspaceId: s.wid, warmupEnabled: true },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      fromEmail: true,
      warmupProfile: true,
    },
  });

  const now = new Date();

  // Provide a stable header array for the UI (older clients expect `days` to be an array).
  // We use UTC as a canonical header timezone; each mailbox's own `schedule` still uses its WarmupProfile timezone.
  const headerTz = "UTC";
  const headerStart = startOfLocalDayUtc(now, headerTz);
  const headerDays: any[] = [];
  for (let i = 0; i < days; i++) {
    const dayStart = new Date(headerStart.getTime() + i * 24 * 60 * 60 * 1000);
    const dayForCalc = new Date(dayStart.getTime() + 12 * 60 * 60 * 1000);
    const { y, m: mm, d } = getLocalYmd(dayForCalc, headerTz);
    headerDays.push({ date: ymdFromParts(y, mm, d) });
  }


  const byMailbox = (mailboxes as any[])
    .filter((m) => !!m.warmupProfile)
    .map((m) => {
      const p = m.warmupProfile;
      const tz = (p.timezone || "UTC") as string;

      // Build a local-date schedule per mailbox (so weekdaysOnly behaves correctly).
      const startLocalDay = startOfLocalDayUtc(now, tz);
      const schedule = [] as any[];
      for (let i = 0; i < days; i++) {
        const dayStart = new Date(startLocalDay.getTime() + i * 24 * 60 * 60 * 1000);
        // Use noon-ish timestamp when computing the target to avoid edge-case drift.
        const dayForCalc = new Date(dayStart.getTime() + 12 * 60 * 60 * 1000);
        const { y, m: mm, d } = getLocalYmd(dayForCalc, tz);

        schedule.push({
          date: ymdFromParts(y, mm, d),
          target: warmupTargetForDay({
            day: dayForCalc,
            startedAt: new Date(p.startedAt as any),
            startPerDay: p.startPerDay,
            increasePerDay: p.increasePerDay,
            maxPerDay: p.maxPerDay,
            weekdaysOnly: p.weekdaysOnly,
            timeZone: tz,
          }),
        });
      }

      return {
        mailboxId: m.id,
        mailboxName: m.name,
        fromEmail: m.fromEmail,
        timezone: tz,
        startedAt: p.startedAt,
        weekdaysOnly: p.weekdaysOnly,
        startPerDay: p.startPerDay,
        increasePerDay: p.increasePerDay,
        maxPerDay: p.maxPerDay,
        windowStartMin: p.windowStartMin,
        windowEndMin: p.windowEndMin,
        schedule,
      };
    });

  return NextResponse.json({ days: headerDays, daysCount: days, byMailbox });
}
