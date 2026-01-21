import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({} as any));

  const campaignId = String(body?.campaignId || "");
  if (!campaignId) return NextResponse.json({ error: "campaignId_required" }, { status: 400 });

  const camp = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId: s.wid } });
  if (!camp) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      setupStep: 5,
      setupCompleted: true,
    } as any,
  });

  return NextResponse.json({ ok: true as const });
}
