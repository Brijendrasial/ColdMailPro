import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Create = z.object({ name: z.string().min(1).max(80) });

export async function GET() {
  const s = await requireSession();
  const lists = await prisma.leadList.findMany({
    where: { workspaceId: s.wid },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, updatedAt: true },
  });
  return NextResponse.json({ ok: true, lists });
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const raw = await req.json().catch(() => ({}));
  const parsed = Create.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });
  const name = parsed.data.name.trim();
  const list = await prisma.leadList.upsert({
    where: { workspaceId_name: { workspaceId: s.wid, name } },
    create: { workspaceId: s.wid, name },
    update: { name },
    select: { id: true, name: true, updatedAt: true },
  });
  return NextResponse.json({ ok: true, list });
}

export async function DELETE(req: NextRequest) {
  const s = await requireSession();
  const url = new URL(req.url);
  const id = String(url.searchParams.get("id") || "");
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

  // Unassign leads from this list first.
  await prisma.lead.updateMany({ where: { workspaceId: s.wid, listId: id }, data: { listId: null } });
  await prisma.leadList.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
