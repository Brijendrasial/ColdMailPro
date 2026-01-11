import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({} as any));

  const campaignId = String(body?.campaignId || "");
  const senderMode = String(body?.senderMode || "manual");
  const mailboxPoolId = body?.mailboxPoolId ? String(body.mailboxPoolId) : null;
  const mailboxIds = Array.isArray(body?.mailboxIds) ? body.mailboxIds.map((x: any) => String(x)) : [];
  const mailboxStrategy = String(body?.mailboxStrategy || "round_robin");

  if (!campaignId) return NextResponse.json({ error: "campaignId_required" }, { status: 400 });

  const camp = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId: s.wid } });
  if (!camp) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Validate pool if provided
  let poolIdToSet: string | null = null;
  if (senderMode === "pool" && mailboxPoolId) {
    const pool = await prisma.mailboxPool.findFirst({ where: { id: mailboxPoolId, workspaceId: s.wid }, select: { id: true } });
    poolIdToSet = pool ? pool.id : null;
  }

  // Persist strategy + mode
  await prisma.campaign.updateMany({
    where: { id: campaignId, workspaceId: s.wid },
    data: { mailboxStrategy, mailboxPoolId: senderMode === "pool" ? poolIdToSet : null, setupStep: 1, setupCompleted: false },
  });

  // Sender pool rows only apply in manual mode
  await prisma.campaignMailbox.deleteMany({ where: { campaignId } }).catch(() => {});
  if (senderMode === "manual" && mailboxIds.length) {
    await prisma.campaignMailbox.createMany({
      data: mailboxIds.map((mailboxId: string) => ({ campaignId, mailboxId, isActive: true })),
      skipDuplicates: true,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true as const });
}
