import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, ctx: { params: { id: string } }) {
  const s = await requireSession();
  const id = String(ctx?.params?.id || "");
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

  const existing = await prisma.leadView.findFirst({ where: { id, workspaceId: s.wid } });
  if (!existing) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  await prisma.leadView.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
