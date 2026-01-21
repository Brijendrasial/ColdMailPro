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

export async function GET() {
  const s = await requireSession();
  const me = await prisma.membership.findFirst({
    where: { userId: s.uid, workspaceId: s.wid },
    select: { role: true },
  });
  const meRole = normalizeRole(me?.role);

  const [members, invites] = await Promise.all([
    prisma.membership.findMany({
      where: { workspaceId: s.wid },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
    }),
    prisma.workspaceInvite.findMany({
      where: { workspaceId: s.wid, usedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        expiresAt: true,
        createdByUserId: true,
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    meRole,
    members: members.map((m) => ({
      id: m.id,
      role: normalizeRole(m.role),
      createdAt: m.createdAt.toISOString(),
      user: m.user,
    })),
    invites: invites.map((i) => ({
      ...i,
      role: normalizeRole(i.role),
      createdAt: i.createdAt.toISOString(),
      expiresAt: i.expiresAt ? i.expiresAt.toISOString() : null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const role = normalizeRole(String(body.role || "member"));
  if (!email || !email.includes("@")) return NextResponse.json({ ok: false, error: "Invalid email" }, { status: 400 });
  if (role === "owner") return NextResponse.json({ ok: false, error: "Cannot invite as owner" }, { status: 400 });

  const my = await prisma.membership.findFirst({
    where: { userId: s.uid, workspaceId: s.wid },
    select: { role: true },
  });
  const meRole = normalizeRole(my?.role);
  if (!canManageTeam(meRole)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) {
    const existingMembership = await prisma.membership.findFirst({
      where: { userId: existingUser.id, workspaceId: s.wid },
      select: { id: true },
    });
    if (existingMembership) {
      return NextResponse.json({ ok: false, error: "User is already a member" }, { status: 400 });
    }
    const created = await prisma.membership.create({
      data: { userId: existingUser.id, workspaceId: s.wid, role },
      select: { id: true },
    });
    const meta = reqMeta(req);
    await logAudit({
      workspaceId: s.wid,
      actorUserId: s.uid,
      action: "team.member.add_existing",
      targetType: "membership",
      targetId: created.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      meta: { email, role },
    });
    return NextResponse.json({ ok: true, mode: "added", message: "User exists. Added directly to workspace." });
  }

  // Create invite
  const token = crypto.randomBytes(24).toString("base64url");
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const inv = await prisma.workspaceInvite.create({
    data: {
      workspaceId: s.wid,
      email,
      role,
      tokenHash,
      expiresAt,
      createdByUserId: s.uid,
    },
    select: { id: true },
  });

  const meta = reqMeta(req);
  await logAudit({
    workspaceId: s.wid,
    actorUserId: s.uid,
    action: "team.invite.create",
    targetType: "invite",
    targetId: inv.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
    meta: { email, role, expiresAt: expiresAt.toISOString() },
  });

  const inviteUrl = `${env.PUBLIC_APP_URL.replace(/\/$/, "")}/invite/${token}`;
  return NextResponse.json({ ok: true, mode: "invite", inviteUrl, expiresAt: expiresAt.toISOString() });
}
