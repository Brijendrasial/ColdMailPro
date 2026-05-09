import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as any;
  const mode = String(body?.mode || "both"); // smtp | imap | both
  const idsRaw = Array.isArray(body?.ids) ? body.ids : null;
  const mailboxId = String(body?.mailboxId || "").trim();

  const ids: string[] = idsRaw
    ? idsRaw.map((x: any) => String(x || "").trim()).filter(Boolean)
    : mailboxId
      ? [mailboxId]
      : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "MISSING_MAILBOX" }, { status: 400 });
  }

  // ownership check
  const owned = await prisma.mailbox.findMany({
    where: { workspaceId: s.wid, id: { in: ids } },
    select: { id: true },
  });
  const ownedIds = owned.map((m) => m.id);
  if (ownedIds.length === 0) {
    return NextResponse.json({ error: "MAILBOX_NOT_FOUND" }, { status: 404 });
  }

  const jobIds: string[] = [];
  for (const id of ownedIds) {
    const job = await prisma.job.create({
      data: {
        type: "mailbox_healthcheck",
        payload: JSON.stringify({ workspaceId: s.wid, mailboxId: id, mode }),
        runAt: new Date(),
        status: "queued",
      },
      select: { id: true },
    });
    jobIds.push(job.id);
    try {
      await prisma.jobLog.create({ data: { jobId: job.id, line: `Queued mailbox healthcheck (${mode})` } });
    } catch {}
  }

  return NextResponse.json({ queued: jobIds.length, jobIds });
}
