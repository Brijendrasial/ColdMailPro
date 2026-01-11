import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/url";
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
  const form = await req.formData();

  const currentPassword = String(form.get("currentPassword") || "");
  const newPassword = String(form.get("newPassword") || "");
  const confirmPassword = String(form.get("confirmPassword") || "");

  if (!currentPassword || !newPassword || !confirmPassword) {
    return NextResponse.redirect(absoluteUrl(req, "/app/settings?err=" + encodeURIComponent("All password fields are required")));
  }
  if (newPassword.length < 8) {
    return NextResponse.redirect(absoluteUrl(req, "/app/settings?err=" + encodeURIComponent("New password must be at least 8 characters")));
  }
  if (newPassword !== confirmPassword) {
    return NextResponse.redirect(absoluteUrl(req, "/app/settings?err=" + encodeURIComponent("New passwords do not match")));
  }

  const user = await prisma.user.findUnique({ where: { id: s.uid }, select: { id: true, passwordHash: true } });
  if (!user) {
    return NextResponse.redirect(absoluteUrl(req, "/app/settings?err=" + encodeURIComponent("User not found")));
  }

  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) {
    return NextResponse.redirect(absoluteUrl(req, "/app/settings?err=" + encodeURIComponent("Current password is incorrect")));
  }

  const nextHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: s.uid }, data: { passwordHash: nextHash } });

  const meta = reqMeta(req);
  await logAudit({
    workspaceId: s.wid,
    actorUserId: s.uid,
    action: "security.password.change",
    targetType: "user",
    targetId: s.uid,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return NextResponse.redirect(absoluteUrl(req, "/app/settings?ok=" + encodeURIComponent("Password updated")));
}
