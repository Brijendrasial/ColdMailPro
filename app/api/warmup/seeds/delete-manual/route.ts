import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  let s: any;
  try { s = await requireSession(); } catch { return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }); }

  const r = await prisma.warmupSeedInbox.deleteMany({ where: { workspaceId: s.wid, source: "manual" } });
  return NextResponse.json({ ok: true, deleted: r.count });
}
