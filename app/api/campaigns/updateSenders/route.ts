import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const form = await req.formData();

  const campaignId = String(form.get("campaignId") || "");
  const senderMode = String(form.get("senderMode") || "manual");
  const mailboxPoolId = form.get("mailboxPoolId") ? String(form.get("mailboxPoolId")) : null;
  const mailboxIds = form.getAll("mailboxIds").map((x) => String(x));

  if (!campaignId) return NextResponse.redirect(absoluteUrl(req, "/app/campaigns"));

  // Ensure campaign belongs to workspace
  const camp = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId: s.wid } });
  if (!camp) return NextResponse.redirect(absoluteUrl(req, "/app/campaigns"));

  // Validate pool if needed
  let poolIdToSet: string | null = null;
  if (senderMode === "pool" && mailboxPoolId) {
    const pool = await prisma.mailboxPool.findFirst({ where: { id: mailboxPoolId, workspaceId: s.wid }, select: { id: true } });
    poolIdToSet = pool ? pool.id : null;
  }

  // Persist sender mode
  await prisma.campaign.updateMany({
    where: { id: campaignId, workspaceId: s.wid },
    data: { mailboxPoolId: senderMode === "pool" ? poolIdToSet : null },
  });

  // Replace explicit sender pool rows (manual mode only)
  await prisma.campaignMailbox.deleteMany({ where: { campaignId } }).catch(() => {});
  if (senderMode === "manual" && mailboxIds.length) {
    await prisma.campaignMailbox
      .createMany({
        data: mailboxIds.map((mailboxId) => ({ campaignId, mailboxId, isActive: true })),
        skipDuplicates: true,
      })
      .catch(() => {});
  }

  return NextResponse.redirect(absoluteUrl(req, `/app/campaigns/${campaignId}/settings?saved=1`));
}
