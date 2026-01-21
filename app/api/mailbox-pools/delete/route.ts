import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const id = String(body?.id || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const pool = await prisma.mailboxPool.findFirst({ where: { id, workspaceId: s.wid }, select: { id: true } });
  if (!pool) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // onDelete cascade removes members. Campaign.mailboxPoolId is SetNull.
  await prisma.mailboxPool.delete({ where: { id: pool.id } });
  return NextResponse.json({ ok: true });
}
