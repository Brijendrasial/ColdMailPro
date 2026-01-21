import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  let s: any;
  try { s = await requireSession(); } catch { return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }); }

  const body = await req.json().catch(() => ({}));
  const mailboxIdsRaw = Array.isArray(body.mailboxIds) ? body.mailboxIds : [];
  const mailboxIds = Array.from(new Set(mailboxIdsRaw.map((x: any) => String(x || "").trim()).filter(Boolean)));
  if (!mailboxIds.length) return NextResponse.json({ error: "mailboxIds required" }, { status: 400 });
  if (mailboxIds.length > 200) return NextResponse.json({ error: "Too many mailboxes (max 200)" }, { status: 400 });

  // Verify ownership
  const mbs = await prisma.mailbox.findMany({ where: { id: { in: mailboxIds }, workspaceId: s.wid }, select: { id: true } });
  const owned = new Set(mbs.map((m) => m.id));
  const missing = mailboxIds.filter((id) => !owned.has(id));
  if (missing.length) return NextResponse.json({ error: "MAILBOX_NOT_FOUND", missing }, { status: 404 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.mailbox.updateMany({ where: { id: { in: mailboxIds }, workspaceId: s.wid }, data: { warmupEnabled: false } });
      const del = await tx.warmupProfile.deleteMany({ where: { mailboxId: { in: mailboxIds }, workspaceId: s.wid } });
      return del;
    });
    return NextResponse.json({ ok: true, deleted: result.count });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
