import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function num(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function clamp01(x: any, fallback: number) {
  const n = num(x, fallback);
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({} as any));

  const campaignId = String(body?.campaignId || "");
  const name = String(body?.name || "").trim();
  if (!campaignId || !name) return NextResponse.json({ error: "missing_campaign_or_name" }, { status: 400 });

  const tz = String(body?.timezone || "Asia/Kolkata").trim() || "Asia/Kolkata";
  const sendingWindow = String(body?.sendingWindow || "09:00-18:00").trim() || "09:00-18:00";

  const startAt = body?.startAt ? new Date(String(body.startAt)) : null;
  const endAt = body?.endAt ? new Date(String(body.endAt)) : null;

  const dayVals = Array.isArray(body?.daysOfWeek) ? body.daysOfWeek.map((x: any) => Number(x)).filter((x: any) => Number.isFinite(x)) : [];
  const daysOfWeek = dayVals.length ? JSON.stringify(dayVals) : null;

  const dailySendLimit = Math.max(0, Math.floor(num(body?.dailySendLimit, 200)));

  const rampEnabled = Boolean(body?.rampEnabled);
  const rampStartLimit = Math.max(1, Math.floor(num(body?.rampStartLimit, 20)));
  const rampDailyIncrease = Math.max(1, Math.floor(num(body?.rampDailyIncrease, 20)));
  const rampMaxLimit = Math.max(1, Math.floor(num(body?.rampMaxLimit, dailySendLimit || 200)));

  const perMailboxPerMinute = Math.max(1, Math.floor(num(body?.perMailboxPerMinute, 20)));
  const domainDailyCap = Math.max(0, Math.floor(num(body?.domainDailyCap, 25)));
  const domainCaps = String(body?.domainCaps || "").trim() || null;

  const guardEnabled = Boolean(body?.guardEnabled);
  const guardWindowHours = Math.max(1, Math.floor(num(body?.guardWindowHours, 24)));
  const guardMinSent = Math.max(1, Math.floor(num(body?.guardMinSent, 50)));
  const guardMaxHardBounceRate = clamp01(body?.guardMaxHardBounceRate, 0.05);
  const guardMaxBounceRate = clamp01(body?.guardMaxBounceRate, 0.08);
  const guardMaxUnsubRate = clamp01(body?.guardMaxUnsubRate, 0.02);

  const autoThrottleEnabled = Boolean(body?.autoThrottleEnabled);
  const autoThrottleWindowMinutes = Math.max(5, Math.floor(num(body?.autoThrottleWindowMinutes, 60)));
  const autoThrottleMinSent = Math.max(1, Math.floor(num(body?.autoThrottleMinSent, 20)));
  const autoThrottleMaxHardBounceRate = clamp01(body?.autoThrottleMaxHardBounceRate, 0.08);
  const autoThrottleMaxBounceRate = clamp01(body?.autoThrottleMaxBounceRate, 0.12);
  const autoThrottleCooldownMinutes = Math.max(5, Math.floor(num(body?.autoThrottleCooldownMinutes, 120)));

  // Stop rules (combined for wizard convenience)
  const stopOnReply = Boolean(body?.stopOnReply);
  const stopOnBounce = Boolean(body?.stopOnBounce);
  const stopOnUnsubscribe = Boolean(body?.stopOnUnsubscribe);
  const stopOnOOO = Boolean(body?.stopOnOOO);
  const stopKeywords = body?.stopKeywords ? String(body.stopKeywords) : null;
  const notInterestedKeywords = body?.notInterestedKeywords ? String(body.notInterestedKeywords) : null;
  const oooKeywords = body?.oooKeywords ? String(body.oooKeywords) : null;

  const camp = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId: s.wid } });
  if (!camp) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      name,
      timezone: tz,
      sendingWindow,
      startAt,
      endAt,
      daysOfWeek,

      dailySendLimit,
      rampEnabled,
      rampStartLimit,
      rampDailyIncrease,
      rampMaxLimit,

      perMailboxPerMinute,
      domainDailyCap,
      domainCaps,

      guardEnabled,
      guardWindowHours,
      guardMinSent,
      guardMaxHardBounceRate,
      guardMaxBounceRate,
      guardMaxUnsubRate,

      autoThrottleEnabled,
      autoThrottleWindowMinutes,
      autoThrottleMinSent,
      autoThrottleMaxHardBounceRate,
      autoThrottleMaxBounceRate,
      autoThrottleCooldownMinutes,

      stopOnReply,
      stopOnBounce,
      stopOnUnsubscribe,
      stopOnOOO,
      stopKeywords,
      notInterestedKeywords,
      oooKeywords,

      setupStep: 2,
      setupCompleted: false,
    } as any,
  });

  return NextResponse.json({ ok: true as const });
}
