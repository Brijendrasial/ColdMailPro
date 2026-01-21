import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function usageCounts(workspaceId: string, mailboxId: string) {
  const [campaignLinks, poolLinks, throttles, messages, warmupProfile, warmupThreadsFrom] = await Promise.all([
    prisma.campaignMailbox.count({ where: { mailboxId } }).catch(() => 0),
    prisma.mailboxPoolMember.count({ where: { mailboxId } }).catch(() => 0),
    prisma.mailboxThrottle.count({ where: { mailboxId } }).catch(() => 0),
    prisma.message.count({ where: { workspaceId, mailboxId } }).catch(() => 0),
    (prisma as any).warmupProfile?.count ? (prisma as any).warmupProfile.count({ where: { mailboxId } }).catch(() => 0) : 0,
    (prisma as any).warmupThread?.count
      ? (prisma as any).warmupThread.count({ where: { workspaceId, fromMailboxId: mailboxId } }).catch(() => 0)
      : 0,
  ]);
  return { campaignLinks, poolLinks, throttles, messages, warmupProfile, warmupThreadsFrom };
}

export async function POST(req: NextRequest) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const id = String(body?.id || "").trim();
  const dryRun = !!body?.dryRun;
  if (!id) return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });

  const mb = await prisma.mailbox.findFirst({ where: { id, workspaceId: s.wid }, select: { id: true, fromEmail: true } });
  if (!mb) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const counts = await usageCounts(s.wid, id);

  if (dryRun) {
    return NextResponse.json({ ok: true, mailboxId: id, fromEmail: mb.fromEmail, counts });
  }

  await prisma.$transaction(async (tx) => {
    // Explicit cleanup (many relations also use onDelete: Cascade, but this avoids surprises if schema changes).
    await tx.campaignMailbox.deleteMany({ where: { mailboxId: id } }).catch(() => undefined);
    await tx.mailboxThrottle.deleteMany({ where: { mailboxId: id } }).catch(() => undefined);
    await tx.mailboxPoolMember.deleteMany({ where: { mailboxId: id } }).catch(() => undefined);

    const txAny: any = tx as any;
    if (txAny.warmupProfile?.deleteMany) {
      await txAny.warmupProfile.deleteMany({ where: { mailboxId: id } }).catch(() => undefined);
    }
    if (txAny.warmupMessage?.deleteMany) {
      await txAny.warmupMessage.deleteMany({ where: { mailboxId: id } }).catch(() => undefined);
    }
    if (txAny.warmupThread?.deleteMany) {
      await txAny.warmupThread.deleteMany({ where: { fromMailboxId: id } }).catch(() => undefined);
    }

    await tx.mailbox.delete({ where: { id } });
  });

  return NextResponse.json({ ok: true, deleted: true, mailboxId: id, counts });
}
