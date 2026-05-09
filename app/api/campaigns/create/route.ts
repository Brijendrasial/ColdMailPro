import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const form = await req.formData();
  const name = String(form.get("name") || "").trim();
  if (!name) return NextResponse.redirect(absoluteUrl(req, "/app/campaigns/new?err=1"));

  const camp = await prisma.campaign.create({
    data: { workspaceId: s.wid, name, status: "draft" },
  });

  // create two default steps
  await prisma.sequenceStep.createMany({
    data: [
      { campaignId: camp.id, stepNumber: 1, delayDays: 0, subjectTpl: "Quick question, {{firstName}}", bodyTpl: "Hi {{firstName}},\n\n...", isReply: false },
      { campaignId: camp.id, stepNumber: 2, delayDays: 2, subjectTpl: "Re: Quick question", bodyTpl: "Hi {{firstName}},\n\nBumping this...", isReply: true },
    ],
  });

  return NextResponse.redirect(absoluteUrl(req, `/app/campaigns/${camp.id}`));
}