import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { absoluteUrl } from "@/lib/url";
import { prisma } from "@/lib/prisma";
import { getSession, createDbSessionAndCookie } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  const s = await getSession();
  if (!s) return NextResponse.redirect(absoluteUrl(req, `/login?err=1`));

  const [inv, me] = await Promise.all([
    prisma.workspaceInvite.findFirst({
      where: { tokenHash },
      select: { id: true, email: true, role: true, workspaceId: true, expiresAt: true, usedAt: true },
    }),
    prisma.user.findUnique({ where: { id: s.uid }, select: { email: true } }),
  ]);

  if (!inv || inv.usedAt) return NextResponse.redirect(absoluteUrl(req, `/invite/${token}?err=invalid`));
  if (inv.expiresAt && inv.expiresAt.getTime() < Date.now()) {
    return NextResponse.redirect(absoluteUrl(req, `/invite/${token}?err=expired`));
  }
  if (!me || me.email.toLowerCase() !== inv.email.toLowerCase()) {
    return NextResponse.redirect(absoluteUrl(req, `/invite/${token}?err=email_mismatch`));
  }

  // Ensure membership exists
  const existing = await prisma.membership.findFirst({ where: { userId: s.uid, workspaceId: inv.workspaceId }, select: { id: true } });
  let membershipId = existing?.id || null;
  if (!existing) {
    const created = await prisma.membership.create({
      data: { userId: s.uid, workspaceId: inv.workspaceId, role: inv.role },
      select: { id: true },
    });
    membershipId = created.id;
  }

  await prisma.workspaceInvite.update({
    where: { id: inv.id },
    data: { usedAt: new Date(), usedByUserId: s.uid },
  });

  const meta = reqMeta(req);
  await logAudit({
    workspaceId: inv.workspaceId,
    actorUserId: s.uid,
    action: "team.invite.accept",
    targetType: "invite",
    targetId: inv.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
    meta: { email: inv.email, role: inv.role, membershipId },
  });

  // Switch user into the invited workspace
  await createDbSessionAndCookie({ uid: s.uid, wid: inv.workspaceId }, meta);

  return NextResponse.redirect(absoluteUrl(req, `/app?ok=invite`));
}
