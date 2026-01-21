import { PrismaClient } from "@prisma/client";
import { env } from "@/lib/env";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  __prismaLogMwAttached?: boolean;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// -------------------------------------------------
// Prisma middleware: "everything" logging
// - Logs ALL writes (create/update/delete/upsert...) when PRISMA_LOG_WRITES=1
// - Logs slow queries (>= PRISMA_SLOW_MS)
// - Logs query errors
// -------------------------------------------------
// Notes:
// - Writes to AppLog if table exists. If migration isn't applied yet, it fails silently.
// - Skips logging AppLog writes to avoid recursion.

const WRITE_ACTIONS = new Set([
  "create",
  "createMany",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "upsert",
]);

const READ_ACTIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "aggregate",
  "count",
  "groupBy",
]);

const REDACT_KEYS = new Set([
  "password",
  "pass",
  "pwd",
  "token",
  "secret",
  "apiKey",
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
  if (typeof input === "string") return input.length > 4000 ? input.slice(0, 4000) + "…" : input;
  if (typeof input === "number" || typeof input === "boolean") return input;
  if (Array.isArray(input)) return input.slice(0, 50).map((x) => redactDeep(x, depth + 1));
  if (typeof input === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(input).slice(0, 120)) {
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

async function writeAppLog(data: any) {
  try {
    await (prisma as any).appLog.create({ data });
  } catch {
    // ignore (migration missing / DB down)
  }
}

if (!globalForPrisma.__prismaLogMwAttached) {
  globalForPrisma.__prismaLogMwAttached = true;

  prisma.$use(async (params, next) => {
    const started = Date.now();
    try {
      const result = await next(params);
      const ms = Date.now() - started;

      if (params.model === "AppLog") return result; // no recursion

      const isWrite = WRITE_ACTIONS.has(params.action);
      const isRead = READ_ACTIONS.has(params.action);

      const logWrites = Boolean(env.PRISMA_LOG_WRITES);
      const logReads = Boolean(env.PRISMA_LOG_READS);
      const slowMs = Number(env.PRISMA_SLOW_MS || 150);

      // 1) Log writes ("everything")
      if (isWrite && logWrites) {
        const payload = {
          model: params.model,
          action: params.action,
          ms,
          args: redactDeep(params.args),
        };

        console.log(JSON.stringify({ level: "info", category: "db", event: "write", ...payload }));

        await writeAppLog({
          level: "info",
          category: "db",
          event: "write",
          message: `${params.model}.${params.action}`,
          data: payload,
        });
      }

      // 2) Log slow queries (reads + writes)
      if (ms >= slowMs) {
        const payload = {
          model: params.model,
          action: params.action,
          ms,
        };
        console.warn(JSON.stringify({ level: "warn", category: "db", event: "slow_query", ...payload }));
        await writeAppLog({
          level: "warn",
          category: "db",
          event: "slow_query",
          message: `${params.model}.${params.action} ${ms}ms`,
          data: payload,
        });
      }

      // 3) Optional: log reads (VERY noisy)
      if (isRead && logReads) {
        const payload = {
          model: params.model,
          action: params.action,
          ms,
          args: redactDeep(params.args),
        };
        console.log(JSON.stringify({ level: "debug", category: "db", event: "read", ...payload }));
        await writeAppLog({
          level: "debug",
          category: "db",
          event: "read",
          message: `${params.model}.${params.action}`,
          data: payload,
        });
      }

      return result;
    } catch (e: any) {
      const ms = Date.now() - started;

      if (params.model !== "AppLog") {
        const payload = {
          model: params.model,
          action: params.action,
          ms,
          error: String(e?.message || e),
          args: redactDeep(params.args),
        };
        console.error(JSON.stringify({ level: "error", category: "db", event: "query_error", ...payload }));
        await writeAppLog({
          level: "error",
          category: "db",
          event: "query_error",
          message: `${params.model}.${params.action} failed`,
          data: payload,
        });
      }

      throw e;
    }
  });
}
