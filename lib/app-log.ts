import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

export type AppLogLevel = "debug" | "info" | "warn" | "error";

export type AppLogInput = {
  level?: AppLogLevel;
  category?: string;
  event?: string;
  message?: string | null;
  data?: any;
  workspaceId?: string | null;
  userId?: string | null;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  entityType?: string | null;
  entityId?: string | null;
};

const LEVEL_SCORE: Record<AppLogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function normalizeLevel(v: any): AppLogLevel {
  const s = String(v || "info").toLowerCase();
  return (s === "debug" || s === "info" || s === "warn" || s === "error") ? (s as AppLogLevel) : "info";
}

function shouldStore(level: AppLogLevel): boolean {
  const min = normalizeLevel(env.APPLOG_LEVEL);
  return LEVEL_SCORE[level] >= LEVEL_SCORE[min];
}

function clip(v: any, max = 8000) {
  if (v == null) return v;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

const REDACT_KEYS = new Set([
  "password",
  "pass",
  "pwd",
  "token",
  "secret",
  "api_key",
  "apikey",
  "authorization",
  "smtpPassEnc",
  "imapPassEnc",
  "cloudflareTokenEnc",
  "jwt",
  "cookie",
]);

function redactDeep(input: any, depth = 0): any {
  if (depth > 6) return "[truncated]";
  if (input == null) return input;
  if (typeof input === "string") return input.length > 12000 ? input.slice(0, 12000) + "…" : input;
  if (typeof input === "number" || typeof input === "boolean") return input;
  if (Array.isArray(input)) return input.slice(0, 50).map((x) => redactDeep(x, depth + 1));
  if (typeof input === "object") {
    const out: any = {};
    const entries = Object.entries(input).slice(0, 120);
    for (const [k, v] of entries) {
      if (REDACT_KEYS.has(k) || REDACT_KEYS.has(String(k).toLowerCase())) out[k] = "[redacted]";
      else out[k] = redactDeep(v, depth + 1);
    }
    return out;
  }
  try {
    return String(input);
  } catch {
    return "[unserializable]";
  }
}

/**
 * Unified app logger.
 * Writes JSON to stdout AND (optionally) stores into the AppLog table.
 */
export async function appLog(input: AppLogInput) {
  const level = normalizeLevel(input.level);
  const entry = {
    ts: Date.now(),
    level,
    category: String(input.category || "app"),
    event: String(input.event || "event"),
    message: input.message == null ? null : clip(String(input.message), 12000),
    workspaceId: input.workspaceId || null,
    userId: input.userId || null,
    requestId: input.requestId || null,
    entityType: input.entityType || null,
    entityId: input.entityId || null,
  } as any;

  const safeData = input.data == null ? null : redactDeep(input.data);

  // Always print to console (useful even if DB is down)
  const line = JSON.stringify({ ...entry, data: safeData });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  if (!env.APPLOG_DB) return;
  if (!shouldStore(level)) return;

  // DB sink
  try {
    // Prevent recursive logging of logging queries
    // (middleware/prisma hooks should skip AppLog writes)
    await prisma.appLog.create({
      data: {
        level: entry.level,
        category: entry.category,
        event: entry.event,
        message: entry.message,
        data: safeData,
        workspaceId: entry.workspaceId,
        userId: entry.userId,
        requestId: entry.requestId,
        ip: input.ip || null,
        userAgent: input.userAgent || null,
        entityType: entry.entityType,
        entityId: entry.entityId,
      },
    });
  } catch {
    // If DB is down or migration not applied yet, don't crash the request.
  }
}

export function appLogAsync(input: AppLogInput) {
  // Return the promise so callers can await/catch when needed.
  // Callers that want fire-and-forget can still do: `void appLogAsync(...)`.
  return appLog(input);
}
