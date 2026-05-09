import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let s: any;
  try { s = await requireSession(); } catch { return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }); }
  const body = await req.json().catch(() => ({}));
  const mailboxId = String(body.mailboxId || "");
  if (!mailboxId) return NextResponse.json({ error: "mailboxId required" }, { status: 400 });

  const mb = await prisma.mailbox.findFirst({ where: { id: mailboxId, workspaceId: s.wid } });
  if (!mb) return NextResponse.json({ error: "MAILBOX_NOT_FOUND" }, { status: 404 });

  const warmupEnabled = body.warmupEnabled === undefined ? mb.warmupEnabled : Boolean(body.warmupEnabled);
  await prisma.mailbox.update({ where: { id: mailboxId }, data: { warmupEnabled } });

  const p = body.profile || {};
  const mode = (p.mode === "internal" || p.mode === "seeds" || p.mode === "hybrid") ? p.mode : "hybrid";
  const data: any = {
    workspaceId: s.wid,
    mailboxId,
    mode,
    startPerDay: Number(p.startPerDay ?? 2),
    increasePerDay: Number(p.increasePerDay ?? 1),
    maxPerDay: Number(p.maxPerDay ?? 10),
    timezone: String(p.timezone || "UTC"),
    windowStartMin: Number(p.windowStartMin ?? 540),
    windowEndMin: Number(p.windowEndMin ?? 1020),
    weekdaysOnly: p.weekdaysOnly === undefined ? true : Boolean(p.weekdaysOnly),
    isActive: p.isActive === undefined ? true : Boolean(p.isActive),
  };

  await prisma.warmupProfile.upsert({
    where: { mailboxId },
    create: data,
    update: data,
  });

  return NextResponse.json({ ok: true });
}
