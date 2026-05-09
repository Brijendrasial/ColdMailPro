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

  const camp = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId: s.wid },
    include: { steps: { orderBy: { stepNumber: "asc" } }, mailboxes: true },
  });
  if (!camp) return NextResponse.redirect(absoluteUrl(req, "/app/campaigns"));

  const copy = await prisma.campaign.create({
    data: {
      workspaceId: camp.workspaceId,
      name: `${camp.name} (Copy)`,
      status: "draft",
      timezone: camp.timezone,
      sendingWindow: camp.sendingWindow,
      daysOfWeek: (camp as any).daysOfWeek ?? null,
      dailySendLimit: camp.dailySendLimit,
      rampEnabled: (camp as any).rampEnabled ?? false,
      rampStartLimit: (camp as any).rampStartLimit ?? 20,
      rampDailyIncrease: (camp as any).rampDailyIncrease ?? 20,
      rampMaxLimit: (camp as any).rampMaxLimit ?? camp.dailySendLimit,
      mailboxStrategy: camp.mailboxStrategy,
      stopOnReply: camp.stopOnReply,
      stopOnBounce: camp.stopOnBounce,
      stopOnUnsubscribe: (camp as any).stopOnUnsubscribe ?? true,
      stopOnOOO: (camp as any).stopOnOOO ?? true,
      stopKeywords: (camp as any).stopKeywords ?? null,
      notInterestedKeywords: (camp as any).notInterestedKeywords ?? null,
      oooKeywords: (camp as any).oooKeywords ?? null,
    } as any,
  });

  if (camp.steps?.length) {
    await prisma.sequenceStep.createMany({
      data: camp.steps.map((st) => ({
        campaignId: copy.id,
        stepNumber: st.stepNumber,
        delayDays: st.delayDays,
        subjectTpl: st.subjectTpl,
        bodyTpl: st.bodyTpl,
        isReply: st.isReply,
      })),
    }).catch(() => {});
  }

  // sender pool
  if ((camp as any).mailboxes?.length) {
    await prisma.campaignMailbox.createMany({
      data: (camp as any).mailboxes.map((m: any) => ({ campaignId: copy.id, mailboxId: m.mailboxId, isActive: m.isActive })),
      skipDuplicates: true,
    }).catch(() => {});
  }

  return NextResponse.redirect(absoluteUrl(req, `/app/campaigns/${copy.id}/settings`));
}
