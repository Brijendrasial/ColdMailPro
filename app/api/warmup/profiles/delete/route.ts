import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  let s: any;
  try { s = await requireSession(); } catch { return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }); }

  const b = await req.json().catch(() => ({} as any));
  const mailboxId = String(b?.mailboxId || "").trim();
  if (!mailboxId) return NextResponse.json({ error: "mailboxId required" }, { status: 400 });

  const mb = await prisma.mailbox.findFirst({ where: { id: mailboxId, workspaceId: s.wid }, select: { id: true } });
  if (!mb) return NextResponse.json({ error: "MAILBOX_NOT_FOUND" }, { status: 404 });

  await prisma.$transaction([
    prisma.warmupProfile.deleteMany({ where: { mailboxId, workspaceId: s.wid } }),
    prisma.mailbox.update({ where: { id: mailboxId }, data: { warmupEnabled: false } }),
  ]);

  return NextResponse.json({ ok: true });
}
