import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
  const ids = Array.isArray(body?.ids) ? body.ids.map((x: any) => String(x)).filter(Boolean) : [];

  const now = new Date();

  // Bulk clear: clear all active cooldowns for multiple mailboxes.
  if (ids.length) {
    const mailboxes = await prisma.mailbox.findMany({
      where: { workspaceId: s.wid, id: { in: ids } },
      select: { id: true },
    });
    const allowed = mailboxes.map((m) => String(m.id));
    if (!allowed.length) return NextResponse.json({ ok: true, cleared: 0 });

    const res = await prisma.mailboxThrottle.deleteMany({
      where: { mailboxId: { in: allowed }, until: { gt: now } },
    });

    return NextResponse.json({ ok: true, cleared: res.count });
  }

  if (!mailboxId) return NextResponse.json({ error: "MISSING_MAILBOX_ID" }, { status: 400 });

  const mb = await prisma.mailbox.findFirst({ where: { id: mailboxId, workspaceId: s.wid }, select: { id: true } });
  if (!mb) return NextResponse.json({ error: "MAILBOX_NOT_FOUND" }, { status: 404 });

  if (campaignId) {
    // Clear specific campaign cooldown
    const camp = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId: s.wid }, select: { id: true } });
    if (!camp) return NextResponse.json({ error: "CAMPAIGN_NOT_FOUND" }, { status: 404 });

    const res = await prisma.mailboxThrottle.deleteMany({
      where: { mailboxId, campaignId, until: { gt: now } },
    });
    return NextResponse.json({ ok: true, cleared: res.count });
  }

  // Clear all active cooldowns for this mailbox.
  const res = await prisma.mailboxThrottle.deleteMany({
    where: { mailboxId, until: { gt: now } },
  });

  return NextResponse.json({ ok: true, cleared: res.count });
}
