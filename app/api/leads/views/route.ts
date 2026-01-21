import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET: list saved views for current workspace
// POST: upsert a view (by id or by (workspaceId,name))

export async function GET() {
  const s = await requireSession();
  const views = await prisma.leadView.findMany({
    where: { workspaceId: s.wid },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, payload: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json({ ok: true, views });
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({} as any));
  const id = body.id ? String(body.id) : "";
  const name = String(body.name || "").trim();
  const payload = body.payload;

  if (!name) return NextResponse.json({ ok: false, error: "Missing name" }, { status: 400 });
  if (payload === undefined) return NextResponse.json({ ok: false, error: "Missing payload" }, { status: 400 });

  if (id) {
    // Update existing (scoped to workspace)
    const existing = await prisma.leadView.findFirst({ where: { id, workspaceId: s.wid } });
    if (!existing) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    const view = await prisma.leadView.update({
      where: { id },
      data: { name, payload },
      select: { id: true, name: true, payload: true, createdAt: true, updatedAt: true },
    });
    return NextResponse.json({ ok: true, view });
  }

  // Upsert by (workspaceId,name) for convenience
  const view = await prisma.leadView.upsert({
    where: { workspaceId_name: { workspaceId: s.wid, name } },
    create: { workspaceId: s.wid, name, payload },
    update: { payload },
    select: { id: true, name: true, payload: true, createdAt: true, updatedAt: true },
  });

  return NextResponse.json({ ok: true, view });
}
