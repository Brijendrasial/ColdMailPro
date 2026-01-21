import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/url";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const form = await req.formData();
  const campaignId = String(form.get("campaignId") || "");
  if (!campaignId) return NextResponse.redirect(absoluteUrl(req, "/app/campaigns"));

  const camp = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId: s.wid } });
  if (!camp) return NextResponse.redirect(absoluteUrl(req, "/app/campaigns"));

  const archivedAt = (camp as any).archivedAt ? null : new Date();

  await prisma.campaign.update({
    where: { id: camp.id },
    data: {
      archivedAt,
      status: archivedAt ? "paused" : camp.status,
    } as any,
  }).catch(() => {});

  return NextResponse.redirect(absoluteUrl(req, `/app/campaigns/${camp.id}/settings`));
}
