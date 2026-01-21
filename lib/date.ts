export function formatDateUTC(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(d);
}

export function formatDateTimeUTC(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(d);
}

export function formatMonthDayUTC(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(d);
}

export function formatDateInTimeZone(
  iso: string | Date | null | undefined,
  timeZone: string | null | undefined,
): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  const tz = (timeZone || "").trim();
  if (!tz) return formatDateUTC(d);

  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      timeZone: tz,
    }).format(d);
  } catch {
    // Some Node runtimes are built with "small" ICU which may not support IANA tz.
    // Provide a minimal, safe fallback for our most common timezone.
    // (For full IANA support, run Node with full-icu.)

    // Asia/Kolkata is fixed at UTC+05:30 (no DST).
    if (tz === "Asia/Kolkata" || tz === "Asia/Calcutta") {
      const shifted = new Date(d.getTime() + 330 * 60 * 1000);
      return formatDateUTC(shifted);
    }

    // If the timezone is invalid on this runtime, fall back to UTC.
    return formatDateUTC(d);
  }
}
