import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/url";
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

  // Revoke across ALL workspaces for this user (true "sign out everywhere")
  const res = await prisma.userSession.updateMany({
    where: { userId: s.uid, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: "signout_all" },
  });

  const meta = reqMeta(req);
  await logAudit({
    workspaceId: s.wid,
    actorUserId: s.uid,
    action: "security.sessions.revoke_all",
    targetType: "user",
    targetId: s.uid,
    ip: meta.ip,
    userAgent: meta.userAgent,
    meta: { revokedCount: res.count },
  });

  clearSessionCookie();

  const accept = req.headers.get("accept") || "";
  if (accept.includes("text/html")) {
    return NextResponse.redirect(absoluteUrl(req, "/login"));
  }
  return NextResponse.json({ ok: true, loggedOut: true });
}
