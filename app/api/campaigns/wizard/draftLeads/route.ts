import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({} as any));

  const campaignId = String(body?.campaignId || "");
  const leadIds = Array.isArray(body?.leadIds) ? body.leadIds.map((x: any) => String(x)) : [];

  if (!campaignId) return NextResponse.json({ error: "campaignId_required" }, { status: 400 });

  const camp = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId: s.wid } });
  if (!camp) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Keep it bounded
  const trimmed = leadIds.slice(0, 1500);

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      draftLeadIds: trimmed.length ? JSON.stringify(trimmed) : null,
      setupStep: 4,
      setupCompleted: false,
    } as any,
  });

  return NextResponse.json({ ok: true as const });
}
