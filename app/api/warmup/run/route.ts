import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let s: any;
  try { s = await requireSession(); } catch { return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }); }
  const body = await req.json().catch(() => ({}));
  const mailboxId = body.mailboxId ? String(body.mailboxId) : null;

  const mailboxes = await prisma.mailbox.findMany({
    where: { workspaceId: s.wid, isActive: true, ...(mailboxId ? { id: mailboxId } : {}) },
    select: { id: true, warmupEnabled: true },
  });

  let enqueued = 0;
  for (const mb of mailboxes) {
    if (!mb.warmupEnabled) continue;
    await prisma.job.create({
      data: { type: "warmup_tick", payload: JSON.stringify({ workspaceId: s.wid, mailboxId: mb.id, source: "manual", force: true }), runAt: new Date(), status: "queued" },
    }).catch(() => {});
    enqueued++;
  }

  // also enqueue seed checks
  await prisma.job.create({
    data: { type: "warmup_seed_check", payload: JSON.stringify({ workspaceId: s.wid, source: "manual" }), runAt: new Date(), status: "queued" },
  }).catch(() => {});

  return NextResponse.json({ ok: true, enqueued });
}
