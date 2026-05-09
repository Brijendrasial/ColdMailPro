import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Enqueue an immediate warmup placement check (Inbox vs Spam/Junk) for mailboxes.
// Options:
//  - { mailboxId }: scope to a single mailbox
//  - { mailboxIds: string[] }: scope to a set of mailboxes
export async function POST(req: Request) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const mailboxId = body?.mailboxId ? String(body.mailboxId) : null;
  const mailboxIds = Array.isArray(body?.mailboxIds)
    ? (body.mailboxIds
        .map((x: any) => String(x || "").trim())
        .filter((x: string) => x.length > 0) as string[])
    : null;

  const targets = mailboxIds?.length ? mailboxIds : mailboxId ? [mailboxId] : null;

  let queuedCount = 0;
  let skippedCount = 0;

  // De-dupe: avoid stacking multiple identical checks.
  // If no mailbox is specified, we enqueue a workspace-wide scan.
  if (!targets) {
    const needle = `"workspaceId":"${s.wid}"`;
    const existing = await prisma.job.findFirst({
      where: {
        type: "warmup_mailbox_check",
        status: { in: ["queued", "running"] },
        payload: { contains: needle },
      },
      select: { id: true },
    });

    if (!existing) {
      await prisma.job
        .create({
          data: {
            type: "warmup_mailbox_check",
            payload: JSON.stringify({ workspaceId: s.wid, source: "manual" }),
            runAt: new Date(),
            status: "queued",
          },
        })
        .catch(() => {});
      queuedCount++;
    } else {
      skippedCount++;
    }
  } else {
    for (const id of targets) {
      const needle = `"workspaceId":"${s.wid}","mailboxId":"${id}"`;
      const existing = await prisma.job.findFirst({
        where: {
          type: "warmup_mailbox_check",
          status: { in: ["queued", "running"] },
          payload: { contains: needle },
        },
        select: { id: true },
      });

      if (existing) {
        skippedCount++;
        continue;
      }

      await prisma.job
        .create({
          data: {
            type: "warmup_mailbox_check",
            payload: JSON.stringify({ workspaceId: s.wid, mailboxId: id, source: "manual" }),
            runAt: new Date(),
            status: "queued",
          },
        })
        .catch(() => {});
      queuedCount++;
    }
  }

  // Also enqueue seed placement checks (best-effort)
  await prisma.job
    .create({
      data: {
        type: "warmup_seed_check",
        payload: JSON.stringify({ workspaceId: s.wid, source: "manual" }),
        runAt: new Date(),
        status: "queued",
      },
    })
    .catch(() => {});

  return NextResponse.json({ ok: true, queuedCount, skippedCount, mailboxId, mailboxIds });
}
