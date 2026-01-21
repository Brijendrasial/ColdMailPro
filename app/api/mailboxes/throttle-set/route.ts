import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function clampInt(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
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

  const mailboxId = String(body?.mailboxId || "");
  const campaignId = String(body?.campaignId || "");
  const minutes = clampInt(Number(body?.minutes), 1, 60 * 24 * 30); // up to 30 days
  const reasonIn = String(body?.reason || "").trim();

  if (!mailboxId) return NextResponse.json({ error: "MISSING_MAILBOX_ID" }, { status: 400 });
  if (!campaignId) return NextResponse.json({ error: "MISSING_CAMPAIGN_ID" }, { status: 400 });

  const [mb, camp] = await Promise.all([
    prisma.mailbox.findFirst({ where: { id: mailboxId, workspaceId: s.wid }, select: { id: true } }),
    prisma.campaign.findFirst({ where: { id: campaignId, workspaceId: s.wid }, select: { id: true } }),
  ]);

  if (!mb) return NextResponse.json({ error: "MAILBOX_NOT_FOUND" }, { status: 404 });
  if (!camp) return NextResponse.json({ error: "CAMPAIGN_NOT_FOUND" }, { status: 404 });

  const now = new Date();
  const until = new Date(now.getTime() + minutes * 60 * 1000);
  const reason = reasonIn ? `manual: ${reasonIn}` : "manual";

  // Unique per campaign+mailbox. Extend if already throttled.
  const existing = await prisma.mailboxThrottle.findUnique({
    where: { campaignId_mailboxId: { campaignId, mailboxId } },
    select: { until: true, reason: true },
  });

  const nextUntil = existing?.until && (existing.until as any) > until ? existing.until : until;
  const nextReason = existing?.reason ? String(existing.reason) : "";
  const mergedReason = nextReason && nextReason !== reason ? `${nextReason} | ${reason}` : reason;

  await prisma.mailboxThrottle.upsert({
    where: { campaignId_mailboxId: { campaignId, mailboxId } },
    update: { until: nextUntil, reason: mergedReason },
    create: { campaignId, mailboxId, until: nextUntil, reason: mergedReason },
  });

  return NextResponse.json({ ok: true, mailboxId, campaignId, until: nextUntil.toISOString() });
}
