import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueueJob } from "@/worker/queue";
import { absoluteUrl } from "@/lib/url";
import { buildCampaignQaReport } from "@/lib/campaign-qa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const form = await req.formData();
  const id = String(form.get("id") || "");

  const camp = await prisma.campaign.findFirst({ where: { id, workspaceId: s.wid } });
  if (!camp) return NextResponse.redirect(absoluteUrl(req, "/app/campaigns"));

  if ((camp as any).archivedAt) {
    return NextResponse.redirect(absoluteUrl(req, `/app/campaigns/${id}?err=archived`));
  }

  const nextStatus = camp.status === "running" ? "paused" : "running";

  // Pre-send QA gate: block starting if there are hard errors.
  if (nextStatus === "running") {
    const report = await buildCampaignQaReport(s.wid, id);
    if (!report.ok) {
      return NextResponse.redirect(absoluteUrl(req, `/app/campaigns/${id}/settings?qa=failed`));
    }
  }

  await prisma.campaign.update({ where: { id }, data: { status: nextStatus } });

  if (nextStatus === "running") {
    // kick worker to schedule enrollments now
    await enqueueJob("schedule_campaign", { campaignId: id, workspaceId: s.wid }, new Date());
  }

  return NextResponse.redirect(absoluteUrl(req, `/app/campaigns/${id}`));
}