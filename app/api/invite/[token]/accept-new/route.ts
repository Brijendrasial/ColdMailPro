import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { absoluteUrl } from "@/lib/url";
import { prisma } from "@/lib/prisma";
import { createDbSessionAndCookie } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

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

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const token = String(params.token || "");
  const tokenHash = sha256(token);
  const form = await req.formData();
  const name = String(form.get("name") || "").trim().slice(0, 191);
  const password = String(form.get("password") || "");
  const confirm = String(form.get("confirm") || "");
  if (!password || password.length < 8 || password !== confirm) {
    return NextResponse.redirect(absoluteUrl(req, `/invite/${token}?err=pw`));
  }

  const inv = await prisma.workspaceInvite.findFirst({
    where: { tokenHash },
    select: { id: true, email: true, role: true, workspaceId: true, expiresAt: true, usedAt: true },
  });
  if (!inv || inv.usedAt) return NextResponse.redirect(absoluteUrl(req, `/invite/${token}?err=invalid`));
  if (inv.expiresAt && inv.expiresAt.getTime() < Date.now()) {
    return NextResponse.redirect(absoluteUrl(req, `/invite/${token}?err=expired`));
  }

  const existingUser = await prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } });
  if (existingUser) {
    // User exists: ask them to sign in and accept with their account
    return NextResponse.redirect(absoluteUrl(req, `/login?err=1`));
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email: inv.email, name: name || null, passwordHash },
    select: { id: true },
  });

  const membership = await prisma.membership.create({
    data: { userId: user.id, workspaceId: inv.workspaceId, role: inv.role },
    select: { id: true },
  });

  await prisma.workspaceInvite.update({
    where: { id: inv.id },
    data: { usedAt: new Date(), usedByUserId: user.id },
  });

  const meta = reqMeta(req);
  await logAudit({
    workspaceId: inv.workspaceId,
    actorUserId: user.id,
    action: "team.invite.accept",
    targetType: "invite",
    targetId: inv.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
    meta: { email: inv.email, role: inv.role, membershipId: membership.id, createdUser: true },
  });

  await createDbSessionAndCookie({ uid: user.id, wid: inv.workspaceId }, meta);
  return NextResponse.redirect(absoluteUrl(req, `/app?ok=invite`));
}
