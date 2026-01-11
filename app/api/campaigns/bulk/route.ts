import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueueJob } from "@/worker/queue";

type Action = "pause" | "run" | "stop" | "read" | "unread";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({} as any));
  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : [];
  const action: Action = String(body.action || "") as Action;

  if (!ids.length) return NextResponse.json({ ok: false, error: "Missing ids" }, { status: 400 });

  const campaigns = await prisma.campaign.findMany({ where: { id: { in: ids }, workspaceId: s.wid }, select: { id: true, status: true } });
  const foundIds = campaigns.map((c) => c.id);

  if (!foundIds.length) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  if (action === "pause") {
    await prisma.campaign.updateMany({ where: { id: { in: foundIds } }, data: { status: "paused" } });
    return NextResponse.json({ ok: true });
  }

  if (action === "run") {
    await prisma.campaign.updateMany({ where: { id: { in: foundIds } }, data: { status: "running" } });
    // schedule all
    await Promise.all(foundIds.map((id) => enqueueJob("schedule_campaign", { campaignId: id, workspaceId: s.wid }, new Date())));
    return NextResponse.json({ ok: true });
  }

  if (action === "stop") {
    await prisma.campaign.updateMany({ where: { id: { in: foundIds } }, data: { status: "stopped" } });
    return NextResponse.json({ ok: true });
  }

  // read/unread not implemented for campaigns (reserved for future "campaign notifications")
  if (action === "read" || action === "unread") {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
