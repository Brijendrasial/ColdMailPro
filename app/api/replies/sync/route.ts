import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const s = await requireSession();
    const body = (await req.json().catch(() => null)) as any;
    const mailboxId = String(body?.mailboxId || "").trim();

    const mailboxes = await prisma.mailbox.findMany({
      where: {
        workspaceId: s.wid,
        isActive: true,
        imapHost: { not: null },
        imapUser: { not: null },
        imapPassEnc: { not: null },
        ...(mailboxId ? { id: mailboxId } : {}),
      },
      select: { id: true, fromEmail: true },
      take: 1000,
    });

    let queued = 0;
    let skipped = 0;
    const jobIds: string[] = [];

    for (const mb of mailboxes) {
      const existing = await prisma.job.findFirst({
        where: {
          type: "sync_imap",
          status: { in: ["queued", "running"] },
          payload: { contains: mb.id },
        },
        select: { id: true },
      });

      if (existing) {
        skipped++;
        continue;
      }

      const job = await prisma.job.create({
        data: {
          type: "sync_imap",
          payload: JSON.stringify({ mailboxId: mb.id, source: "manual_replies_sync" }),
          runAt: new Date(),
          status: "queued",
        },
        select: { id: true },
      });
      jobIds.push(job.id);
      queued++;
      await prisma.jobLog.create({ data: { jobId: job.id, line: `Queued immediate Replies IMAP sync for ${mb.fromEmail || mb.id}` } }).catch(() => {});
    }

    return NextResponse.json({ ok: true, queued, skipped, mailboxes: mailboxes.length, jobIds });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e || "SYNC_FAILED") }, { status: 500 });
  }
}
