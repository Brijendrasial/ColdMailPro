import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({} as any));
  const name = String(body?.name || "").trim();
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });

  const camp = await prisma.campaign.create({
    data: { workspaceId: s.wid, name, status: "draft", setupStep: 0, setupCompleted: false },
  });

  // Default two-step sequence (same as /api/campaigns/create)
  await prisma.sequenceStep.createMany({
    data: [
      {
        campaignId: camp.id,
        stepNumber: 1,
        delayDays: 0,
        subjectTpl: "Quick question, {{firstName}}",
        bodyTpl: "Hi {{firstName}},\n\n...\n\n— {{senderName}}",
        isReply: false,
      },
      {
        campaignId: camp.id,
        stepNumber: 2,
        delayDays: 2,
        subjectTpl: "Re: {{company}}",
        bodyTpl: "Hi {{firstName}},\n\nBumping this...\n\n— {{senderName}}",
        isReply: true,
      },
    ],
  }).catch(() => {});

  return NextResponse.json({ campaignId: camp.id });
}
