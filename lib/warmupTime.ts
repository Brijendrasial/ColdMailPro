// Warmup time helpers
// We avoid external timezone libs by using Intl.DateTimeFormat.

export function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const parts = dtf.formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;

    const yy = get("year") || "1970";
    const mm = get("month") || "01";
    const dd = get("day") || "01";
    const hh = get("hour") || "00";
    const mi = get("minute") || "00";
    const ss = get("second") || "00";

    // Interpret the local wall-clock time as if it were UTC.
    const asUtc = Date.parse(`${yy}-${mm}-${dd}T${hh}:${mi}:${ss}Z`);
    return (asUtc - date.getTime()) / 60000;
  } catch {
    return 0;
  }
}

export function getLocalWeekday(date: Date, timeZone: string): number {
  try {
    const wd = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
    const map: any = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[wd] ?? date.getUTCDay();
  } catch {
    return date.getUTCDay();
  }
}

export function getLocalYmd(date: Date, timeZone: string): { y: number; m: number; d: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    return {
      y: Number(get("year") || "1970"),
      m: Number(get("month") || "1"),
      d: Number(get("day") || "1"),
    };
  } catch {
    return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
  }
}

export function startOfLocalDayUtc(date: Date, timeZone: string): Date {
  const { y, m, d } = getLocalYmd(date, timeZone || "UTC");
  // initial guess: UTC midnight of local date
  let t = Date.UTC(y, m - 1, d, 0, 0, 0, 0);

  // Iterate a couple of times to stabilize around DST transitions.
  for (let i = 0; i < 3; i++) {
    const guess = new Date(t);
    const off = getTimeZoneOffsetMinutes(guess, timeZone || "UTC");
    const next = Date.UTC(y, m - 1, d, 0, 0, 0, 0) - off * 60000;
    if (Math.abs(next - t) < 1000) {
      t = next;
      break;
    }
    t = next;
  }

  return new Date(t);
}

export function isWeekdayLocal(dayUtc: Date, timeZone: string): boolean {
  const wd = getLocalWeekday(dayUtc, timeZone || "UTC");
  return wd !== 0 && wd !== 6;
}

export function warmupTargetForToday(args: {
  now: Date;
  startedAt: Date;
  startPerDay: number;
  increasePerDay: number;
  maxPerDay: number;
  weekdaysOnly: boolean;
  timeZone: string;
}): number {
  const { now, startedAt, startPerDay, increasePerDay, maxPerDay, weekdaysOnly, timeZone } = args;

  const start = startOfLocalDayUtc(startedAt, timeZone);
  const end = startOfLocalDayUtc(now, timeZone);
  if (end.getTime() < start.getTime()) return Math.min(maxPerDay, Math.max(0, startPerDay));

  // Count eligible days (inclusive)
  let idx = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += 24 * 60 * 60 * 1000) {
    const cur = new Date(t);
    if (!weekdaysOnly || isWeekdayLocal(cur, timeZone)) idx++;
  }

  const target = startPerDay + Math.max(0, idx - 1) * increasePerDay;
  return Math.min(maxPerDay, Math.max(0, target));
}


export function warmupTargetForDay(args: {
  day: Date;
  startedAt: Date;
  startPerDay: number;
  increasePerDay: number;
  maxPerDay: number;
  weekdaysOnly: boolean;
  timeZone: string;
}): number {
  return warmupTargetForToday({
    now: args.day,
    startedAt: args.startedAt,
    startPerDay: args.startPerDay,
    increasePerDay: args.increasePerDay,
    maxPerDay: args.maxPerDay,
    weekdaysOnly: args.weekdaysOnly,
    timeZone: args.timeZone,
  });
}
