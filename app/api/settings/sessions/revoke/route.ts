import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "missing_id" }, { status: 400 });

  // Only revoke sessions in this workspace belonging to the user
  await prisma.userSession.updateMany({
    where: { id, userId: s.uid, workspaceId: s.wid, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: "revoked" },
  });

  // If they revoked the current session, log them out immediately
  if (id === s.sid) {
    clearSessionCookie();
    return NextResponse.json({ ok: true, loggedOut: true });
  }

  return NextResponse.json({ ok: true });
}
