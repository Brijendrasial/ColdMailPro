import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeRole, canChangeRole, canRemoveMember } from "@/lib/rbac";
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

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({}));
  const desired = normalizeRole(String(body.role || "member"));

  const my = await prisma.membership.findFirst({ where: { userId: s.uid, workspaceId: s.wid }, select: { role: true } });
  const meRole = normalizeRole(my?.role);

  const target = await prisma.membership.findFirst({ where: { id: params.id, workspaceId: s.wid }, select: { id: true, role: true, userId: true, user: { select: { email: true } } } });
  if (!target) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  if (target.userId === s.uid) return NextResponse.json({ ok: false, error: "You cannot change your own role" }, { status: 400 });

  const targetRole = normalizeRole(target.role);
  if (!canChangeRole(meRole, targetRole, desired)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  await prisma.membership.update({ where: { id: target.id }, data: { role: desired } });

  const meta = reqMeta(req);
  await logAudit({
    workspaceId: s.wid,
    actorUserId: s.uid,
    action: "team.member.role_change",
    targetType: "membership",
    targetId: target.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
    meta: { email: target.user.email, from: targetRole, to: desired },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await requireSession();
  const my = await prisma.membership.findFirst({ where: { userId: s.uid, workspaceId: s.wid }, select: { role: true } });
  const meRole = normalizeRole(my?.role);

  const target = await prisma.membership.findFirst({ where: { id: params.id, workspaceId: s.wid }, select: { id: true, role: true, userId: true, user: { select: { email: true } } } });
  if (!target) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  if (target.userId === s.uid) return NextResponse.json({ ok: false, error: "You cannot remove yourself" }, { status: 400 });

  const targetRole = normalizeRole(target.role);
  if (!canRemoveMember(meRole, targetRole)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  await prisma.membership.delete({ where: { id: target.id } });

  const meta = reqMeta(req);
  await logAudit({
    workspaceId: s.wid,
    actorUserId: s.uid,
    action: "team.member.remove",
    targetType: "membership",
    targetId: target.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
    meta: { email: target.user.email, role: targetRole },
  });

  return NextResponse.json({ ok: true });
}
