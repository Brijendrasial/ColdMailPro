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
  const name = String(body?.name || "").trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (name.length > 80) return NextResponse.json({ error: "name too long" }, { status: 400 });

  const pool = await prisma.mailboxPool.findFirst({ where: { id, workspaceId: s.wid }, select: { id: true } });
  if (!pool) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  try {
    await prisma.mailboxPool.update({ where: { id: pool.id }, data: { name } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("constraint")) {
      return NextResponse.json({ error: "POOL_NAME_EXISTS" }, { status: 409 });
    }
    return NextResponse.json({ error: "FAILED" }, { status: 500 });
  }
}
