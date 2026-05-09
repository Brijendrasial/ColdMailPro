import { NextRequest, NextResponse } from "next/server";
import { createSessionCookie, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function reqMeta(req: NextRequest) {
  return {
    ip:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null,
    userAgent: req.headers.get("user-agent") || null,
  };
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({} as any));
  const name = String(body?.name || "").trim();
  if (!name) return NextResponse.json({ ok: false, error: "name_required" }, { status: 400 });
  if (name.length > 80) return NextResponse.json({ ok: false, error: "name_too_long" }, { status: 400 });

  const meta = reqMeta(req);

  const created = await prisma.$transaction(async (tx) => {
    const ws = await tx.workspace.create({ data: { name }, select: { id: true } });
    await tx.membership.create({ data: { userId: s.uid, workspaceId: ws.id, role: "owner" }, select: { id: true } });
    return ws;
  });

  // Switch current session into the new workspace for a smooth UX
  await prisma.userSession.updateMany({
    where: { id: s.sid, userId: s.uid, revokedAt: null },
    data: { workspaceId: created.id, lastSeenAt: new Date() },
  });
  await createSessionCookie({ uid: s.uid, wid: created.id, sid: s.sid });

  await logAudit({
    workspaceId: created.id,
    actorUserId: s.uid,
    action: "workspace.create",
    targetType: "workspace",
    targetId: created.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
    meta: { name },
  });

  return NextResponse.json({ ok: true, workspaceId: created.id });
}
