import { NextRequest, NextResponse } from "next/server";
import dayjs from "dayjs";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueueJob } from "@/worker/queue";
import { absoluteUrl } from "@/lib/url";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const f = await req.formData();
  const campaignId = String(f.get("campaignId") || "");

  const camp = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId: s.wid } });
  if (!camp) return NextResponse.redirect(absoluteUrl(req, "/app/campaigns"));

  const leadIds = f.getAll("leadIds").map(x => String(x));

  const now = new Date();
  for (const leadId of leadIds) {
    try {
      await prisma.enrollment.create({
        data: {
          campaignId,
          leadId,
          status: "queued",
          currentStep: 1,
          nextRunAt: now,
        },
      });
    } catch {
      // ignore duplicates
    }
  }

  // ask worker to schedule immediately
  await enqueueJob("schedule_campaign", { campaignId, workspaceId: s.wid }, new Date());

  return NextResponse.redirect(absoluteUrl(req, `/app/campaigns/${campaignId}`));
}