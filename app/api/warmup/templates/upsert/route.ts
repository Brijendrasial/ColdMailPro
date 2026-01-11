import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  let s: any;
  try { s = await requireSession(); } catch { return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }); }

  const b = await req.json().catch(() => ({} as any));
  const id = b.id ? String(b.id) : null;
  const type = (b.type === "initial" || b.type === "reply") ? b.type : "initial";
  const name = String(b.name || "").trim() || (type === "initial" ? "Initial" : "Reply");
  const subject = String(b.subject || "").trim() || (type === "reply" ? "Re:" : "Quick question");
  const text = String(b.text || "").trim() || "Hey! Just checking in. Hope your day is going well.";
  const isActive = b.isActive === undefined ? true : Boolean(b.isActive);

  if (id) {
    const existing = await prisma.warmupTemplate.findFirst({ where: { id, workspaceId: s.wid }, select: { id: true, source: true } });
    if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    await prisma.warmupTemplate.update({
      where: { id },
      data: { workspaceId: s.wid, type, name, subject, text, isActive, source: existing.source },
    });
    return NextResponse.json({ ok: true, updated: true });
  }

  await prisma.warmupTemplate.create({
    data: { workspaceId: s.wid, type, name, subject, text, isActive, source: "manual" },
  });
  return NextResponse.json({ ok: true, created: true });
}
