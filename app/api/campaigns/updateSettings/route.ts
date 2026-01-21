import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/url";

function num(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const form = await req.formData();

  const campaignId = String(form.get("campaignId") || "");
  const name = String(form.get("name") || "").trim();
  if (!campaignId || !name) return NextResponse.redirect(absoluteUrl(req, "/app/campaigns"));

  const tz = String(form.get("timezone") || "Asia/Kolkata").trim() || "Asia/Kolkata";
  const sendingWindow = String(form.get("sendingWindow") || "09:00-18:00").trim() || "09:00-18:00";
  const dailySendLimit = num(form.get("dailySendLimit"), 200);
  const mailboxStrategy = String(form.get("mailboxStrategy") || "round_robin");
  const mailboxMinIdleMinutes = Math.max(0, Math.floor(num(form.get("mailboxMinIdleMinutes"), 0)));

  const startAtRaw = String(form.get("startAt") || "").trim();
  const endAtRaw = String(form.get("endAt") || "").trim();
  const startAt = startAtRaw ? new Date(startAtRaw) : null;
  const endAt = endAtRaw ? new Date(endAtRaw) : null;

  const dayVals = form.getAll("daysOfWeek").map((x) => Number(x)).filter((x) => Number.isFinite(x));
  const daysOfWeek = dayVals.length ? JSON.stringify(dayVals) : null;

  const rampEnabled = String(form.get("rampEnabled") || "") === "on";
  const rampStartLimit = num(form.get("rampStartLimit"), 20);
  const rampDailyIncrease = num(form.get("rampDailyIncrease"), 20);
  const rampMaxLimit = num(form.get("rampMaxLimit"), dailySendLimit);

  // Throttling & domain caps
  const perMailboxPerMinute = Math.max(1, Math.floor(num(form.get("perMailboxPerMinute"), 20)));
  const domainDailyCap = Math.max(0, Math.floor(num(form.get("domainDailyCap"), 25)));
  const domainCaps = String(form.get("domainCaps") || "").trim() || null;

  // Deliverability guardrails
  const guardEnabled = String(form.get("guardEnabled") || "") === "on";
  const guardWindowHours = Math.max(1, Math.floor(num(form.get("guardWindowHours"), 24)));
  const guardMinSent = Math.max(1, Math.floor(num(form.get("guardMinSent"), 50)));
  const guardMaxHardBounceRate = Math.max(0, num(form.get("guardMaxHardBouncePct"), 5) / 100);
  const guardMaxBounceRate = Math.max(0, num(form.get("guardMaxBouncePct"), 8) / 100);
  const guardMaxUnsubRate = Math.max(0, num(form.get("guardMaxUnsubPct"), 2) / 100);

  // Auto mailbox throttling (cooldown on bounce spikes)
  const autoThrottleEnabled = String(form.get("autoThrottleEnabled") || "") === "on";
  const autoThrottleWindowMinutes = Math.max(5, Math.floor(num(form.get("autoThrottleWindowMinutes"), 60)));
  const autoThrottleMinSent = Math.max(1, Math.floor(num(form.get("autoThrottleMinSent"), 20)));
  const autoThrottleMaxHardBounceRate = Math.max(0, num(form.get("autoThrottleMaxHardBouncePct"), 8) / 100);
  const autoThrottleMaxBounceRate = Math.max(0, num(form.get("autoThrottleMaxBouncePct"), 12) / 100);
  const autoThrottleCooldownMinutes = Math.max(5, Math.floor(num(form.get("autoThrottleCooldownMinutes"), 120)));

  await prisma.campaign.updateMany({
    where: { id: campaignId, workspaceId: s.wid },
    data: {
      name,
      timezone: tz,
      sendingWindow,
      dailySendLimit,
      mailboxStrategy,
      mailboxMinIdleMinutes,
      startAt,
      endAt,
      daysOfWeek,
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
    },
  });

  return NextResponse.redirect(absoluteUrl(req, `/app/campaigns/${campaignId}/settings?saved=1`));
}
