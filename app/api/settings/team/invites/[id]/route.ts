import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { normalizeRole, canManageTeam } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import crypto from "crypto";

function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function reqMeta(req: NextRequest) {
  return {
    ip:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null,
    userAgent: req.headers.get("user-agent") || null,
  };
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await requireSession();
  const my = await prisma.membership.findFirst({ where: { userId: s.uid, workspaceId: s.wid }, select: { role: true } });
  const meRole = normalizeRole(my?.role);
  if (!canManageTeam(meRole)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const inv = await prisma.workspaceInvite.findFirst({ where: { id: params.id, workspaceId: s.wid } });
  if (!inv) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  await prisma.workspaceInvite.delete({ where: { id: inv.id } });
  const meta = reqMeta(req);
  await logAudit({
    workspaceId: s.wid,
    actorUserId: s.uid,
    action: "team.invite.revoke",
    targetType: "invite",
    targetId: inv.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
    meta: { email: inv.email, role: inv.role },
  });
  return NextResponse.json({ ok: true });
}

// Regenerate invite token (returns a NEW invite url)
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await requireSession();
  const my = await prisma.membership.findFirst({ where: { userId: s.uid, workspaceId: s.wid }, select: { role: true } });
  const meRole = normalizeRole(my?.role);
  if (!canManageTeam(meRole)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const inv = await prisma.workspaceInvite.findFirst({ where: { id: params.id, workspaceId: s.wid, usedAt: null } });
  if (!inv) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const token = crypto.randomBytes(24).toString("base64url");
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.workspaceInvite.update({
    where: { id: inv.id },
    data: { tokenHash, expiresAt },
  });

  const meta = reqMeta(req);
  await logAudit({
    workspaceId: s.wid,
    actorUserId: s.uid,
    action: "team.invite.regenerate",
    targetType: "invite",
    targetId: inv.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
    meta: { email: inv.email, role: inv.role, expiresAt: expiresAt.toISOString() },
  });

  const inviteUrl = `${env.PUBLIC_APP_URL.replace(/\/$/, "")}/invite/${token}`;
  return NextResponse.json({ ok: true, inviteUrl, expiresAt: expiresAt.toISOString() });
}
