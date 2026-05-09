import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function num(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({} as any));

  const campaignId = String(body?.campaignId || "");
  if (!campaignId) return NextResponse.json({ error: "campaignId_required" }, { status: 400 });

  const camp = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId: s.wid } });
  if (!camp) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const s1 = body?.s1 || {};
  const s2 = body?.s2 || {};
  const s1b = body?.s1b || null;
  const s2b = body?.s2b || null;

  const step1Data = {
    delayDays: 0,
    subjectTpl: String(s1.subjectTpl || "").trim(),
    bodyTpl: String(s1.bodyTpl || "").trim(),
    isReply: false,
    abEnabled: Boolean(!!s1b),
  };
  const step2Data = {
    delayDays: Math.max(0, Math.floor(num(s2.delayDays, 2))),
    subjectTpl: String(s2.subjectTpl || "").trim(),
    bodyTpl: String(s2.bodyTpl || "").trim(),
    isReply: true,
    abEnabled: Boolean(!!s2b),
  };

  if (!step1Data.subjectTpl || !step1Data.bodyTpl) return NextResponse.json({ error: "step1_required" }, { status: 400 });
  if (!step2Data.subjectTpl || !step2Data.bodyTpl) return NextResponse.json({ error: "step2_required" }, { status: 400 });

  const step1 = await prisma.sequenceStep.upsert({
    where: { campaignId_stepNumber: { campaignId, stepNumber: 1 } },
    update: step1Data as any,
    create: { campaignId, stepNumber: 1, ...(step1Data as any) },
  });
  const step2 = await prisma.sequenceStep.upsert({
    where: { campaignId_stepNumber: { campaignId, stepNumber: 2 } },
    update: step2Data as any,
    create: { campaignId, stepNumber: 2, ...(step2Data as any) },
  });

  async function upsertVariant(
    stepId: string,
    name: string,
    tpl: { subjectTpl: string; bodyTpl: string; weight: number },
    active: boolean
  ) {
    if (!active) {
      await prisma.stepVariant.deleteMany({ where: { stepId, name } }).catch(() => {});
      return;
    }
    await prisma.stepVariant.upsert({
      where: { stepId_name: { stepId, name } },
      update: { ...tpl, isActive: true } as any,
      create: { stepId, name, ...tpl, isActive: true } as any,
    });
  }

  // Step 1 variants
  const s1bActive = !!s1b && num(s1b.weight, 50) > 0 && !!String(s1b.subjectTpl || "").trim() && !!String(s1b.bodyTpl || "").trim();
  const s1bWeight = Math.min(100, Math.max(0, Math.floor(num(s1b?.weight, 50))));
  await upsertVariant(step1.id, "A", { subjectTpl: step1Data.subjectTpl, bodyTpl: step1Data.bodyTpl, weight: 100 - (s1bActive ? s1bWeight : 0) }, true);
  await upsertVariant(step1.id, "B", { subjectTpl: String(s1b?.subjectTpl || "").trim(), bodyTpl: String(s1b?.bodyTpl || "").trim(), weight: s1bWeight }, s1bActive);

  // Step 2 variants
  const s2bActive = !!s2b && num(s2b.weight, 50) > 0 && !!String(s2b.subjectTpl || "").trim() && !!String(s2b.bodyTpl || "").trim();
  const s2bWeight = Math.min(100, Math.max(0, Math.floor(num(s2b?.weight, 50))));
  await upsertVariant(step2.id, "A", { subjectTpl: step2Data.subjectTpl, bodyTpl: step2Data.bodyTpl, weight: 100 - (s2bActive ? s2bWeight : 0) }, true);
  await upsertVariant(step2.id, "B", { subjectTpl: String(s2b?.subjectTpl || "").trim(), bodyTpl: String(s2b?.bodyTpl || "").trim(), weight: s2bWeight }, s2bActive);

  // Mark wizard progress
  await prisma.campaign.updateMany({
    where: { id: campaignId, workspaceId: s.wid },
    data: { setupStep: 3, setupCompleted: false },
  }).catch(() => {});

  return NextResponse.json({ ok: true as const });
}
