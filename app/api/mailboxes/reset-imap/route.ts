import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const id = String(body?.id || "").trim();
  if (!id) return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });

  const mb = await prisma.mailbox.findFirst({ where: { id, workspaceId: s.wid }, select: { id: true } });
  if (!mb) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  await prisma.mailbox.update({ where: { id }, data: { imapLastUid: 0 } });
  return NextResponse.json({ ok: true });
}
