import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  let s: any;
  try { s = await requireSession(); } catch { return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }); }

  const b = await req.json().catch(() => ({} as any));
  const id = String(b?.id || "").trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const r = await prisma.warmupSeedInbox.deleteMany({ where: { id, workspaceId: s.wid } });
  return NextResponse.json({ ok: true, deleted: r.count });
}
