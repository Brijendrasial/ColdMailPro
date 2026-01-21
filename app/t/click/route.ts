import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseSafeHttpUrl, verifyTrackingClick } from "@/lib/tracking";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mid = url.searchParams.get("m") || "";
  const to = url.searchParams.get("to") || "";
  const sig = url.searchParams.get("sig") || "";

  // Best-effort analytics (never block redirect if logging fails)
  if (mid) {
    await prisma.event
      .create({ data: { messageId: mid, type: "click", meta: to ? JSON.stringify({ to }) : null } })
      .catch(() => {});
    await prisma.message.update({ where: { id: mid }, data: { status: "clicked" } }).catch(() => {});
  }

  // No destination → safe fallback
  if (!to) return NextResponse.redirect(new URL("/", req.url));

  // Block non-http(s) URLs (prevents javascript:, data:, file:, etc.)
  const safe = parseSafeHttpUrl(to);
  if (!safe) return NextResponse.redirect(new URL("/", req.url));

  // Fix open redirect: require a valid signature
  if (!mid || !sig || !verifyTrackingClick(to, mid, sig)) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.redirect(safe.toString());
}
