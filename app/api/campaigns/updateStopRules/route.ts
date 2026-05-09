import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const form = await req.formData();

  const campaignId = String(form.get("campaignId") || "");
  if (!campaignId) return NextResponse.redirect(absoluteUrl(req, "/app/campaigns"));

  const stopOnReply = String(form.get("stopOnReply") || "") === "on";
  const stopOnBounce = String(form.get("stopOnBounce") || "") === "on";
  const stopOnUnsubscribe = String(form.get("stopOnUnsubscribe") || "") === "on";
  const stopOnOOO = String(form.get("stopOnOOO") || "") === "on";

  const stopKeywords = String(form.get("stopKeywords") || "");
  const notInterestedKeywords = String(form.get("notInterestedKeywords") || "");
  const oooKeywords = String(form.get("oooKeywords") || "");

  await prisma.campaign.updateMany({
    where: { id: campaignId, workspaceId: s.wid },
    data: {
      stopOnReply,
      stopOnBounce,
      stopOnUnsubscribe,
      stopOnOOO,
      stopKeywords,
      notInterestedKeywords,
      oooKeywords,
    } as any,
  });

  return NextResponse.redirect(absoluteUrl(req, `/app/campaigns/${campaignId}/settings?saved=1`));
}
