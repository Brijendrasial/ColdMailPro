import dayjs from "dayjs";
import { prisma } from "@/lib/prisma";

export function getRecipientDomain(email: string): string | null {
  const e = String(email || "").toLowerCase().trim();
  const at = e.lastIndexOf("@");
  if (at <= 0 || at === e.length - 1) return null;
  return e.slice(at + 1).trim() || null;
}

export function parseDomainCaps(raw: any): Record<string, number> {
  if (!raw) return {};
  // Accept JSON map OR newline/CSV style: gmail.com=25\nyahoo.com=15
  const s = String(raw).trim();
  if (!s) return {};
  try {
    const j = JSON.parse(s);
    if (j && typeof j === "object" && !Array.isArray(j)) {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(j)) {
        const key = String(k || "").toLowerCase().trim();
        const n = Number(v);
        if (key && Number.isFinite(n) && n >= 0) out[key] = Math.floor(n);
      }
      return out;
    }
  } catch {
    // fallthrough
  }

  const out: Record<string, number> = {};
  for (const line of s.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^([^=:\s,]+)\s*(=|:)\s*(\d+)$/);
    if (!m) continue;
    out[m[1].toLowerCase()] = Math.max(0, parseInt(m[3], 10));
  }
  return out;
}

export function hashToPercent(key: string): number {
  // deterministic 0..99
  const s = String(key || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100;
}

export function pickWeightedVariant<T extends { weight?: number }>(key: string, variants: T[]): T {
  if (!variants.length) throw new Error("NO_VARIANTS");
  const weights = variants.map((v) => {
    const w = Number(v.weight);
    return Number.isFinite(w) && w > 0 ? w : 0;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return variants[0];
  const r = hashToPercent(key) / 100;
  let acc = 0;
  for (let i = 0; i < variants.length; i++) {
    acc += weights[i] / total;
    if (r <= acc) return variants[i];
  }
  return variants[variants.length - 1];
}

export function classifySmtpError(err: string): {
  smtpCode?: number;
  bounceType?: string;
  bounceClass?: "hard" | "soft" | "none";
} {
  const s = String(err || "");
  const m = s.match(/\b(\d{3})\b/);
  const smtpCode = m ? Number(m[1]) : undefined;

  const lower = s.toLowerCase();

  // soft bounces / temporary
  if (smtpCode && smtpCode >= 400 && smtpCode < 500) {
    return { smtpCode, bounceType: "soft", bounceClass: "soft" };
  }
  if (/\b4\.[0-9]\.[0-9]\b/.test(lower)) {
    return { smtpCode, bounceType: "soft", bounceClass: "soft" };
  }

  // mailbox full / quota
  if (/(mailbox full|quota|over quota|5\.2\.2)/.test(lower) || smtpCode === 552) {
    return { smtpCode, bounceType: "mailbox_full", bounceClass: "soft" };
  }

  // policy / blocked
  if (/(blocked|blacklist|spam|policy|5\.7\.|denied)/.test(lower)) {
    return { smtpCode, bounceType: "blocked", bounceClass: "hard" };
  }

  // hard bounces
  if (smtpCode && smtpCode >= 500 && smtpCode < 600) {
    // common invalid mailbox
    if (/(user unknown|no such user|unknown user|5\.1\.1|recipient address rejected)/.test(lower) || smtpCode === 550 || smtpCode === 553) {
      return { smtpCode, bounceType: "hard", bounceClass: "hard" };
    }
    return { smtpCode, bounceType: "hard", bounceClass: "hard" };
  }
  if (/\b5\.[0-9]\.[0-9]\b/.test(lower)) {
    return { smtpCode, bounceType: "hard", bounceClass: "hard" };
  }

  return { smtpCode, bounceType: undefined, bounceClass: "none" };
}

export async function maybeAutoPauseCampaign(campaignId: string) {
  const camp: any = await prisma.campaign.findUnique({ where: { id: campaignId } }).catch(() => null);
  if (!camp) return { paused: false as const, reason: "not_found" as const };
  if (camp.status !== "running") return { paused: false as const, reason: "not_running" as const };
  if (!camp.guardEnabled) return { paused: false as const, reason: "disabled" as const };

  const windowHours = Number(camp.guardWindowHours || 24);
  const minSent = Number(camp.guardMinSent || 50);
  const since = dayjs().subtract(windowHours, "hour").toDate();

  const sent = await prisma.message
    .count({ where: { campaignId, status: "sent", sentAt: { gte: since } } })
    .catch(() => 0);
  if (sent < minSent) return { paused: false as const, reason: "min_not_met" as const, sent };

  const [hardBounces, softBounces, unsubs] = await Promise.all([
    prisma.event.count({ where: { type: "bounce_hard", createdAt: { gte: since }, message: { campaignId } } }).catch(() => 0),
    prisma.event.count({ where: { type: "bounce_soft", createdAt: { gte: since }, message: { campaignId } } }).catch(() => 0),
    prisma.event.count({ where: { type: "unsubscribe", createdAt: { gte: since }, message: { campaignId } } }).catch(() => 0),
  ]);

  const bounceRate = (hardBounces + softBounces) / Math.max(1, sent);
  const hardRate = hardBounces / Math.max(1, sent);
  const unsubRate = unsubs / Math.max(1, sent);

  const maxHard = Number(camp.guardMaxHardBounceRate ?? 0.05);
  const maxBounce = Number(camp.guardMaxBounceRate ?? 0.08);
  const maxUnsub = Number(camp.guardMaxUnsubRate ?? 0.02);

  const shouldPause = hardRate > maxHard || bounceRate > maxBounce || unsubRate > maxUnsub;
  if (!shouldPause) {
    return { paused: false as const, reason: "ok" as const, sent, hardBounces, softBounces, unsubs, hardRate, bounceRate, unsubRate };
  }

  const payload = {
    at: new Date().toISOString(),
    windowHours,
    sent,
    hardBounces,
    softBounces,
    unsubs,
    hardRate,
    bounceRate,
    unsubRate,
    thresholds: { maxHard, maxBounce, maxUnsub },
  };

  const res = await prisma.campaign
    .updateMany({
      where: { id: campaignId, status: "running" },
      data: { status: "paused", pausedReason: JSON.stringify(payload) },
    })
    .catch(() => null);

  return { paused: Boolean(res && res.count === 1), reason: "threshold" as const, detail: payload };
}
