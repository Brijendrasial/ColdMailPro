import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

function normalizeLevel(v: any) {
  const s = String(v || "info").toLowerCase();
  return s === "debug" || s === "info" || s === "warn" || s === "error" ? s : "info";
}

export async function POST(req: Request) {
  // Auth: internal token OR user session
  const token = req.headers.get("x-internal-log-token") || "";
  const hasInternal = Boolean(env.INTERNAL_LOG_TOKEN) && token && token === env.INTERNAL_LOG_TOKEN;

  const session = await getSession();
  const hasSession = Boolean(session?.uid);

  if (!hasInternal && !hasSession) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  // Size guard
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 250_000) {
    return NextResponse.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID_JSON" }, { status: 400 });
  }

  const level = normalizeLevel(body?.level);
  const category = String(body?.category || "app").slice(0, 64);
  const event = String(body?.event || "event").slice(0, 64);
  const message = body?.message == null ? null : String(body.message).slice(0, 12000);

  const workspaceId = body?.workspaceId ? String(body.workspaceId) : (session?.wid || null);
  const userId = body?.userId ? String(body.userId) : (session?.uid || null);

  const data = body?.data ?? null;

  try {
    await (prisma as any).appLog.create({
      data: {
        level,
        category,
        event,
        message,
        data,
        workspaceId,
        userId,
        requestId: body?.requestId ? String(body.requestId) : null,
        ip: body?.ip ? String(body.ip) : null,
        userAgent: body?.userAgent ? String(body.userAgent) : req.headers.get("user-agent"),
        entityType: body?.entityType ? String(body.entityType) : null,
        entityId: body?.entityId ? String(body.entityId) : null,
      },
    });
  } catch {
    // ignore (migration missing / db down)
  }

  return NextResponse.json({ ok: true });
}
