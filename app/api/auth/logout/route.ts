import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, clearTwoFAPendingCookie, getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/url";


export async function GET(req: NextRequest) {
  const s = await getSession();
  if (s?.sid) {
    await prisma.userSession.updateMany({ where: { id: s.sid, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "logout" } }).catch(() => null);
  }
  clearSessionCookie();
  clearTwoFAPendingCookie();
  const u = new URL(req.url);
  const next = u.searchParams.get("next") || "/login";
  return NextResponse.redirect(absoluteUrl(req, next));
}

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (s?.sid) {
    await prisma.userSession.updateMany({ where: { id: s.sid, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "logout" } }).catch(() => null);
  }
  clearSessionCookie();
  clearTwoFAPendingCookie();
  const u = new URL(req.url);
  const next = u.searchParams.get("next") || "/";
  return NextResponse.redirect(absoluteUrl(req, next));
}