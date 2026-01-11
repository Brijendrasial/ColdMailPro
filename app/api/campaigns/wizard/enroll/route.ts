import { NextRequest, NextResponse } from "next/server";
import dayjs from "dayjs";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueueJob } from "@/worker/queue";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({} as any));

  const campaignId = String(body?.campaignId || "");
  const leadIds = Array.isArray(body?.leadIds) ? body.leadIds.map((x: any) => String(x)) : [];

  if (!campaignId) return NextResponse.json({ error: "campaignId_required" }, { status: 400 });

  const camp = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId: s.wid } });
  if (!camp) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const now = dayjs().toDate();
  let enrolled = 0;
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
      enrolled++;
    } catch {
      // ignore duplicates
    }
  }

  // ask worker to schedule immediately
  await enqueueJob("schedule_campaign", { campaignId, workspaceId: s.wid }, new Date()).catch(() => {});

  // Mark wizard progress (still not completed until finalize)
  await prisma.campaign
    .updateMany({
      where: { id: campaignId, workspaceId: s.wid },
      data: { setupStep: 4, setupCompleted: false, draftLeadIds: leadIds.length ? JSON.stringify(leadIds.slice(0, 1500)) : null },
    })
    .catch(() => {});

  return NextResponse.json({ ok: true as const, enrolled });
}
