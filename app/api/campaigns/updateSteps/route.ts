import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bool(v: any) { return v === "on" || v === "true" || v === true; }
function num(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const f = await req.formData();

  const campaignId = String(f.get("campaignId") || "");
  const camp = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId: s.wid } });
  if (!camp) return NextResponse.redirect(absoluteUrl(req, "/app/campaigns"));

  const s1 = {
    subjectTpl: String(f.get("s1_subject") || ""),
    bodyTpl: String(f.get("s1_body") || ""),
    delayDays: Number(f.get("s1_delay") || 0),
    isReply: bool(f.get("s1_isReply")),
    abEnabled: bool(f.get("s1_abEnabled")),
  };
  const s2 = {
    subjectTpl: String(f.get("s2_subject") || ""),
    bodyTpl: String(f.get("s2_body") || ""),
    delayDays: Number(f.get("s2_delay") || 2),
    isReply: bool(f.get("s2_isReply")),
    abEnabled: bool(f.get("s2_abEnabled")),
  };

  const s1b = {
    subjectTpl: String(f.get("s1_b_subject") || "").trim(),
    bodyTpl: String(f.get("s1_b_body") || "").trim(),
    weight: Math.min(100, Math.max(0, Math.floor(num(f.get("s1_b_weight"), 50)))),
  };
  const s2b = {
    subjectTpl: String(f.get("s2_b_subject") || "").trim(),
    bodyTpl: String(f.get("s2_b_body") || "").trim(),
    weight: Math.min(100, Math.max(0, Math.floor(num(f.get("s2_b_weight"), 50)))),
  };

  const step1 = await prisma.sequenceStep.upsert({
    where: { campaignId_stepNumber: { campaignId, stepNumber: 1 } },
    update: s1,
    create: { campaignId, stepNumber: 1, ...s1 },
  });
  const step2 = await prisma.sequenceStep.upsert({
    where: { campaignId_stepNumber: { campaignId, stepNumber: 2 } },
    update: s2,
    create: { campaignId, stepNumber: 2, ...s2 },
  });

  // Maintain StepVariant rows (A is always present; B optional)
  async function upsertVariant(stepId: string, name: string, tpl: { subjectTpl: string; bodyTpl: string; weight: number }, active: boolean) {
    if (!active) {
      await prisma.stepVariant.deleteMany({ where: { stepId, name } }).catch(() => {});
      return;
    }
    await prisma.stepVariant.upsert({
      where: { stepId_name: { stepId, name } },
      update: { ...tpl, isActive: true },
      create: { stepId, name, ...tpl, isActive: true },
    });
  }

  // Step 1
  const s1BActive = Boolean(s1.abEnabled) && s1b.weight > 0 && !!s1b.subjectTpl && !!s1b.bodyTpl;
  await upsertVariant(step1.id, "A", { subjectTpl: s1.subjectTpl, bodyTpl: s1.bodyTpl, weight: 100 - (s1BActive ? s1b.weight : 0) }, true);
  await upsertVariant(step1.id, "B", { subjectTpl: s1b.subjectTpl, bodyTpl: s1b.bodyTpl, weight: s1b.weight }, s1BActive);

  // Step 2
  const s2BActive = Boolean(s2.abEnabled) && s2b.weight > 0 && !!s2b.subjectTpl && !!s2b.bodyTpl;
  await upsertVariant(step2.id, "A", { subjectTpl: s2.subjectTpl, bodyTpl: s2.bodyTpl, weight: 100 - (s2BActive ? s2b.weight : 0) }, true);
  await upsertVariant(step2.id, "B", { subjectTpl: s2b.subjectTpl, bodyTpl: s2b.bodyTpl, weight: s2b.weight }, s2BActive);

  return NextResponse.redirect(absoluteUrl(req, `/app/campaigns/${campaignId}`));
}