import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function safeJsonParse<T>(s: any, fallback: T): T {
  try {
    if (typeof s !== "string" || !s.trim()) return fallback;
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export async function GET(req: NextRequest) {
  const s = await requireSession();
  const { searchParams } = new URL(req.url);
  const campaignId = String(searchParams.get("campaignId") || "");
  if (!campaignId) return NextResponse.json({ error: "campaignId_required" }, { status: 400 });

  const camp = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId: s.wid },
    include: {
      steps: { include: { variants: true }, orderBy: { stepNumber: "asc" } },
      mailboxes: { where: { isActive: true } },
    },
  });
  if (!camp) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const mailboxIds = (camp as any).mailboxes?.map((x: any) => x.mailboxId) || [];
  const mailboxPoolId = (camp as any).mailboxPoolId ? String((camp as any).mailboxPoolId) : null;
  const senderMode = mailboxIds.length > 0 ? "manual" : mailboxPoolId ? "pool" : "all";
  const daysOfWeek = safeJsonParse<number[]>((camp as any).daysOfWeek, [1, 2, 3, 4, 5]);
  const draftLeadIds = safeJsonParse<string[]>((camp as any).draftLeadIds, []);

  // steps 1/2 + optional B variants
  const step1 = (camp as any).steps?.find((x: any) => x.stepNumber === 1);
  const step2 = (camp as any).steps?.find((x: any) => x.stepNumber === 2);

  function pickVariant(step: any, name: string) {
    if (!step?.variants) return null;
    return step.variants.find((v: any) => v.name === name) || null;
  }

  const s1b = pickVariant(step1, "B");
  const s2b = pickVariant(step2, "B");

  return NextResponse.json({
    campaign: {
      id: camp.id,
      name: camp.name,
      status: camp.status,
      timezone: camp.timezone,
      sendingWindow: camp.sendingWindow,
      startAt: camp.startAt ? camp.startAt.toISOString() : null,
      endAt: camp.endAt ? camp.endAt.toISOString() : null,
      daysOfWeek,

      dailySendLimit: camp.dailySendLimit,
      rampEnabled: (camp as any).rampEnabled,
      rampStartLimit: (camp as any).rampStartLimit,
      rampDailyIncrease: (camp as any).rampDailyIncrease,
      rampMaxLimit: (camp as any).rampMaxLimit,

      perMailboxPerMinute: (camp as any).perMailboxPerMinute,
      domainDailyCap: (camp as any).domainDailyCap,
      domainCaps: (camp as any).domainCaps,

      guardEnabled: (camp as any).guardEnabled,
      guardWindowHours: (camp as any).guardWindowHours,
      guardMinSent: (camp as any).guardMinSent,
      guardMaxHardBounceRate: (camp as any).guardMaxHardBounceRate,
      guardMaxBounceRate: (camp as any).guardMaxBounceRate,
      guardMaxUnsubRate: (camp as any).guardMaxUnsubRate,

      autoThrottleEnabled: (camp as any).autoThrottleEnabled,
      autoThrottleWindowMinutes: (camp as any).autoThrottleWindowMinutes,
      autoThrottleMinSent: (camp as any).autoThrottleMinSent,
      autoThrottleMaxHardBounceRate: (camp as any).autoThrottleMaxHardBounceRate,
      autoThrottleMaxBounceRate: (camp as any).autoThrottleMaxBounceRate,
      autoThrottleCooldownMinutes: (camp as any).autoThrottleCooldownMinutes,

      mailboxStrategy: (camp as any).mailboxStrategy,
      mailboxMinIdleMinutes: (camp as any).mailboxMinIdleMinutes ?? 0,

      stopOnReply: (camp as any).stopOnReply,
      stopOnBounce: (camp as any).stopOnBounce,
      stopOnUnsubscribe: (camp as any).stopOnUnsubscribe,
      stopOnOOO: (camp as any).stopOnOOO,
      stopKeywords: (camp as any).stopKeywords,
      notInterestedKeywords: (camp as any).notInterestedKeywords,
      oooKeywords: (camp as any).oooKeywords,

      setupStep: (camp as any).setupStep ?? 0,
      setupCompleted: Boolean((camp as any).setupCompleted),
    },
    senderMode,
    mailboxPoolId,
    mailboxIds,
    draftLeadIds,
    steps: {
      s1: step1 ? { subjectTpl: step1.subjectTpl, bodyTpl: step1.bodyTpl } : null,
      s2: step2 ? { subjectTpl: step2.subjectTpl, bodyTpl: step2.bodyTpl, delayDays: step2.delayDays } : null,
      s1b: s1b ? { subjectTpl: s1b.subjectTpl, bodyTpl: s1b.bodyTpl, weight: s1b.weight } : null,
      s2b: s2b ? { subjectTpl: s2b.subjectTpl, bodyTpl: s2b.bodyTpl, weight: s2b.weight } : null,
    },
  });
}
