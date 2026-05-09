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
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const campaignId = String(body.campaignId || "").trim();
  const mailboxId = String(body.mailboxId || "").trim();
  const excluded = !!body.excluded;

  if (!campaignId || !mailboxId) {
    return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
  }

  const [camp, mb] = await Promise.all([
    prisma.campaign.findFirst({ where: { id: campaignId, workspaceId: s.wid }, select: { id: true } }),
    prisma.mailbox.findFirst({ where: { id: mailboxId, workspaceId: s.wid }, select: { id: true } }),
  ]);

  if (!camp) return NextResponse.json({ ok: false, error: "CAMPAIGN_NOT_FOUND" }, { status: 404 });
  if (!mb) return NextResponse.json({ ok: false, error: "MAILBOX_NOT_FOUND" }, { status: 404 });

  const manualActiveCount = await prisma.campaignMailbox.count({ where: { campaignId, isActive: true } }).catch(() => 0);

  if (excluded) {
    await prisma.campaignMailbox.upsert({
      where: { campaignId_mailboxId: { campaignId, mailboxId } },
      update: { isActive: false },
      create: { campaignId, mailboxId, isActive: false },
    });

    return NextResponse.json({ ok: true, data: { excluded: true } });
  }

  // Unexclude:
  // - If campaign is in manual mode (has active CampaignMailbox rows), flipping back means "include".
  // - Otherwise (pool/all), removing an exclusion should revert to base sender set, so we delete the inactive row.
  if (manualActiveCount > 0) {
    await prisma.campaignMailbox.upsert({
      where: { campaignId_mailboxId: { campaignId, mailboxId } },
      update: { isActive: true },
      create: { campaignId, mailboxId, isActive: true },
    });
    return NextResponse.json({ ok: true, data: { excluded: false } });
  }

  const existing = await prisma.campaignMailbox.findUnique({
    where: { campaignId_mailboxId: { campaignId, mailboxId } },
    select: { id: true, isActive: true },
  });

  if (existing && existing.isActive === false) {
    await prisma.campaignMailbox.delete({ where: { id: existing.id } });
  }

  return NextResponse.json({ ok: true, data: { excluded: false } });
}
