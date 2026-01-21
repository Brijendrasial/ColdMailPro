import { NextRequest, NextResponse } from "next/server";
import { createSessionCookie, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

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
  const targetWid = String(body?.workspaceId || "");
  if (!targetWid) return NextResponse.json({ ok: false, error: "workspaceId_required" }, { status: 400 });

  // Ensure the user belongs to the target workspace
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: s.uid, workspaceId: targetWid } },
    select: { id: true, role: true },
  });
  if (!membership) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  // Move this session to the new workspace (prevents creating endless sessions when switching)
  const updated = await prisma.userSession.updateMany({
    where: { id: s.sid, userId: s.uid, revokedAt: null },
    data: { workspaceId: targetWid, lastSeenAt: new Date() },
  });
  if (updated.count === 0) return NextResponse.json({ ok: false, error: "session_not_found" }, { status: 401 });

  await createSessionCookie({ uid: s.uid, wid: targetWid, sid: s.sid });

  const meta = reqMeta(req);
  await logAudit({
    workspaceId: targetWid,
    actorUserId: s.uid,
    action: "workspace.switch",
    targetType: "workspace",
    targetId: targetWid,
    ip: meta.ip,
    userAgent: meta.userAgent,
    meta: { fromWorkspaceId: s.wid, role: membership.role },
  });

  return NextResponse.json({ ok: true, workspaceId: targetWid });
}
