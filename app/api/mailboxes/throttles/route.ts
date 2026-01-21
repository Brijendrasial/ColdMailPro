import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Returns active per-campaign cooldowns for a mailbox.
// Cooldowns are stored in MailboxThrottle (unique per campaign+mailbox).

export async function GET(req: NextRequest) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const mailboxId = String(searchParams.get("mailboxId") || "");
  if (!mailboxId) return NextResponse.json({ error: "MISSING_MAILBOX_ID" }, { status: 400 });

  const mb = await prisma.mailbox.findFirst({
    where: { id: mailboxId, workspaceId: s.wid },
    select: { id: true },
  });
  if (!mb) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const now = new Date();
  const throttles = await prisma.mailboxThrottle.findMany({
    where: { mailboxId, until: { gt: now } },
    orderBy: { until: "asc" },
    select: { campaignId: true, until: true, reason: true, createdAt: true },
  });

  const campaignIds = Array.from(new Set(throttles.map((t) => String(t.campaignId))));
  const campaigns = campaignIds.length
    ? await prisma.campaign.findMany({
        where: { workspaceId: s.wid, id: { in: campaignIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map<string, string>(campaigns.map((c) => [String(c.id), String(c.name)]));

  return NextResponse.json({
    ok: true,
    throttles: throttles.map((t) => ({
      campaignId: String(t.campaignId),
      campaignName: nameById.get(String(t.campaignId)) || "(unknown)",
      until: (t.until as Date).toISOString(),
      reason: (t.reason || "").toString() || null,
      createdAt: (t.createdAt as Date).toISOString(),
    })),
  });
}
