import "dotenv/config";
import dayjs from "dayjs";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { decrypt } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { startOfLocalDayUtc, warmupTargetForToday } from "@/lib/warmupTime";
import { aiClassifyAndDraftReply, aiExtractMeetingTimeFromReply, aiSuggestAutofix } from "@/lib/ai";
import { signTrackingClick } from "@/lib/tracking";
import { appLogAsync } from "@/lib/app-log";
import { upsertOpenIncident } from "@/lib/aiops";
import { renderTemplate, stripHtml } from "@/lib/template";
import { sendEmail } from "@/lib/mailer";
import { createGoogleMeetEvent } from "@/lib/google-calendar";
import { dispatchWebhooks } from "@/lib/webhooks";
import { classifySmtpError, getRecipientDomain, parseDomainCaps, pickWeightedVariant, maybeAutoPauseCampaign } from "@/lib/deliverability";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as dns from "node:dns/promises";
import { writeTenantFiles } from "@/lib/mailstack";
import { encrypt } from "@/lib/crypto";
import nodemailer from "nodemailer";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function clip(s: string, n: number) {
  if (!s) return s;
  return s.length > n ? s.slice(0, n) : s;
}


// ---------------------------
// Replies AI (auto-triage / auto-reply)
// ---------------------------

type RepliesAiSettings = {
  enabled?: boolean;
  mode?: "suggest" | "autopilot";
  minConfidence?: number;
  bookingLink?: string;
  language?: string;
  closeNegative?: boolean;
  googleCalendar?: {
    enabled?: boolean;
    autoCreate?: boolean;
    minTimeConfidence?: number;
    defaultDurationMin?: number;
    timezone?: string;
  };
};

function getRepliesAiSettings(settingsJson: any): RepliesAiSettings {
  const r = (settingsJson || {}).repliesAi || {};
  return {
    enabled: Boolean(r.enabled),
    mode: (r.mode === "autopilot" ? "autopilot" : "suggest"),
    minConfidence: typeof r.minConfidence === "number" ? r.minConfidence : Number(r.minConfidence || 0.75),
    bookingLink: typeof r.bookingLink === "string" ? r.bookingLink : "",
    language: typeof r.language === "string" ? r.language : "English",
    closeNegative: r.closeNegative !== false,
    googleCalendar: {
      enabled: Boolean(r?.googleCalendar?.enabled),
      autoCreate: Boolean(r?.googleCalendar?.autoCreate),
      minTimeConfidence: typeof r?.googleCalendar?.minTimeConfidence === "number" ? r.googleCalendar.minTimeConfidence : Number(r?.googleCalendar?.minTimeConfidence || 0.8),
      defaultDurationMin: typeof r?.googleCalendar?.defaultDurationMin === "number" ? r.googleCalendar.defaultDurationMin : Number(r?.googleCalendar?.defaultDurationMin || 30),
      timezone: typeof r?.googleCalendar?.timezone === "string" ? r.googleCalendar.timezone : "Asia/Kolkata",
    },
  };
}

async function maybeHandleRepliesAi(args: {
  workspaceId: string;
  workspaceName?: string;
  settingsJson: any;
  mailboxId: string;
  mailboxFromEmail?: string | null;
  campaignName?: string | null;
  leadId: string;
  leadEmail: string;
  leadName?: string | null;
  replyEventId: string;
  inboundSubject?: string | null;
  inboundBodyText: string;
  lastOutboundSubject?: string | null;
  lastOutboundBody?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
}) {
  try {
    if (!env.REPLIES_AI_ENABLED) return;

    const cfg = getRepliesAiSettings(args.settingsJson);
    if (!cfg.enabled) return;

    // Idempotency: if we already processed this reply event, do nothing.
    const existing = await prisma.replyAiAction.findUnique({
      where: { workspaceId_replyEventId: { workspaceId: args.workspaceId, replyEventId: args.replyEventId } },
      select: { id: true, action: true, sentMessageId: true },
    });
    if (existing) return;

    const cls = await aiClassifyAndDraftReply({
      workspaceName: args.workspaceName || "",
      mailboxFrom: args.mailboxFromEmail || "",
      campaignName: args.campaignName || null,
      leadEmail: args.leadEmail,
      leadName: args.leadName || null,
      lastOutboundSubject: args.lastOutboundSubject || null,
      lastOutboundBody: args.lastOutboundBody || null,
      inboundSubject: args.inboundSubject || null,
      inboundBodyText: args.inboundBodyText,
      bookingLink: cfg.bookingLink || null,
      language: cfg.language || "English",
    });

    let draftSubject: string | null = cls.draftSubject || null;
    let draftBodyText: string | null = cls.draftBodyText || null;


    const action = draftBodyText ? "drafted" : "none";
    const aiRow = await prisma.replyAiAction.create({
      data: {
        workspaceId: args.workspaceId,
        leadId: args.leadId,
        replyEventId: args.replyEventId,
        sentiment: cls.sentiment,
        intent: cls.intent,
        confidence: cls.confidence,
        action,
        draftSubject: draftSubject || null,
        draftBodyText: draftBodyText || null,
      },
      select: { id: true },
    });

    // Auto-triage
    const labelsToAdd: string[] = [];
    if (cls.sentiment === "negative") labelsToAdd.push("ai_negative");
    if (cls.sentiment === "positive") labelsToAdd.push("ai_positive");
    if (cls.sentiment === "ooo") labelsToAdd.push("ai_ooo");
    if (cls.sentiment === "unsubscribe") labelsToAdd.push("ai_unsubscribe");

    if (cls.sentiment === "negative" && cfg.closeNegative) {
      const cur = await prisma.replyLeadState.findUnique({ where: { workspaceId_leadId: { workspaceId: args.workspaceId, leadId: args.leadId } } }).catch(() => null as any);
      const curLabels: string[] = Array.isArray((cur as any)?.labels) ? (cur as any).labels.map(String) : [];
      for (const l of labelsToAdd) if (!curLabels.includes(l)) curLabels.push(l);
      await prisma.replyLeadState.upsert({
        where: { workspaceId_leadId: { workspaceId: args.workspaceId, leadId: args.leadId } },
        create: { workspaceId: args.workspaceId, leadId: args.leadId, status: "closed", labels: curLabels as any },
        update: { status: "closed", labels: curLabels as any },
      }).catch(() => {});
      return;
    }

    if (cls.sentiment === "unsubscribe") {
      const cur = await prisma.replyLeadState.findUnique({ where: { workspaceId_leadId: { workspaceId: args.workspaceId, leadId: args.leadId } } }).catch(() => null as any);
      const curLabels: string[] = Array.isArray((cur as any)?.labels) ? (cur as any).labels.map(String) : [];
      for (const l of labelsToAdd) if (!curLabels.includes(l)) curLabels.push(l);
      await prisma.replyLeadState.upsert({
        where: { workspaceId_leadId: { workspaceId: args.workspaceId, leadId: args.leadId } },
        create: { workspaceId: args.workspaceId, leadId: args.leadId, status: "unsubscribe", labels: curLabels as any },
        update: { status: "unsubscribe", labels: curLabels as any },
      }).catch(() => {});
      return;
    }

    if (cls.sentiment !== "positive") {
      // neutral/ooo/spam/unknown → just tag + ignore
      if (labelsToAdd.length) {
        const cur = await prisma.replyLeadState.findUnique({ where: { workspaceId_leadId: { workspaceId: args.workspaceId, leadId: args.leadId } } }).catch(() => null as any);
        const curLabels: string[] = Array.isArray((cur as any)?.labels) ? (cur as any).labels.map(String) : [];
        for (const l of labelsToAdd) if (!curLabels.includes(l)) curLabels.push(l);
        await prisma.replyLeadState.upsert({
          where: { workspaceId_leadId: { workspaceId: args.workspaceId, leadId: args.leadId } },
          create: { workspaceId: args.workspaceId, leadId: args.leadId, status: "open", labels: curLabels as any },
          update: { labels: curLabels as any },
        }).catch(() => {});
      }
      return;
    }

    // Positive → follow-up status (at minimum)
    {
      const cur = await prisma.replyLeadState.findUnique({ where: { workspaceId_leadId: { workspaceId: args.workspaceId, leadId: args.leadId } } }).catch(() => null as any);
      const curLabels: string[] = Array.isArray((cur as any)?.labels) ? (cur as any).labels.map(String) : [];
      for (const l of labelsToAdd) if (!curLabels.includes(l)) curLabels.push(l);
      await prisma.replyLeadState.upsert({
        where: { workspaceId_leadId: { workspaceId: args.workspaceId, leadId: args.leadId } },
        create: { workspaceId: args.workspaceId, leadId: args.leadId, status: "follow_up", labels: curLabels as any },
        update: { status: "follow_up", labels: curLabels as any },
      }).catch(() => {});
    }


    // Optional: auto-schedule a meeting if the reply provides an explicit time.
    // This only runs for positive + meeting_request replies.
    if (cls.intent === "meeting_request" && cfg.googleCalendar?.enabled && cfg.googleCalendar?.autoCreate) {
      try {
        const mt = await aiExtractMeetingTimeFromReply({
          inboundSubject: args.inboundSubject || null,
          inboundBodyText: args.inboundBodyText,
          defaultTimezone: cfg.googleCalendar.timezone || "Asia/Kolkata",
          defaultDurationMin: cfg.googleCalendar.defaultDurationMin || 30,
        });

        const minT = Math.max(0, Math.min(1, Number(cfg.googleCalendar.minTimeConfidence || 0.8)));
        if (mt.hasTime && (mt.confidence || 0) >= minT && mt.startIso && mt.endIso) {
          const ev = await createGoogleMeetEvent({
            workspaceId: args.workspaceId,
            attendeeEmail: args.leadEmail,
            summary: `Meeting with ${args.leadEmail}`,
            description: `Auto-scheduled from inbound reply.

Reply snippet:
${(args.inboundBodyText || "").slice(0, 1200)}`,
            startIso: mt.startIso,
            endIso: mt.endIso,
            timezone: mt.timezone || cfg.googleCalendar.timezone || "Asia/Kolkata",
          });

          const meetLink = ev.meetLink || null;

          // Update draft to reference the invite + meet link (keep concise).
          const when = mt.startIso;
          const tz = mt.timezone || cfg.googleCalendar.timezone || "";
          const body = `Perfect — I’ve sent a calendar invite for ${when}${tz ? " (" + tz + ")" : ""}.` +
            (meetLink ? `

Google Meet: ${meetLink}` : "") +
            `

If you need a different time, just reply with your availability.`;

          draftSubject = draftSubject || (args.inboundSubject ? `Re: ${args.inboundSubject}` : "Re:");
          draftBodyText = body;

          await prisma.replyAiAction.update({
            where: { id: aiRow.id },
            data: {
              scheduledProvider: "google",
              scheduledEventId: ev.eventId || null,
              scheduledMeetLink: meetLink,
              scheduledStart: new Date(mt.startIso),
              scheduledEnd: new Date(mt.endIso),
              scheduledConfidence: mt.confidence,
              draftSubject: draftSubject || null,
              draftBodyText: draftBodyText || null,
              action: draftBodyText ? "drafted" : "none",
            },
          }).catch(() => {});

          // Label
          const cur = await prisma.replyLeadState.findUnique({ where: { workspaceId_leadId: { workspaceId: args.workspaceId, leadId: args.leadId } } }).catch(() => null as any);
          const curLabels: string[] = Array.isArray((cur as any)?.labels) ? (cur as any).labels.map(String) : [];
          if (!curLabels.includes("ai_meeting_scheduled")) curLabels.push("ai_meeting_scheduled");
          await prisma.replyLeadState.upsert({
            where: { workspaceId_leadId: { workspaceId: args.workspaceId, leadId: args.leadId } },
            create: { workspaceId: args.workspaceId, leadId: args.leadId, status: "follow_up", labels: curLabels as any },
            update: { labels: curLabels as any },
          }).catch(() => {});
        }
      } catch (e: any) {
        await appLogAsync({ workspaceId: args.workspaceId, level: "warn", category: "worker", event: "google_meeting_auto_schedule_failed", message: "Google meeting auto-schedule failed", data: { error: String(e?.message || e) } }).catch(() => null);
      }
    }

    // Autopilot send
    // In production, the model may return suggestedAction="needs_human" even for clearly
    // positive replies, while still generating a perfectly usable draft. Autopilot should
    // be driven by the user's mode + confidence threshold + non-negative sentiment.
    const min = Math.max(0, Math.min(1, Number(cfg.minConfidence ?? 0.75)));
    const suggested = (cls as any)?.suggestedAction || "needs_human";
    const blocked = suggested === "ignore" || suggested === "close_thread" || suggested === "mark_unsubscribe";
    const shouldSend =
      cfg.mode === "autopilot" &&
      cls.sentiment === "positive" &&
      !blocked &&
      (cls.confidence || 0) >= min &&
      !!draftBodyText;
    if (!shouldSend) return;

    try {
      const sendRes = await sendEmail({
        mailboxId: args.mailboxId,
        to: args.leadEmail,
        subject: draftSubject || cls.draftSubject || "Re:",
        text: draftBodyText || cls.draftBodyText || "",
        inReplyTo: args.inReplyTo || undefined,
        references: args.references || undefined,
      });

      const now = new Date();
      const msg = await prisma.message.create({
        data: {
          workspaceId: args.workspaceId,
          mailboxId: args.mailboxId,
          leadId: args.leadId,
          subject: draftSubject || cls.draftSubject || "Re:",
          bodyText: draftBodyText || cls.draftBodyText || "",
          bodyHtml: null,
          messageId: sendRes.messageId,
          inReplyTo: args.inReplyTo || undefined,
          status: "sent",
          sentAt: now,
        },
      });

      await prisma.event.create({
        data: {
          messageId: msg.id,
          type: "sent",
          meta: JSON.stringify({ kind: "ai_reply", replyEventId: args.replyEventId, aiActionId: aiRow.id }),
        },
      }).catch(() => {});

      await prisma.replyAiAction.update({ where: { id: aiRow.id }, data: { action: "sent", sentMessageId: msg.id } }).catch(() => {});

      // add label ai_sent
      const cur = await prisma.replyLeadState.findUnique({ where: { workspaceId_leadId: { workspaceId: args.workspaceId, leadId: args.leadId } } }).catch(() => null as any);
      const curLabels: string[] = Array.isArray((cur as any)?.labels) ? (cur as any).labels.map(String) : [];
      if (!curLabels.includes("ai_sent")) curLabels.push("ai_sent");
      await prisma.replyLeadState.upsert({
        where: { workspaceId_leadId: { workspaceId: args.workspaceId, leadId: args.leadId } },
        create: { workspaceId: args.workspaceId, leadId: args.leadId, status: "follow_up", labels: curLabels as any },
        update: { labels: curLabels as any },
      }).catch(() => {});
    } catch (e: any) {
      // if send fails, keep draft saved for humans
      await prisma.replyAiAction.update({ where: { id: aiRow.id }, data: { action: "drafted" } }).catch(() => {});
      await appLogAsync({ workspaceId: args.workspaceId, level: "warn", category: "worker", event: "ai_autopilot_send_failed", message: "AI autopilot send failed", data: { error: String(e?.message || e) } }).catch(() => {});
    }
  } catch (e: any) {
    await appLogAsync({ workspaceId: args.workspaceId, level: "warn", category: "worker", event: "ai_replies_failed", message: "AI replies failed", data: { error: String(e?.message || e) } }).catch(() => {});
  }
}

// ---------------------------
// Domains: DNS health checking
// ---------------------------

function flattenTxt(rr: string[][]): string[] {
  // dns.resolveTxt returns string[][] where each entry is an array of chunks
  const out: string[] = [];
  for (const row of rr || []) {
    out.push((row || []).join(""));
  }
  return out;
}

async function resolveTxt(name: string): Promise<string[]> {
  try {
    const rr = await dns.resolveTxt(name);
    return flattenTxt(rr).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function resolveMx(name: string): Promise<Array<{ exchange: string; priority: number }>> {
  try {
    const rr = await dns.resolveMx(name);
    return (rr || []).map((r) => ({ exchange: String(r.exchange || "").toLowerCase(), priority: Number(r.priority || 0) }));
  } catch {
    return [];
  }
}

async function resolveCname(name: string): Promise<string[]> {
  try {
    const rr = await dns.resolveCname(name);
    return (rr || []).map((s) => String(s || "").toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

async function resolveA(name: string): Promise<string[]> {
  try {
    const rr = await dns.resolve4(name);
    return (rr || []).map((s) => String(s || "")).filter(Boolean);
  } catch {
    return [];
  }
}

function parseTagValue(record: string, key: string): string | null {
  const k = String(key || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = record.match(new RegExp(`${k}\\s*=\\s*([^;\\s]+)`, "i"));
  return m ? String(m[1]).trim() : null;
}

function spfLookupEstimate(spf: string): number {
  const s = (spf || "").trim();
  if (!s.toLowerCase().startsWith("v=spf1")) return 0;
  const parts = s.split(/\s+/).slice(1);
  let lookups = 0;
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    const tt = t.replace(/^([+\-~?])/, "");
    if (tt.startsWith("include:")) lookups += 1;
    if (tt === "a" || tt.startsWith("a:")) lookups += 1;
    if (tt === "mx" || tt.startsWith("mx:")) lookups += 1;
    if (tt === "ptr" || tt.startsWith("ptr:")) lookups += 1;
    if (tt.startsWith("exists:")) lookups += 1;
    if (tt.startsWith("redirect=")) lookups += 1;
  }
  return lookups;
}

function cfHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function cfFindZoneId(token: string, domain: string): Promise<{ zoneId: string | null; zoneName: string | null }> {
  const parts = String(domain || "").toLowerCase().split(".").filter(Boolean);
  // Try exact, then parent zones: a.b.c -> b.c -> c
  for (let i = 0; i < parts.length - 1; i++) {
    const name = parts.slice(i).join(".");
    try {
      const url = `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(name)}&status=active&per_page=50`;
      const j = await fetch(url, { headers: cfHeaders(token) }).then((r) => r.json());
      const z = Array.isArray(j?.result) ? j.result[0] : null;
      if (z?.id) return { zoneId: String(z.id), zoneName: String(z.name || name) };
    } catch {
      // ignore
    }
  }
  return { zoneId: null, zoneName: null };
}

async function cfList(token: string, zoneId: string, type: string, name: string): Promise<any[]> {
  try {
    const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}&per_page=100`;
    const j = await fetch(url, { headers: cfHeaders(token) }).then((r) => r.json());
    return Array.isArray(j?.result) ? j.result : [];
  } catch {
    return [];
  }
}

async function handleDomainDnsCheck(jobId: string, payload: any) {
  const domainId = String(payload?.domainId || "");
  const workspaceId = String(payload?.workspaceId || "");

  if (!domainId) {
    await logJob(jobId, "❌ MISSING domainId");
    return;
  }

  const d = await prisma.domain.findUnique({ where: { id: domainId } });
  if (!d) {
    await logJob(jobId, "❌ DOMAIN_NOT_FOUND");
    return;
  }
  if (workspaceId && String(d.workspaceId) !== workspaceId) {
    await logJob(jobId, "❌ WORKSPACE_MISMATCH");
    return;
  }

  const checkedAt = new Date();
  const domain = String(d.name || "").toLowerCase();
  const selectorRaw = String(d.dkimSelector || "").trim();
  // Mailstack uses selector "default"; older UI stored "cm".
  const selectorPreferred = selectorRaw && selectorRaw.toLowerCase() !== "cm" ? selectorRaw : "default";
  const selectorCandidates = Array.from(
    new Set([selectorPreferred, selectorRaw, "default"].filter(Boolean).map((x) => String(x).trim()))
  );
  const expectedDkimP = String(d.dkimPublic || "").replaceAll(/\s+/g, "").trim();
  const tracking = d.trackingSubdomain ? String(d.trackingSubdomain).toLowerCase() : null;

  // Optional expectations from Mailstack
  const p: any = prisma as any;
  const hasMailstackModels = !!p.mailstackTenantDomain && !!p.mailstackConfig;

  const tenantDomain = hasMailstackModels
    ? await p.mailstackTenantDomain.findFirst({
        where: { domainName: domain, tenant: { workspaceId: d.workspaceId } },
        include: { tenant: true },
      })
    : null;

  const cfg = hasMailstackModels ? await p.mailstackConfig.findUnique({ where: { workspaceId: d.workspaceId } }) : null;

  const mailHost = `mail.${domain}`;
  const expectedServerIp = (tenantDomain?.tenant?.serverIp || cfg?.serverIp || "").toString().trim();

  // DNS: SPF
  const txtRoot = await resolveTxt(domain);
  const spf = txtRoot.find((x) => x.toLowerCase().startsWith("v=spf1")) || null;
  const spfLookups = spf ? spfLookupEstimate(spf) : 0;
  const spfAll = spf ? (spf.match(/\s([\-~?]all)\b/i)?.[1] || "") : "";
  const spfOk = !!spf;

  // DNS: DKIM
  const dkimName = `${selectorPreferred}._domainkey.${domain}`;
  const txtDkimAll = (await Promise.all(selectorCandidates.map((sel) => resolveTxt(`${sel}._domainkey.${domain}`)))).flat();
  const dkimRec = txtDkimAll.find((x) => x.toLowerCase().includes("v=dkim1")) || (txtDkimAll[0] || null);
  const dkimP = dkimRec ? (parseTagValue(dkimRec, "p") || "") : "";
  const dkimOk = !!(dkimRec && dkimRec.toLowerCase().includes("v=dkim1") && dkimP);
  const dkimMatch = dkimOk && expectedDkimP ? dkimP.replaceAll(/\s+/g, "") === expectedDkimP : dkimOk;

  // DNS: DMARC
  const dmarcName = `_dmarc.${domain}`;
  const txtDmarc = await resolveTxt(dmarcName);
  const dmarcRec = txtDmarc.find((x) => x.toLowerCase().startsWith("v=dmarc1")) || (txtDmarc[0] || null);
  const dmarcPolicy = dmarcRec ? (parseTagValue(dmarcRec, "p") || "") : "";
  const dmarcOk = !!(dmarcRec && dmarcRec.toLowerCase().startsWith("v=dmarc1") && dmarcPolicy);

  // DNS: MX
  const mx = await resolveMx(domain);
  const mxOk = mx.length > 0;
  const mxHasMail = mx.some((m) => m.exchange.replace(/\.$/, "") === mailHost);

  // DNS: mail.<domain> A (optional expectation)
  const mailA = await resolveA(mailHost);
  const mailAOk = mailA.length > 0;
  const mailIpMatch = expectedServerIp ? mailA.includes(expectedServerIp) : null;

  // DNS: tracking CNAME
  const trackingCname = tracking ? await resolveCname(tracking) : [];
  const appHost = (() => {
    try {
      return new URL(env.PUBLIC_APP_URL).host.toLowerCase();
    } catch {
      return "";
    }
  })();
  const trackingOk = tracking ? trackingCname.some((c) => c.replace(/\.$/, "") === appHost) : null;

  // Cloudflare view (optional)
  let cf: any = { enabled: false, zoneFound: false, zoneName: null, records: {} };
  let token = "";
  try {
    if (cfg?.cloudflareTokenEnc) {
      token = decrypt(cfg.cloudflareTokenEnc).trim();
    }
  } catch {}

  if (token) {
    cf.enabled = true;
    const { zoneId, zoneName } = await cfFindZoneId(token, domain);
    cf.zoneName = zoneName;
    if (zoneId) {
      cf.zoneFound = true;
      const [cfTxtRoot, cfDkim, cfDmarc, cfMx, cfMailA, cfTracking] = await Promise.all([
        cfList(token, zoneId, "TXT", domain),
        cfList(token, zoneId, "TXT", dkimName),
        cfList(token, zoneId, "TXT", dmarcName),
        cfList(token, zoneId, "MX", domain),
        cfList(token, zoneId, "A", mailHost),
        tracking ? cfList(token, zoneId, "CNAME", tracking) : Promise.resolve([]),
      ]);
      cf.records = {
        txtRoot: cfTxtRoot,
        dkim: cfDkim,
        dmarc: cfDmarc,
        mx: cfMx,
        mailA: cfMailA,
        tracking: cfTracking,
      };
    }
  }

  const issues: string[] = [];
  if (!spfOk) issues.push("Missing SPF (v=spf1) TXT record at root");
  if (spfOk && spfLookups > 10) issues.push(`SPF has too many DNS lookups (estimated ${spfLookups}/10)`);
  if (spfOk && spfAll && spfAll.toLowerCase() !== "-all") issues.push(`SPF ends with ${spfAll} (recommended: -all for strict senders)`);

  if (!dkimOk) issues.push(`Missing DKIM TXT at ${dkimName}`);
  if (dkimOk && !dkimMatch) issues.push("DKIM public key does not match the key generated in app (wrong selector or old record)");

  if (!dmarcOk) issues.push(`Missing DMARC TXT at ${dmarcName}`);
  if (dmarcOk && String(dmarcPolicy).toLowerCase() === "none") issues.push("DMARC policy is p=none (ok for testing, but weaker trust)");

  if (!mxOk) issues.push("Missing MX records (inbound mail may not work)");
  if (tenantDomain && mxOk && !mxHasMail) issues.push(`MX does not point to ${mailHost} (Mailstack expected)`);

  if (expectedServerIp && mailAOk && mailIpMatch === false) issues.push(`mail.${domain} A record does not match configured server IP (${expectedServerIp})`);
  if (expectedServerIp && !mailAOk) issues.push(`Missing A record for ${mailHost} (Mailstack expected)`);

  if (tracking && trackingOk === false) issues.push(`Tracking CNAME should point to ${appHost}`);
  if (tracking && trackingCname.length === 0) issues.push("Tracking CNAME record missing");

  // Score
  let score = 0;
  if (spfOk) score += 25;
  if (dkimOk && dkimMatch) score += 30;
  if (dmarcOk) score += 20;
  if (mxOk) score += 10;
  if (!expectedServerIp || (mailAOk && mailIpMatch !== false)) score += 10;
  if (!tracking || trackingOk) score += 5;
  score = Math.max(0, Math.min(100, score));

  let status: "unknown" | "healthy" | "warning" | "fail" = "healthy";
  if (!spfOk || !dkimOk || !dkimMatch) status = "fail";
  else if (issues.length) status = "warning";

  const result: any = {
    kind: "domain_dns_check",
    domainId,
    domain,
    checkedAt: checkedAt.toISOString(),
    summary: {
      status,
      score,
      issues,
    },
    records: {
      spf: {
        ok: spfOk,
        value: spf,
        lookups: spfLookups,
        all: spfAll,
        detail: spfOk ? `found (${spfAll || "no all"}, lookups~${spfLookups})` : "missing",
      },
      dkim: {
        ok: dkimOk && dkimMatch,
        selector: selectorPreferred,
        name: dkimName,
        value: dkimRec,
        matchesAppKey: dkimMatch,
        detail: dkimOk ? (dkimMatch ? "found (matches app key)" : "found (mismatch)") : "missing",
      },
      dmarc: {
        ok: dmarcOk,
        name: dmarcName,
        policy: dmarcPolicy,
        value: dmarcRec,
        detail: dmarcOk ? `found (p=${dmarcPolicy})` : "missing",
      },
      mx: {
        ok: mxOk && (!tenantDomain || mxHasMail),
        records: mx,
        expected: tenantDomain ? mailHost : null,
        detail: mxOk ? (tenantDomain ? (mxHasMail ? `ok (points to ${mailHost})` : `not pointing to ${mailHost}`) : `found (${mx.length})`) : "missing",
      },
      mailA: {
        ok: expectedServerIp ? (mailAOk && mailIpMatch !== false) : mailAOk,
        name: mailHost,
        ips: mailA,
        expectedIp: expectedServerIp || null,
      },
      tracking: tracking
        ? {
            ok: trackingOk === true,
            name: tracking,
            cnames: trackingCname,
            expectedHost: appHost,
          }
        : null,
    },
    cloudflare: cf,
  };

  await prisma.job.update({ where: { id: jobId }, data: { lastError: JSON.stringify(result) } }).catch(() => {});
  await logJob(jobId, `✅ DNS check complete for ${domain} (${status}, score ${score})`);
  if (issues.length) {
    await logJob(jobId, `⚠ Issues: ${clip(issues.join(" | "), 500)}`);
  }
}

async function handleMailboxHealthcheck(jobId: string, payload: any) {
  const mailboxId = String(payload?.mailboxId || "");
  const force = Boolean(payload?.force);
  const workspaceId = String(payload?.workspaceId || "");
  const mode = String(payload?.mode || "both"); // smtp|imap|both

  if (!mailboxId) {
    await logJob(jobId, "❌ MISSING mailboxId");
    return;
  }

  const mb = await prisma.mailbox.findUnique({ where: { id: mailboxId } });
  if (!mb) {
    await logJob(jobId, "❌ MAILBOX_NOT_FOUND");
    return;
  }
  if (workspaceId && String(mb.workspaceId) !== workspaceId) {
    await logJob(jobId, "❌ WORKSPACE_MISMATCH");
    return;
  }

  const checkedAt = new Date();
  const result: any = {
    kind: "mailbox_healthcheck",
    mailboxId,
    checkedAt: checkedAt.toISOString(),
    smtp: null,
    imap: null,
  };

  // SMTP
  if (mode === "smtp" || mode === "both") {
    const started = Date.now();
    try {
      const pass = decrypt(mb.smtpPassEnc);
      const smtpTlsSkipVerify = Boolean(env.SMTP_TLS_SKIP_VERIFY || mb.imapTlsSkipVerify);
      const transporter = nodemailer.createTransport({
        host: mb.smtpHost,
        port: mb.smtpPort,
        secure: mb.smtpSecure,
        auth: { user: mb.smtpUser, pass },
        tls: {
          servername: mb.smtpHost,
          rejectUnauthorized: !smtpTlsSkipVerify,
        },
        localAddress: mb.localAddress || env.DEFAULT_SMTP_LOCAL_ADDRESS || undefined,
        connectionTimeout: 25_000,
        greetingTimeout: 20_000,
        socketTimeout: 45_000,
      });

      await transporter.verify();
      const ms = Date.now() - started;
      result.smtp = { ok: true, ms };
      await logJob(jobId, `✅ SMTP OK (${ms}ms) ${mb.smtpHost}:${mb.smtpPort}`);
    } catch (e: any) {
      const ms = Date.now() - started;
      const msg = clip(String(e?.message || e), 200);
      result.smtp = { ok: false, ms, error: msg };
      await logJob(jobId, `❌ SMTP FAIL (${ms}ms): ${msg}`);
    }
  }

  // IMAP
  if (mode === "imap" || mode === "both") {
    if (!mb.imapHost || !mb.imapUser || !mb.imapPassEnc) {
      result.imap = { ok: true, skipped: true };
      await logJob(jobId, "ℹ️  IMAP skipped (not configured)");
    } else {
      const started = Date.now();
      let client: any = null;
      try {
        const pass = decrypt(mb.imapPassEnc);
        client = new ImapFlow({
          host: mb.imapHost,
          port: mb.imapPort,
          secure: !!mb.imapSecure,
          auth: { user: mb.imapUser, pass },
          tls: { rejectUnauthorized: !mb.imapTlsSkipVerify },
          logger: false,
          socketTimeout: 25_000,
          greetingTimeout: 20_000,
          authTimeout: 25_000,
        } as any);

        await client.connect();
        await client.logout().catch(() => {});
        const ms = Date.now() - started;
        result.imap = { ok: true, ms };
        await logJob(jobId, `✅ IMAP OK (${ms}ms) ${mb.imapHost}:${mb.imapPort}`);
      } catch (e: any) {
        const ms = Date.now() - started;
        const msg = clip(String(e?.message || e), 200);
        result.imap = { ok: false, ms, error: msg };
        await logJob(jobId, `❌ IMAP FAIL (${ms}ms): ${msg}`);
        try {
          await client?.logout?.();
        } catch {}
      }
    }
  }

  // Store structured result in job.lastError for the UI (no schema changes)
  try {
    await prisma.job.update({ where: { id: jobId }, data: { lastError: JSON.stringify(result) } });
  } catch {}
}

async function handleMailboxTestSend(jobId: string, payload: any) {
  const mailboxId = String(payload?.mailboxId || "");
  const workspaceId = String(payload?.workspaceId || "");
  const to = String(payload?.to || "").trim();
  const subject = String(payload?.subject || "Test email").trim();
  const text = String(payload?.text || "").trim();
  const messageRowId = String(payload?.messageRowId || "");

  const started = Date.now();
  const result: any = {
    kind: "mailbox_test_send",
    mailboxId,
    to,
    at: new Date().toISOString(),
    ok: false,
    ms: 0,
    error: null,
    messageId: null,
    messageRowId: messageRowId || null,
  };

  try {
    if (!mailboxId) throw new Error("MISSING_MAILBOX");
    if (!to || !to.includes("@")) throw new Error("INVALID_TO");

    const mb = await prisma.mailbox.findUnique({ where: { id: mailboxId } });
    if (!mb) throw new Error("MAILBOX_NOT_FOUND");
    if (workspaceId && String(mb.workspaceId) !== workspaceId) throw new Error("WORKSPACE_MISMATCH");

    // Ensure message row exists
    let msgRow = null as any;
    if (messageRowId) {
      msgRow = await prisma.message.findFirst({ where: { id: messageRowId, mailboxId, workspaceId: mb.workspaceId } });
    }

    // Send
    const res = await sendEmail({
      mailboxId,
      to,
      subject: subject || "Test email",
      text: text || "This is a test email from ColdMailPro.",
      log: (msg, meta) => warmupLog(jobId, msg, meta),
      headers: {
        "X-ColdMailPro-Test": "1",
        ...(msgRow ? { "X-ColdMailPro-Message": msgRow.id } : {}),
      },
    });

    result.ok = true;
    result.messageId = res.messageId || null;
    result.ms = Date.now() - started;
    await logJob(jobId, `✅ TEST SENT (${result.ms}ms) to ${to} (${res.messageId || ""})`);

    if (msgRow) {
      await prisma.message
        .update({
          where: { id: msgRow.id },
          data: { status: "sent", sentAt: new Date(), messageId: res.messageId || null, error: null },
        })
        .catch(() => {});
      await prisma.event
        .create({ data: { messageId: msgRow.id, type: "sent", meta: JSON.stringify({ to, kind: "test" }) } })
        .catch(() => {});
    }
  } catch (e: any) {
    const msg = clip(String(e?.message || e), 220);
    result.ok = false;
    result.error = msg;
    result.ms = Date.now() - started;
    await logJob(jobId, `❌ TEST FAILED (${result.ms}ms): ${msg}`);
    if (messageRowId) {
      await prisma.message.updateMany({ where: { id: messageRowId }, data: { status: "failed", error: msg } }).catch(() => {});
    }
  }

  try {
    await prisma.job.update({ where: { id: jobId }, data: { lastError: JSON.stringify(result) } });
  } catch {}
}


async function logJob(jobId: string, line: string) {
  console.log(`[job ${jobId}]`, line);

  void appLogAsync({ level: "info", category: "worker", event: "job_log", message: line, entityType: "job", entityId: jobId });
  try {
    await prisma.jobLog.create({ data: { jobId, line } });
  } catch {
    // ignore if table not created yet
  }
}


async function updateJobSafe(jobId: string, data: any, label = "job update") {
  let lastErr: any = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      await prisma.job.update({ where: { id: jobId }, data });
      return true;
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || e);
      console.warn(`[job ${jobId}] ${label} failed on attempt ${attempt}: ${msg}`);
      // Package updates can restart MySQL/MariaDB underneath Prisma. Reconnect and retry instead of
      // turning a successful maintenance run into a false failed job.
      try { await prisma.$disconnect(); } catch {}
      await sleep(Math.min(15000, attempt * 1500));
      try { await prisma.$connect(); } catch {}
    }
  }
  console.error(`[job ${jobId}] ${label} failed after reconnect retries: ${String(lastErr?.message || lastErr)}`);
  return false;
}

async function runCmd(
  jobId: string,
  cmd: string,
  args: string[],
  opts?: { cwd?: string; logArgs?: string[]; env?: Record<string, string | undefined> }
) {
  const la = Array.isArray(opts?.logArgs) ? (opts as any).logArgs : args;
  await logJob(jobId, `$ ${cmd} ${la.join(" ")}`);
  return await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: opts?.cwd,
      env: { ...process.env, ...(opts?.env || {}) } as any,
    });
    child.stdout.on("data", (d) => logJob(jobId, String(d).trimEnd()));
    child.stderr.on("data", (d) => logJob(jobId, String(d).trimEnd()));
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

function sudoWrap(cmd: string): string[] {
  // If worker runs as root, you can set PROVISION_USE_SUDO=0.
  const useSudo = String(process.env.PROVISION_USE_SUDO || "1") === "1";
  if (!useSudo) return [cmd];
  // Preserve only the env vars we explicitly inject for provisioning (Cloudflare per-workspace support).
  // This avoids depending on sudoers env_keep configuration.
  return ["sudo", "-n", "--preserve-env=CF_API_TOKEN,CF_ENV_PATH,MAILSTACK_ACME_EMAIL", cmd];
}

// --------------------
// AutoFix (safe auto-apply, risky suggest-only)
// --------------------
type AutoFixPlan = { kind: "safe" | "risky"; summary: string; commands: string[] };

function matchSafeAutofix(jobType: string, err: string): AutoFixPlan | null {
  const e = String(err || "");
  // Dovecot Maildir blocked by SELinux labels
  if ((/ACL\/MAC wrong/i.test(e) || /SELinux/i.test(e) || /opendir\(.+Maildir\) failed: Permission denied/i.test(e)) && /\/var\/vmail\//.test(e)) {
    return {
      kind: "safe",
      summary: "Fix SELinux labels/permissions for /var/vmail Maildir and restart dovecot",
      commands: [
        `dnf -y install policycoreutils-python-utils || true`,
        `semanage fcontext -a -t mail_spool_t "/var/vmail(/.*)?" || true`,
        `restorecon -Rv /var/vmail || true`,
        `chown -R vmail:vmail /var/vmail || true`,
        `systemctl restart dovecot || true`,
      ],
    };
  }

  // Exim map/perms/SELinux issues
  if (/\/etc\/exim\/maps/i.test(e) && /Permission denied|denied/i.test(e)) {
    return {
      kind: "safe",
      summary: "Fix /etc/exim/maps perms + SELinux contexts and restart exim",
      commands: [
        `mkdir -p /etc/exim/maps || true`,
        `chown -R root:root /etc/exim/maps || true`,
        `chmod 755 /etc/exim/maps || true`,
        `chmod 644 /etc/exim/maps/*.map /etc/exim/maps/*.list 2>/dev/null || true`,
        `restorecon -Rv /etc/exim /etc/exim/maps || true`,
        `systemctl restart exim || true`,
      ],
    };
  }

  // Exim DB lookup blocked under SELinux (common: "condition check lookup defer")
  if (/condition check lookup defer/i.test(e) || /searchtype mysql not initially found/i.test(e)) {
    return {
      kind: "safe",
      summary: "Ensure Exim can connect to DB under SELinux and restart exim",
      commands: [
        `setsebool -P exim_can_connect_db on || true`,
        `restorecon -Rv /etc/exim /etc/exim/maps || true`,
        `systemctl restart exim || true`,
      ],
    };
  }

  return null;
}

async function applySafeAutofix(jobId: string, plan: AutoFixPlan): Promise<void> {
  const [runner, ...prefixArgs] = sudoWrap("bash");
  for (const c of plan.commands) {
    await runCmd(jobId, runner, [...prefixArgs, "-lc", c], { cwd: "/root" });
  }
}

async function maybeAutofixAndRetry(job: any, payload: any, err: any): Promise<boolean> {
  if (!env.AUTOFIX_ENABLED || !env.AUTOFIX_AUTO_APPLY_SAFE) return false;
  const attempts = Number(job?.attempts || 0);
  if (attempts >= env.AUTOFIX_MAX_SAFE_ATTEMPTS_PER_JOB) return false;

  const plan = matchSafeAutofix(String(job.type), String(err?.message || err));
  if (!plan) return false;

  await logJob(job.id, `🔧 AutoFix (safe): ${plan.summary}`);
  try {
    await applySafeAutofix(job.id, plan);
    await logJob(job.id, `✅ AutoFix applied. Retrying job once...`);
    return true;
  } catch (e: any) {
    await logJob(job.id, `⚠️  AutoFix failed: ${String(e?.message || e)}`);
    return false;
  }
}

async function maybeLogRiskySuggestion(job: any, payload: any, err: any) {
  if (!env.AUTOFIX_ENABLED || !env.AUTOFIX_AI_SUGGESTIONS) return;
  const suggestion = await aiSuggestAutofix({
    jobType: String(job.type),
    error: String(err?.message || err),
    context: (() => {
      try { return JSON.stringify({ jobType: job.type, payload }, null, 2).slice(0, 6000); } catch { return undefined; }
    })(),
  });
  if (!suggestion) return;
  // Never auto-apply AI suggestions unless matched by our safe signatures.
  await logJob(job.id, `🧠 AutoFix suggestion (${suggestion.risk}): ${suggestion.summary}`);
  for (const a of suggestion.suggestedActions || []) {
    await logJob(job.id, `   • ${a}`);
  }
}

function shQuote(s: string): string {
  // Safe single-quote for bash -lc
  return `'${String(s).replace(/'/g, `'"'"'`)}'`;
}

async function ensureEximDkimMaps(jobId: string, domain: string, selector: string) {
  const dom = String(domain || "").trim().toLowerCase().replace(/\.$/, "");
  const sel = (String(selector || "").trim() || "default").toLowerCase();
  if (!dom) return;

  const script = `
set -e
dom=${shQuote(dom)}
sel=${shQuote(sel)}
key="/etc/exim/dkim/${dom}/${sel}.private"
if [ ! -f "$key" ]; then
  key="/etc/exim/dkim/${dom}/default.private"
  sel="default"
fi
if [ ! -f "$key" ]; then
  echo "⚠️  DKIM key file not found for ${dom} (skip Exim map upsert)"
  exit 0
fi
map_key="/etc/exim/maps/domain-dkim-key.map"
map_sel="/etc/exim/maps/domain-dkim-selector.map"
mkdir -p /etc/exim/maps
touch "$map_key" "$map_sel"
chmod 644 "$map_key" "$map_sel" || true

upsert(){
  local file="$1" d="$2" v="$3"
  awk -F: -v d="$d" -v v="$v" 'BEGIN{done=0}{ if(tolower($1)==tolower(d)){ print d ":" v; done=1; next } if (NF>0) print } END{ if (!done) print d ":" v }' "$file" > "\${file}.tmp" && mv -f "\${file}.tmp" "$file"
}

upsert "$map_key" "$dom" "$key"
upsert "$map_sel" "$dom" "$sel"

if getent group exim >/dev/null 2>&1; then
  chown root:exim "$map_key" "$map_sel" 2>/dev/null || true
fi

systemctl reload exim >/dev/null 2>&1 || systemctl restart exim >/dev/null 2>&1 || true
echo "✅ Ensured Exim DKIM maps for ${dom} (selector=${sel})"
`;

  const [cmd, ...baseArgs] = sudoWrap("bash");
  await runCmd(jobId, cmd, [...baseArgs, "-lc", script], { cwd: "/root" });
}

async function cloudflareDeleteMailstackRecords(
  jobId: string,
  token: string,
  domain: string
) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  } as const;

  const zoneRes = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(domain)}`, {
    headers,
  }).then((r) => r.json());

  const zone = zoneRes?.result?.[0];
  if (!zone?.id) {
    await logJob(jobId, `⚠️  Cloudflare zone not found for ${domain}`);
    return;
  }

  const zoneId = String(zone.id);

  async function delByName(type: string, name: string, contentIncludes?: string) {
    const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=${encodeURIComponent(
      type
    )}&name=${encodeURIComponent(name)}`;
    const list = await fetch(url, { headers }).then((r) => r.json());
    const records = Array.isArray(list?.result) ? list.result : [];
    const filtered = contentIncludes
      ? records.filter((x: any) => String(x?.content || "").includes(contentIncludes))
      : records;

    for (const rec of filtered) {
      const rid = rec?.id;
      if (!rid) continue;
      await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${rid}`, {
        method: "DELETE",
        headers,
      }).then((r) => r.json());
      await logJob(jobId, `✅ Cloudflare deleted ${type} ${name}`);
    }
  }

  // Records created by mailstack-addon.sh
  await delByName("A", `mail.${domain}`);
  await delByName("MX", domain, `mail.${domain}`);
  // SPF TXT at root: only delete TXT that looks like SPF
  await delByName("TXT", domain, "v=spf1");
  // DKIM TXT: script uses default._domainkey.<domain>, but also try cm._domainkey for safety
  await delByName("TXT", `default._domainkey.${domain}`, "v=DKIM1");
  await delByName("TXT", `cm._domainkey.${domain}`, "v=DKIM1");
  // DMARC
  await delByName("TXT", `_dmarc.${domain}`, "v=DMARC1");
}

async function handleMailstackJob(jobId: string, type: string, payload: any) {
  const resolveMaybeRelative = (p: string) => (p && !p.startsWith("/") ? path.resolve(process.cwd(), p) : p);
  const projectMailstack = path.resolve(process.cwd(), "scripts/mailstack.sh");
  const projectAddon = path.resolve(process.cwd(), "scripts/mailstack-addon.sh");

  const mailstack = resolveMaybeRelative(env.MAILSTACK_SCRIPT || process.env.MAILSTACK_SCRIPT || (fs.existsSync(projectMailstack) ? projectMailstack : "/root/mailstack.sh"));
  const addon = resolveMaybeRelative(env.MAILSTACK_ADDON_SCRIPT || process.env.MAILSTACK_ADDON_SCRIPT || (fs.existsSync(projectAddon) ? projectAddon : "/root/mailstack-addon.sh"));

  // Per-workspace Cloudflare token support
  const cfEnvPathForWorkspace = (workspaceId: string) => path.join("/etc/mailstack/workspaces", String(workspaceId || "default"), "cloudflare.env");
  async function getWorkspaceMailstackEnv(workspaceId: string): Promise<Record<string, string>> {
    const wid = String(workspaceId || "");
    const out: Record<string, string> = { CF_ENV_PATH: cfEnvPathForWorkspace(wid) };
    try {
      const cfg = await prisma.mailstackConfig.findUnique({ where: { workspaceId: wid } });
      if (cfg?.cloudflareTokenEnc) {
        const token = decrypt(cfg.cloudflareTokenEnc).trim();
        if (token) out.CF_API_TOKEN = token;
      }
    } catch {
      // ignore
    }
    const acmeEmail = (env as any).MAILSTACK_ACME_EMAIL || process.env.MAILSTACK_ACME_EMAIL || "sales@bullten.com";
    out.MAILSTACK_ACME_EMAIL = String(acmeEmail);
    return out;
  }

  if (type === "mailstack:system-update") {
    const mode = String(payload?.mode || "server").trim().toLowerCase();
    const roundcubeChannel = String(payload?.roundcubeChannel || "stable").trim().toLowerCase();
    const roundcubeVersion = String(payload?.roundcubeVersion || "").trim();
    const [runner, ...prefixArgs] = sudoWrap(addon);
    const roundcubeArgs = [
      ...prefixArgs,
      "roundcube-update",
      "--channel",
      roundcubeChannel === "package" || roundcubeChannel === "custom" ? roundcubeChannel : "stable",
      ...(roundcubeChannel === "custom" && roundcubeVersion ? ["--version", roundcubeVersion] : []),
    ];

    if (mode === "roundcube") {
      await runCmd(jobId, runner, roundcubeArgs, { cwd: "/root" });
      await logJob(jobId, "✅ Roundcube update job completed");
      return;
    }

    if (mode === "both") {
      await runCmd(jobId, runner, [...prefixArgs, "server-update"], { cwd: "/root" });
      await runCmd(jobId, runner, roundcubeArgs, { cwd: "/root" });
      await logJob(jobId, "✅ Server + Roundcube update job completed");
      return;
    }

    await runCmd(jobId, runner, [...prefixArgs, "server-update"], { cwd: "/root" });
    await logJob(jobId, "✅ Server software update job completed");
    return;
  }

  if (type === "mailstack:init-cloudflare") {
    const workspaceId = String(payload.workspaceId || "");
    const cfg = await prisma.mailstackConfig.findUnique({ where: { workspaceId } });
    if (!cfg?.cloudflareTokenEnc) throw new Error("Cloudflare token not set in Mailstack settings");
    const token = decrypt(cfg.cloudflareTokenEnc).trim();
    if (!token) throw new Error("Cloudflare token decrypt failed");

    // Used by acme.sh when registering an ACME account (must be a real email with a dot-domain)
    const acmeEmail = (env as any).MAILSTACK_ACME_EMAIL || process.env.MAILSTACK_ACME_EMAIL || "sales@bullten.com";

    const wsEnv = await getWorkspaceMailstackEnv(workspaceId);
    // Ensure the token is always passed for this run (even if helper decrypt fails for any reason)
    wsEnv.CF_API_TOKEN = token;

    const [runner, ...prefixArgs] = sudoWrap(addon);
    const args = [...prefixArgs, "init-cloudflare", token, String(acmeEmail)];
    const logArgs = [...prefixArgs, "init-cloudflare", "<redacted>", String(acmeEmail)];
    await runCmd(jobId, runner, args, { cwd: "/root", logArgs, env: wsEnv });
    await logJob(jobId, "✅ Cloudflare initialized");
    return;
  }

  const tenantId = String(payload.tenantId || "");
  const t = await prisma.mailstackTenant.findUnique({
    where: { id: tenantId },
    include: { domains: true, ips: true, users: true, mailboxes: true, workspace: true },
  });
  if (!t) throw new Error("Tenant not found");

  // Load per-workspace Cloudflare token/env for all provisioning commands.
  const wsEnv = await getWorkspaceMailstackEnv(t.workspaceId);

  const domains = t.domains.map((d) => d.domainName);
  const ips = t.ips.map((i) => i.ip);
  const users = t.users.map((u) => u.email);

  if (type === "mailstack:dkim-rotate") {
    const domainName = String((payload as any)?.domainName || (payload as any)?.domain || "")
      .trim()
      .toLowerCase()
      .replace(/\.$/, "");
    if (!domainName) throw new Error("domainName missing");

    const [runner, ...prefixArgs] = sudoWrap(addon);
    await runCmd(jobId, runner, [...prefixArgs, "dkim-rotate", "--tenant", t.name, "--domain", domainName], { cwd: "/root", env: wsEnv });

    // Sync the new DKIM public key (p=...) into Domain table so UI shows the exact server key.
    try {
      const dnsFile = path.join("/etc/mailstack/tenants", t.name, "dns-records.txt");
      const selFile = path.join("/etc/mailstack/tenants", t.name, "dkim-selector.map");
      let activeSel = "default";
      if (fs.existsSync(selFile)) {
        const selRaw = fs.readFileSync(selFile, "utf8");
        const m = selRaw
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .find((l) => l.split(":")[0]?.trim().toLowerCase() === domainName.toLowerCase());
        const maybe = (m?.split(":")[1] || "").trim();
        if (maybe) activeSel = maybe;
      }

      // Safety net: ensure Exim DKIM maps exist for this domain+selector on the server.
      await ensureEximDkimMaps(jobId, domainName, activeSel);
      if (fs.existsSync(dnsFile)) {
        const dnsRaw = fs.readFileSync(dnsFile, "utf8");
        const lines = dnsRaw
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        const needle = `${activeSel}._domainkey.${domainName}`.toLowerCase();
        const line = lines.find((l) => l.toLowerCase().includes(needle) && l.toLowerCase().includes("p="));
        if (line) {
          const pm = line.match(/\bp=([^;,\s\"]+)/i);
          const p = (pm?.[1] || "").replace(/\s+/g, "").trim();
          if (p) {
            await prisma.domain.updateMany({
              where: { workspaceId: t.workspaceId, name: domainName },
              data: { dkimSelector: activeSel, dkimPublic: p },
            });
            await logJob(jobId, `✅ Synced DKIM public key into app DB for ${domainName}`);
          }
        }
      }
    } catch {
      await logJob(jobId, `⚠️  Could not sync DKIM key into app DB for ${domainName} (continuing)`);
    }

    await logJob(jobId, `✅ DKIM rotated for ${domainName} (tenant=${t.name}). Refresh the domain page to view updated TXT.`);
    return;
  }

  if (type === "mailstack:dkim-stage") {
    const domainName = String((payload as any)?.domainName || (payload as any)?.domain || "")
      .trim()
      .toLowerCase()
      .replace(/\.$/, "");
    if (!domainName) throw new Error("domainName missing");

    const [runner, ...prefixArgs] = sudoWrap(addon);
    await runCmd(jobId, runner, [...prefixArgs, "dkim-stage", "--tenant", t.name, "--domain", domainName], { cwd: "/root", env: wsEnv });

    try {
      const dnsFile = path.join("/etc/mailstack/tenants", t.name, "dns-records.txt");
      const pendingFile = path.join("/etc/mailstack/tenants", t.name, "dkim-pending.map");
      if (fs.existsSync(dnsFile) && fs.existsSync(pendingFile)) {
        const pendingRaw = fs.readFileSync(pendingFile, "utf8");
        const pm = pendingRaw
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .find((l) => l.split(":")[0]?.trim().toLowerCase() === domainName.toLowerCase());
        const pendingSel = (pm?.split(":")[1] || "").trim();
        if (pendingSel) {
          const dnsRaw = fs.readFileSync(dnsFile, "utf8");
          const lines = dnsRaw
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
          const needle = `${pendingSel}._domainkey.${domainName}`.toLowerCase();
          const line = lines.find((l) => l.toLowerCase().includes(needle) && l.toLowerCase().includes("p="));
          const p = (line?.match(/\bp=([^;,\s\"]+)/i)?.[1] || "").replace(/\s+/g, "").trim();
          await prisma.domain.updateMany({
            where: { workspaceId: t.workspaceId, name: domainName },
            data: {
              pendingDkimSelector: pendingSel,
              pendingDkimPublic: p || null,
              pendingDkimCreatedAt: new Date(),
            },
          });
          await logJob(jobId, `✅ DKIM staged in app DB for ${domainName} (pending selector: ${pendingSel})`);
        }
      }
    } catch {
      await logJob(jobId, `⚠️  Could not sync staged DKIM into app DB for ${domainName} (continuing)`);
    }

    await logJob(jobId, `✅ DKIM staged for ${domainName} (tenant=${t.name}). Wait for DNS propagation, then activate.`);
    return;
  }

  if (type === "mailstack:dkim-activate") {
    const domainName = String((payload as any)?.domainName || (payload as any)?.domain || "")
      .trim()
      .toLowerCase()
      .replace(/\.$/, "");
    if (!domainName) throw new Error("domainName missing");

    const [runner, ...prefixArgs] = sudoWrap(addon);
    await runCmd(jobId, runner, [...prefixArgs, "dkim-activate", "--tenant", t.name, "--domain", domainName], { cwd: "/root", env: wsEnv });

    try {
      const dnsFile = path.join("/etc/mailstack/tenants", t.name, "dns-records.txt");
      const selFile = path.join("/etc/mailstack/tenants", t.name, "dkim-selector.map");
      let activeSel = "default";
      if (fs.existsSync(selFile)) {
        const selRaw = fs.readFileSync(selFile, "utf8");
        const m = selRaw
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .find((l) => l.split(":")[0]?.trim().toLowerCase() === domainName.toLowerCase());
        const maybe = (m?.split(":")[1] || "").trim();
        if (maybe) activeSel = maybe;
      }
      let p: string | null = null;
      if (fs.existsSync(dnsFile)) {
        const dnsRaw = fs.readFileSync(dnsFile, "utf8");
        const lines = dnsRaw
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        const needle = `${activeSel}._domainkey.${domainName}`.toLowerCase();
        const line = lines.find((l) => l.toLowerCase().includes(needle) && l.toLowerCase().includes("p="));
        p = (line?.match(/\bp=([^;,\s\"]+)/i)?.[1] || "").replace(/\s+/g, "").trim() || null;
      }

      await prisma.domain.updateMany({
        where: { workspaceId: t.workspaceId, name: domainName },
        data: {
          dkimSelector: activeSel,
          dkimPublic: p,
          pendingDkimSelector: null,
          pendingDkimPublic: null,
          pendingDkimCreatedAt: null,
        },
      });
      await logJob(jobId, `✅ DKIM activated in app DB for ${domainName} (selector: ${activeSel})`);
    } catch {
      await logJob(jobId, `⚠️  Could not sync activated DKIM into app DB for ${domainName} (continuing)`);
    }

    await logJob(jobId, `✅ DKIM activated for ${domainName} (tenant=${t.name}). New emails will sign with the new selector.`);
    return;
  }

  if (type === "mailstack:dns-sync") {
    // Fix A: make Cloudflare DNS match what the SERVER uses (DKIM keys, SPF ips, etc.).
    const domainName = String((payload as any)?.domainName || (payload as any)?.domain || "")
      .trim()
      .toLowerCase()
      .replace(/\.$/, "");

    const [runner, ...prefixArgs] = sudoWrap(addon);
    const args: string[] = ["dns-sync", "--tenant", t.name];
    if ((t as any)?.createZones) args.push("--create-zones");
    await runCmd(jobId, runner, [...prefixArgs, ...args], { cwd: "/root", env: wsEnv });

    // After syncing, refresh DKIM fields in the app DB from server-generated dns-records.txt.
    try {
      const tdir = path.join("/etc/mailstack/tenants", t.name);
      const dnsFile = path.join(tdir, "dns-records.txt");
      const selFile = path.join(tdir, "dkim-selector.map");
      const pendingFile = path.join(tdir, "dkim-pending.map");
      const dnsRaw = fs.existsSync(dnsFile) ? fs.readFileSync(dnsFile, "utf8") : "";
      const lines = dnsRaw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      // Active selector
      let activeSel = "default";
      if (fs.existsSync(selFile)) {
        const selRaw = fs.readFileSync(selFile, "utf8");
        const m = selRaw
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .find((l) => l.split(":")[0]?.trim().toLowerCase() === domainName.toLowerCase());
        const maybe = (m?.split(":")[1] || "").trim();
        if (maybe) activeSel = maybe;
      }
      const activeNeedle = `${activeSel}._domainkey.${domainName}`.toLowerCase();
      const activeLine = lines.find((l) => l.toLowerCase().includes(activeNeedle) && l.toLowerCase().includes("p="));
      const activeP = (activeLine?.match(/\bp=([^;,\s\"]+)/i)?.[1] || "").replace(/\s+/g, "").trim();

      // Pending selector (if any)
      let pendingSel: string | null = null;
      if (fs.existsSync(pendingFile)) {
        const pendingRaw = fs.readFileSync(pendingFile, "utf8");
        const pm = pendingRaw
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .find((l) => l.split(":")[0]?.trim().toLowerCase() === domainName.toLowerCase());
        const maybe = (pm?.split(":")[1] || "").trim();
        if (maybe) pendingSel = maybe;
      }
      let pendingP: string | null = null;
      if (pendingSel) {
        const pendingNeedle = `${pendingSel}._domainkey.${domainName}`.toLowerCase();
        const pendingLine = lines.find((l) => l.toLowerCase().includes(pendingNeedle) && l.toLowerCase().includes("p="));
        pendingP = (pendingLine?.match(/\bp=([^;,\s\"]+)/i)?.[1] || "").replace(/\s+/g, "").trim() || null;
      }

      await prisma.domain.updateMany({
        where: { workspaceId: t.workspaceId, name: domainName },
        data: {
          dkimSelector: activeSel,
          dkimPublic: activeP || null,
          pendingDkimSelector: pendingSel,
          pendingDkimPublic: pendingP,
        },
      });

      await logJob(jobId, `✅ DNS sync complete. DKIM synced from server for ${domainName} (active=${activeSel}${pendingSel ? `, pending=${pendingSel}` : ""}).`);
    } catch {
      await logJob(jobId, `⚠️  DNS sync completed, but could not refresh DKIM fields in app DB (continuing).`);
    }
    return;
  }

  if (type === "mailstack:tenant-setup") {
    const files = writeTenantFiles({ tenant: t.name, domains, ips, users });

    const args2: string[] = [
      "tenant-setup",
      "--tenant", t.name,
      "--domains", files.domainsFile,
      "--ips", files.ipsFile,
      "--users", files.usersFile,
      "--server-ip", t.serverIp,
      "--helo-template", t.heloTemplate,
      "--dmarc-policy", t.dmarcPolicy,
      "--dmarc-rua", t.dmarcRuaTemplate,
    ];
    if (t.createZones) args2.push("--create-zones");

    const [runner, ...prefixArgs] = sudoWrap(addon);
    await runCmd(jobId, runner, [...prefixArgs, ...args2], { cwd: "/root", env: wsEnv });

    // Sync DKIM public key from the server-generated dns-records.txt into the app's Domain table.
    // This avoids mismatches (or invalid key formats) if the domain was created in-app earlier.
    try {
      const dnsFile = path.join("/etc/mailstack/tenants", t.name, "dns-records.txt");
      if (fs.existsSync(dnsFile)) {
        const dnsRaw = fs.readFileSync(dnsFile, "utf8");
	        // Parse per-line to handle different formatting styles.
	        const lines = dnsRaw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	        for (const dom of domains) {
	          const needle = `default._domainkey.${dom}`.toLowerCase();
	          const line = lines.find((l) => l.toLowerCase().includes(needle) && l.toLowerCase().includes("p="));
	          if (!line) continue;
	          // Extract p=... from DKIM TXT record.
	          const pm = line.match(/\bp=([^;,\s\"]+)/i);
	          const p = (pm?.[1] || "").replace(/\s+/g, "").trim();
	          if (!p) continue;
	          await prisma.domain.updateMany({
	            where: { workspaceId: t.workspaceId, name: dom },
	            data: { dkimSelector: "default", dkimPublic: p },
	          });
	        }
        await logJob(jobId, `✅ Synced DKIM public keys from ${dnsFile}`);
      }
    } catch (e) {
      await logJob(jobId, `⚠️  Could not sync DKIM keys into app DB (continuing)`);
    }

    // try to import mailboxes.csv created by the script
    const tenantDir = path.join("/etc/mailstack/tenants", t.name);
    const mbCsv = path.join(tenantDir, "mailboxes.csv");
    if (fs.existsSync(mbCsv)) {
      const raw = fs.readFileSync(mbCsv, "utf8");
      const lines = raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      const pairs: Array<{ email: string; pass: string }> = [];
      for (const line of lines) {
        const parts = line.split(",");
        if (parts.length < 2) continue;
        const email = parts[0].trim();
        const pass = parts.slice(1).join(",").trim();
        // skip header row
        if (email.toLowerCase() === "email" && pass.toLowerCase().startsWith("pass")) continue;
        if (!email.includes("@")) continue;
        if (email && pass) pairs.push({ email, pass });
      }

      // Import into DB (idempotent): dedupe + upsert by (tenantId,email)
      const byEmail = new Map<string, string>();
      for (const p of pairs) byEmail.set(p.email.toLowerCase(), p.pass);

      for (const [emailLower, pass] of byEmail.entries()) {
        await prisma.mailstackMailbox.upsert({
          where: { tenantId_email: { tenantId: t.id, email: emailLower } },
          update: { passwordEnc: encrypt(pass) },
          create: { tenantId: t.id, email: emailLower, passwordEnc: encrypt(pass) },
        });
      }

      // Also create/update sending Mailbox records for this workspace (SMTP/IMAP)
      // If TLS certs were issued successfully for mail.<domain>, we can enforce strict IMAP TLS.
      // The addon script writes: /etc/mailstack/tenants/<tenant>/certs-ok.txt with one hostname per line.
      const okHosts = new Set<string>();
      try {
        const okFile = path.join("/etc/mailstack/tenants", t.name, "certs-ok.txt");
        if (fs.existsSync(okFile)) {
          const okRaw = fs.readFileSync(okFile, "utf8");
          for (const line of okRaw.split(/\r?\n/)) {
            const h = line.trim();
            if (h) okHosts.add(h);
          }
        }
      } catch {}

      for (const p of pairs) {
        const host = `mail.${p.email.split("@")[1]}`;
        const existing = await prisma.mailbox.findFirst({
          where: { workspaceId: t.workspaceId, fromEmail: p.email },
        });

        const data = {
          name: String((payload as any)?.senderName || "").trim() || p.email,
          fromEmail: p.email,
          smtpHost: host,
          smtpPort: 587,
          smtpUser: p.email,
          smtpPassEnc: encrypt(p.pass),
          smtpSecure: false,
          imapHost: host,
          imapPort: 993,
          imapSecure: true,
          imapUser: p.email,
          imapPassEnc: encrypt(p.pass),
          imapTlsSkipVerify: okHosts.has(host) ? false : true,
          isActive: true,
          warmupEnabled: false,
        };

        if (existing) {
          await prisma.mailbox.update({ where: { id: existing.id }, data });
        } else {
          await prisma.mailbox.create({
            data: {
              workspaceId: t.workspaceId,
              ...data,
            },
          });
        }
      }

      await logJob(jobId, `✅ Imported ${pairs.length} mailboxes from ${mbCsv}`);
    } else {
      await logJob(jobId, `⚠ mailboxes.csv not found at ${mbCsv} (you can still run tenant-mailboxes-create manually)`);
    }

    return;
  }

  if (type === "mailstack:tenant-prepare") {
    const files = writeTenantFiles({ tenant: t.name, domains, ips, users });

    const args2: string[] = [
      "tenant-prepare",
      "--tenant", t.name,
      "--domains", files.domainsFile,
      "--ips", files.ipsFile,
      "--users", files.usersFile,
      "--server-ip", t.serverIp,
      "--helo-template", t.heloTemplate,
      "--dmarc-policy", t.dmarcPolicy,
      "--dmarc-rua", t.dmarcRuaTemplate,
    ];

    const [runner, ...prefixArgs] = sudoWrap(addon);
    await runCmd(jobId, runner, [...prefixArgs, ...args2], { cwd: "/root", env: wsEnv });

    // Sync DKIM public key from the server-generated dns-records.txt into the app's Domain table.
    // This ensures the DKIM TXT value shown in the UI is the REAL server key.
    try {
      const dnsFile = path.join("/etc/mailstack/tenants", t.name, "dns-records.txt");
      if (fs.existsSync(dnsFile)) {
        const dnsRaw = fs.readFileSync(dnsFile, "utf8");
        const lines = dnsRaw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        for (const dom of domains) {
          const needle = `default._domainkey.${dom}`.toLowerCase();
          const line = lines.find((l) => l.toLowerCase().includes(needle) && l.toLowerCase().includes("p="));
          if (!line) continue;
          const pm = line.match(/\bp=([^;,\s\"]+)/i);
          const p = (pm?.[1] || "").replace(/\s+/g, "").trim();
          if (!p) continue;
          await prisma.domain.updateMany({
            where: { workspaceId: t.workspaceId, name: dom },
            data: { dkimSelector: "default", dkimPublic: p },
          });
        }
        await logJob(jobId, `✅ Prepared tenant DNS + synced DKIM keys from ${dnsFile}`);
      } else {
        await logJob(jobId, `⚠️  Tenant prepare finished, but ${dnsFile} was not found (continuing).`);
      }
    } catch {
      await logJob(jobId, `⚠️  Tenant prepare finished, but could not sync DKIM keys into app DB (continuing).`);
    }
    return;
  }

  if (type === "mailstack:tenant-reset") {
    const deleteDns = Boolean(payload?.deleteDns);

    // 1) Optional: remove Cloudflare DNS records created by Mailstack
    // Use server-side mailstack-addon.sh so we delete the *exact* records created (including dynamic DKIM selectors).
    if (deleteDns) {
      const cfg = await prisma.mailstackConfig.findUnique({ where: { workspaceId: t.workspaceId } });
      if (!cfg?.cloudflareTokenEnc) throw new Error("Cloudflare token not set in Mailstack settings");
      const token = decrypt(cfg.cloudflareTokenEnc).trim();
      if (!token) throw new Error("Cloudflare token decrypt failed");

      const [runner, ...prefixArgs] = sudoWrap(addon);
      const envWithToken = { ...wsEnv, CF_API_TOKEN: token };
      await runCmd(jobId, runner, [...prefixArgs, "tenant-purge-dns", "--tenant", t.name], { cwd: "/root", env: envWithToken });
      await logJob(jobId, "✅ Cloudflare DNS purge completed");
    }

    // 2) Suspend tenant (best-effort), then remove tenant folder and rebuild maps
    try {
      const [runner, ...prefixArgs] = sudoWrap(addon);
      await runCmd(jobId, runner, [...prefixArgs, "tenant-suspend", "--tenant", t.name], { cwd: "/root", env: wsEnv });
    } catch {
      await logJob(jobId, "⚠️  tenant-suspend failed (continuing)");
    }

    // Remove tenant folder(s) on the server
    try {
      const [cmd, ...baseArgs] = sudoWrap("bash");
      await runCmd(jobId, cmd, [...baseArgs, "-lc", `rm -rf /etc/mailstack/tenants/${t.name} /tmp/coldmail-mailstack/${t.name}`], {
        cwd: "/",
      });
    } catch {
      await logJob(jobId, "⚠️  Could not remove tenant folder(s) (continuing)");
    }

    try {
      const [runner, ...prefixArgs] = sudoWrap(addon);
      await runCmd(jobId, runner, [...prefixArgs, "exim-rebuild"], { cwd: "/root", env: wsEnv });
    } catch {
      await logJob(jobId, "⚠️  exim-rebuild failed (continuing)");
    }

    // 3) Delete app mailboxes created for sending + delete tenant from DB
    const mailboxEmails = new Set<string>();
    for (const m of t.mailboxes) mailboxEmails.add(m.email);
    for (const u of users) {
      const v = String(u || "").trim();
      if (!v) continue;
      if (v.includes("@")) {
        mailboxEmails.add(v);
      } else {
        for (const d of domains) mailboxEmails.add(`${v}@${d}`);
      }
    }

    if (mailboxEmails.size > 0) {
      await prisma.mailbox.deleteMany({
        where: { workspaceId: t.workspaceId, fromEmail: { in: Array.from(mailboxEmails) } },
      });
    }

    await prisma.mailstackTenant.delete({ where: { id: t.id } });
    await logJob(jobId, `✅ Tenant reset complete: ${t.name}`);
    return;
  }

  if (type === "mailstack:domain-delete") {
    const domainName = String(payload?.domainName || payload?.domain || "").trim().toLowerCase().replace(/\.$/, "");
    if (!domainName) throw new Error("domainName missing");

    // Execute server-side deletion: remove domain from tenant + delete mail users/maildirs + rebuild maps
    const [runner, ...prefixArgs] = sudoWrap(addon);
    await runCmd(jobId, runner, [...prefixArgs, "tenant-remove-domain", "--tenant", t.name, "--domain", domainName], { cwd: "/root", env: wsEnv });

    // DB cleanup (best-effort) in case API deleted partially
    try {
      await prisma.mailstackMailbox.deleteMany({ where: { tenantId: t.id, email: { endsWith: `@${domainName}` } } });
    } catch {}
    try {
      await prisma.mailstackTenantUser.deleteMany({ where: { tenantId: t.id, email: { endsWith: `@${domainName}` } } });
    } catch {}
    try {
      await prisma.mailstackTenantDomain.deleteMany({ where: { tenantId: t.id, domainName } });
    } catch {}

    await logJob(jobId, `✅ Server-side domain deletion completed: ${domainName} (tenant=${t.name})`);
    return;
  }

  const map: Record<string, string[]> = {
    "mailstack:tenant-dns-sync": ["dns-sync", "--tenant", t.name],
    "mailstack:tenant-rotate-now": ["rotate-now", "--tenant", t.name],
    "mailstack:tenant-suspend": ["tenant-suspend", "--tenant", t.name],
    "mailstack:tenant-unsuspend": ["tenant-unsuspend", "--tenant", t.name],
    "mailstack:tenant-exim-rebuild": ["exim-rebuild"],
    "mailstack:tenant-tls-issue": ["tls-issue", "--tenant", t.name],
  };

  const cmdArgs = map[type];
  if (!cmdArgs) throw new Error(`Unknown mailstack job type: ${type}`);

  const [runner, ...prefixArgs] = sudoWrap(addon);
  await runCmd(jobId, runner, [...prefixArgs, ...cmdArgs], { cwd: "/root", env: wsEnv });

  if (type === "mailstack:tenant-tls-issue") {
    // After issuing TLS, mark matching app mailboxes as strict TLS (turn off skip-verify)
    try {
      const okFile = path.join("/etc/mailstack/tenants", t.name, "certs-ok.txt");
      const okHosts = new Set<string>();
      if (fs.existsSync(okFile)) {
        const okRaw = fs.readFileSync(okFile, "utf8");
        for (const line of okRaw.split(/\r?\n/)) {
          const h = line.trim();
          if (h) okHosts.add(h);
        }
      }
      if (okHosts.size > 0) {
        await prisma.mailbox.updateMany({
          where: { workspaceId: t.workspaceId, imapHost: { in: Array.from(okHosts) } },
          data: { imapTlsSkipVerify: false },
        });
        await logJob(jobId, `✅ Updated ${okHosts.size} host(s) to strict IMAP TLS (skip-verify OFF)`);
      } else {
        await logJob(jobId, "⚠️  No TLS certs marked OK yet (certs-ok.txt empty). Check Cloudflare delegation/permissions and retry.");
      }
    } catch (e: any) {
      await logJob(jobId, `⚠️  Could not update mailbox TLS flags: ${String(e?.message||e)}`);
    }
  }


  if (type === "mailstack:tenant-suspend") {
    await prisma.mailstackTenant.updateMany({ where: { id: t.id }, data: { status: "suspended" } });
  }
  if (type === "mailstack:tenant-unsuspend") {
    await prisma.mailstackTenant.updateMany({ where: { id: t.id }, data: { status: "active" } });
  }
}


/**
 * Worker loops:
 * 1) schedule_campaign: convert queued enrollments into send_message jobs (respecting delays)
 * 2) send_message: select mailbox, create Message, send via SMTP, log events, schedule next step
 *
 * This is intentionally simple so you can extend:
 * - send windows (hours)
 * - timezones
 * - better mailbox load balancing
 * - reply detection (IMAP) and bounce mailbox parsing
 */


async function handleAiopsApplyIncident(jobId: string, payload: any) {
  const incidentId = String(payload?.incidentId || "");
  const workspaceId = payload?.workspaceId ? String(payload.workspaceId) : null;
  const mode = String(payload?.mode || "safe");

  if (!incidentId) {
    await logJob(jobId, "aiops_apply_incident skipped: missing incidentId");
    return;
  }

  const p: any = prisma as any;
  const incidentDelegate = p?.incident;
  const actionDelegate = p?.incidentAction;
  if (!incidentDelegate?.findFirst) {
    await logJob(jobId, "aiops_apply_incident skipped: Incident model is not available. Run Prisma migrations and generate the client.");
    return;
  }

  const incident = await incidentDelegate.findFirst({
    where: { id: incidentId, ...(workspaceId ? { workspaceId } : {}) },
    select: {
      id: true,
      workspaceId: true,
      status: true,
      summary: true,
      suggestedFixesJson: true,
      evidenceJson: true,
    },
  });

  if (!incident) {
    await logJob(jobId, `aiops_apply_incident skipped: incident ${incidentId} not found`);
    return;
  }

  const fixes: any = incident.suggestedFixesJson || {};
  const rawActions: any[] = Array.isArray(fixes?.actions) ? fixes.actions : [];
  const safeActions = rawActions.filter((a) => String(a?.kind || "safe") === "safe");

  await appLogAsync({
    workspaceId: incident.workspaceId || workspaceId,
    level: "info",
    category: "worker",
    event: "aiops_apply_incident_start",
    message: "Applying safe AIOps incident actions",
    entityType: "incident",
    entityId: incident.id,
    data: { mode, actionCount: safeActions.length },
  }).catch(() => null);

  if (!safeActions.length) {
    if (actionDelegate?.create) {
      await actionDelegate.create({
        data: {
          incidentId: incident.id,
          kind: "safe",
          actionType: "noop",
          argsJson: { reason: "No safe actions were suggested for this incident." },
          commandPreview: "No safe actions were suggested.",
          appliedAt: new Date(),
          outcome: "skipped",
          logs: "No safe actions were suggested for this incident.",
        },
      }).catch(() => null);
    }
    await incidentDelegate.update({ where: { id: incident.id }, data: { needsHumanReview: true } }).catch(() => null);
    await logJob(jobId, `aiops_apply_incident skipped: no safe actions for incident ${incident.id}`);
    return;
  }

  for (const action of safeActions) {
    const actionType = String(action?.actionType || action?.type || "safe_action");
    const commandPreview = String(action?.commandPreview || action?.command || action?.label || actionType).slice(0, 4000);
    const argsJson = action?.args || action?.argsJson || action || {};

    // Conservative default: record the safe recommendation as applied/skipped for audit,
    // but do not execute arbitrary shell commands from AI-generated incident metadata.
    const outcome = actionType === "noop" ? "skipped" : "skipped";
    const logs = "Safe action recorded for review. Automatic shell execution is intentionally disabled in the worker.";

    if (actionDelegate?.create) {
      await actionDelegate.create({
        data: {
          incidentId: incident.id,
          kind: "safe",
          actionType,
          argsJson,
          commandPreview,
          appliedAt: new Date(),
          outcome,
          logs,
        },
      }).catch(() => null);
    }
    await logJob(jobId, `aiops_apply_incident recorded safe action: ${commandPreview}`);
  }

  await incidentDelegate.update({
    where: { id: incident.id },
    data: { status: "applied", needsHumanReview: true },
  }).catch(() => null);

  await appLogAsync({
    workspaceId: incident.workspaceId || workspaceId,
    level: "info",
    category: "worker",
    event: "aiops_apply_incident_done",
    message: "AIOps incident safe actions recorded",
    entityType: "incident",
    entityId: incident.id,
    data: { mode, actionCount: safeActions.length },
  }).catch(() => null);
}

async function lockNextJob() {
  const now = new Date();
  // find one due job and lock it (poor man's queue)
  const job = await prisma.job.findFirst({
    where: { status: "queued", runAt: { lte: now } },
    orderBy: [{ runAt: "asc" }, { createdAt: "asc" }],
  });
  if (!job) return null;

  // attempt lock
  const locked = await prisma.job.updateMany({
    where: { id: job.id, status: "queued" },
    data: { status: "running", lockedAt: new Date() },
  });
  if (locked.count !== 1) return null;

  return job;
}


async function executeJob(job: any, payload: any) {
  if (job.type === "schedule_campaign") {
    await handleScheduleCampaign(payload);
  } else if (job.type === "send_next_step") {
    await handleSendNextStep(payload);
  } else if (job.type === "sync_imap") {
    await handleSyncImap(payload);
  } else if (job.type === "mailbox_healthcheck") {
    await handleMailboxHealthcheck(job.id, payload);
  } else if (job.type === "mailbox_test_send") {
    await handleMailboxTestSend(job.id, payload);
  } else if (job.type === "domain_dns_check") {
    await handleDomainDnsCheck(job.id, payload);
  } else if (job.type === "warmup_tick") {
    await handleWarmupTick(job.id, payload);
  } else if (job.type === "warmup_reply") {
    await handleWarmupReply(job.id, payload);
  } else if (job.type === "warmup_followup") {
    await handleWarmupFollowup(job.id, payload);
  } else if (job.type === "warmup_seed_check") {
    await handleWarmupSeedCheck(job.id, payload);
  } else if (job.type === "warmup_mailbox_check") {
    await handleWarmupMailboxCheck(job.id, payload);
  } else if (job.type === "warmup_seed_reply") {
    await handleWarmupSeedReply(job.id, payload);
  } else if (job.type === "warmup_seed_rescue") {
    await handleWarmupSeedRescue(job.id, payload);
  } else if (job.type.startsWith("mailstack:") || job.type === "mailstack:init-cloudflare") {
    await handleMailstackJob(job.id, job.type, payload);

    // Keep tenant last-job status in sync.
    // NOTE: tenant-reset deletes the tenant row; don't try to update it afterwards.
    if (payload?.tenantId && job.type !== "mailstack:tenant-reset") {
      await prisma.mailstackTenant
        .updateMany({ where: { id: String(payload.tenantId) }, data: { lastJobStatus: "done" } })
        .catch(() => {});
    }
  } else if (job.type === "aiops_apply_incident") {
    await handleAiopsApplyIncident(job.id, payload);
  } else {
    // unknown job type
  }
}

async function handleScheduleCampaign(payload: any) {
  const { campaignId, workspaceId } = payload;
  const camp = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    include: { steps: true },
  });
  if (!camp) return;

  // For queued enrollments, mark active and schedule send step 1 now
  const enrs = await prisma.enrollment.findMany({
    where: { campaignId, status: { in: ["queued", "active"] } },
    include: { lead: true },
    take: 5000,
  });

  const step1 = await prisma.sequenceStep.findFirst({
    where: { campaignId, stepNumber: 1 },
  });
  if (!step1) return;

  for (const e of enrs) {
    if (e.status === "queued") {
      await prisma.enrollment.update({ where: { id: e.id }, data: { status: "active" } });
    }
    // schedule send for any enrollment due now (nextRunAt <= now)
    if (e.nextRunAt <= new Date()) {
      await prisma.job.create({
        data: {
          type: "send_next_step",
          payload: JSON.stringify({ enrollmentId: e.id, workspaceId }),
          runAt: new Date(),
          status: "queued",
        },
      });
    }
  }
}


async function pickMailbox(workspaceId: string, campaignId: string, mailboxStrategy: string, mailboxPoolId?: string | null, mailboxMinIdleMinutes?: number) {
  // Priority:
  // 1) Explicit campaign sender pool (CampaignMailbox)
  // 2) Campaign mailboxPoolId (MailboxPoolMember)
  // 3) All active mailboxes

  const selected = await prisma.campaignMailbox
    .findMany({
      where: { campaignId, isActive: true, mailbox: { workspaceId, isActive: true } },
      include: { mailbox: true },
      orderBy: { createdAt: "asc" },
    })
    .catch(() => [] as any[]);

  let poolMembers: Array<{ mailbox: any; weight: number }> = selected
    .map((x: any) => ({ mailbox: x.mailbox, weight: 1 }))
    .filter((x) => x.mailbox);

  if (poolMembers.length === 0 && mailboxPoolId) {
    const members = await prisma.mailboxPoolMember
      .findMany({
        where: {
          poolId: mailboxPoolId,
          isActive: true,
          mailbox: { workspaceId, isActive: true },
        },
        include: { mailbox: true },
        orderBy: { createdAt: "asc" },
      })
      .catch(() => [] as any[]);

    poolMembers = members
      .map((m: any) => ({ mailbox: m.mailbox, weight: Math.max(1, Number(m.weight || 1)) }))
      .filter((x) => x.mailbox);
  }

  if (poolMembers.length === 0) {
    const all = await prisma.mailbox.findMany({
      where: { workspaceId, isActive: true },
      orderBy: { createdAt: "asc" },
    });
    poolMembers = all.map((m: any) => ({ mailbox: m, weight: 1 }));
  }

  if (poolMembers.length === 0) throw new Error("NO_ACTIVE_MAILBOX");

  let mailboxes = poolMembers.map((x) => x.mailbox);

  // Exclusion overrides: CampaignMailbox.isActive=false can be used to exclude a mailbox for this campaign
  // even when the campaign is using a pool or "all" mailboxes.
  // In manual mode (selected active senders), exclusions are already handled by the active list.
  if (selected.length === 0) {
    const excluded = await prisma.campaignMailbox
      .findMany({
        where: { campaignId, isActive: false, mailbox: { workspaceId, isActive: true } },
        select: { mailboxId: true },
      })
      .catch(() => [] as any[]);

    if (excluded.length) {
      const ex = new Set(excluded.map((e: any) => String(e.mailboxId)));
      poolMembers = poolMembers.filter((m: any) => !ex.has(String(m.mailbox?.id)));
      mailboxes = mailboxes.filter((m: any) => !ex.has(String(m.id)));
    }
  }

  // Auto-throttle: exclude mailboxes that are currently on cooldown for this campaign.
  const now = new Date();
  const throttled = await prisma.mailboxThrottle
    .findMany({
      where: { campaignId, until: { gt: now } },
      select: { mailboxId: true, until: true },
      orderBy: { until: "asc" },
    })
    .catch(() => [] as any[]);

  if (throttled.length) {
    const set = new Set(throttled.map((t: any) => t.mailboxId));
    const filtered = mailboxes.filter((m: any) => !set.has(m.id));
    if (filtered.length === 0) {
      const soonest = throttled[0]?.until ? new Date(throttled[0].until) : new Date(Date.now() + 5 * 60000);
      throw new Error(`ALL_THROTTLED:${soonest.toISOString()}`);
    }
    mailboxes = filtered;
  }

  if (mailboxStrategy === "score" || mailboxStrategy === "score_idle") {
    const idleMin = mailboxStrategy === "score_idle" ? Math.max(0, Number(mailboxMinIdleMinutes || 0)) : 0;

    const ids = mailboxes.map((m: any) => String(m.id));
    const nowTs = Date.now();
    const since7d = new Date(nowTs - 7 * 24 * 60 * 60 * 1000);
    const since24h = new Date(nowTs - 24 * 60 * 60 * 1000);

    // Totals are based on sentAt (attempted sends), so bounces still count in the denominator.
    const totals = await prisma.message
      .groupBy({
        by: ["mailboxId"],
        where: { campaignId, mailboxId: { in: ids }, sentAt: { not: null, gte: since7d } },
        _count: { _all: true },
      })
      .catch(() => [] as any[]);

    const bounces = await prisma.message
      .groupBy({
        by: ["mailboxId"],
        where: { campaignId, mailboxId: { in: ids }, status: "bounced", sentAt: { not: null, gte: since7d } },
        _count: { _all: true },
      })
      .catch(() => [] as any[]);

    const fails = await prisma.message
      .groupBy({
        by: ["mailboxId"],
        where: { campaignId, mailboxId: { in: ids }, status: "failed", createdAt: { gte: since24h } },
        _count: { _all: true },
      })
      .catch(() => [] as any[]);

    const replies = await prisma.message
      .groupBy({
        by: ["mailboxId"],
        where: { campaignId, mailboxId: { in: ids }, status: "replied", sentAt: { not: null, gte: since7d } },
        _count: { _all: true },
      })
      .catch(() => [] as any[]);

    const last = await prisma.message
      .groupBy({
        by: ["mailboxId"],
        where: { campaignId, mailboxId: { in: ids }, sentAt: { not: null } },
        _max: { sentAt: true },
      })
      .catch(() => [] as any[]);

    const totalMap = new Map<string, number>();
    for (const r of totals as any[]) totalMap.set(String((r as any).mailboxId), Number((r as any)._count?._all || 0));

    const bounceMap = new Map<string, number>();
    for (const r of bounces as any[]) bounceMap.set(String((r as any).mailboxId), Number((r as any)._count?._all || 0));

    const failMap = new Map<string, number>();
    for (const r of fails as any[]) failMap.set(String((r as any).mailboxId), Number((r as any)._count?._all || 0));

    const replyMap = new Map<string, number>();
    for (const r of replies as any[]) replyMap.set(String((r as any).mailboxId), Number((r as any)._count?._all || 0));

    const lastMap = new Map<string, number>();
    for (const r of last as any[]) {
      const t = (r as any)._max?.sentAt ? new Date((r as any)._max.sentAt).getTime() : 0;
      lastMap.set(String((r as any).mailboxId), t);
    }

    const idleCutoff = idleMin > 0 ? nowTs - idleMin * 60 * 1000 : 0;

    const scored = mailboxes.map((m: any) => {
      const id = String(m.id);
      const total = totalMap.get(id) ?? 0;
      const bounced = bounceMap.get(id) ?? 0;
      const failed = failMap.get(id) ?? 0;
      const replied = replyMap.get(id) ?? 0;
      const lastSent = lastMap.get(id) ?? 0;

      const bounceRate = total > 0 ? bounced / total : 0;
      // Lower is better. Bounce rate is weighted heavily; recent failures add penalty; replies reduce score slightly.
      const score = bounceRate * 1000 + failed * 10 - replied * 0.5 + (total === 0 ? -50 : 0);

      const idleOk = idleMin <= 0 || lastSent === 0 || lastSent <= idleCutoff;
      return { mailbox: m, score, lastSent, idleOk };
    });

    const eligible = scored.filter((x) => x.idleOk);
    const pool = eligible.length ? eligible : scored;

    pool.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      if (a.lastSent !== b.lastSent) return a.lastSent - b.lastSent; // older first
      return String(a.mailbox.id).localeCompare(String(b.mailbox.id));
    });

    return pool[0].mailbox;
  }

  if (mailboxStrategy === "random") {
    return mailboxes[Math.floor(Math.random() * mailboxes.length)];
  }

  if (mailboxStrategy === "weighted") {
    // Weighted random pick. If weights are missing (e.g. campaignMailboxes), all weights default to 1.
    const members = poolMembers
      .filter((x) => mailboxes.find((m) => m.id === x.mailbox.id))
      .map((x) => ({ id: x.mailbox.id, w: Math.max(1, Number(x.weight || 1)) }));

    const total = members.reduce((a, b) => a + b.w, 0);
    let r = Math.random() * Math.max(1, total);
    for (const m of members) {
      r -= m.w;
      if (r <= 0) {
        return mailboxes.find((x) => x.id === m.id) || mailboxes[0];
      }
    }
    return mailboxes[0];
  }

  if (mailboxStrategy === "least_recent") {
    // Pick the mailbox that was used least recently for this campaign (sentAt max).
    const ids = mailboxes.map((m: any) => String(m.id));
    const last = await prisma.message
      .groupBy({
        by: ["mailboxId"],
        where: { campaignId, mailboxId: { in: ids }, status: "sent", sentAt: { not: null } },
        _max: { sentAt: true },
      })
      .catch(() => [] as any[]);

    const lastMap = new Map<string, number>();
    for (const r of last as any[]) {
      const t = (r._max?.sentAt as Date | null) ? new Date(r._max.sentAt).getTime() : 0;
      lastMap.set(String(r.mailboxId), t);
    }

    // Choose the smallest timestamp (0 means never used, so it's preferred).
    let best = mailboxes[0];
    let bestT = lastMap.get(String(best.id)) ?? 0;
    for (const m of mailboxes) {
      const t = lastMap.get(String(m.id)) ?? 0;
      if (t === 0 && bestT !== 0) {
        best = m;
        bestT = t;
      } else if (bestT !== 0 && t !== 0 && t < bestT) {
        best = m;
        bestT = t;
      } else if (bestT === 0 && t === 0) {
        // tie-break with stable hash
        if (String(m.id) < String(best.id)) best = m;
      }
    }
    return best;
  }

  // round_robin (default): stable-ish per minute + campaign hash
  const base = Math.floor(Date.now() / 60000);
  let h = 0;
  for (const ch of campaignId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const idx = (base + h) % mailboxes.length;
  return mailboxes[idx];
}

async function maybeThrottleMailboxOnSpike(camp: any, mailboxId: string) {
  try {
    if (!camp?.autoThrottleEnabled) return;

    const windowMin = Math.max(5, Number(camp.autoThrottleWindowMinutes ?? 60));
    const minSent = Math.max(1, Number(camp.autoThrottleMinSent ?? 20));
    const maxHard = Math.max(0, Number(camp.autoThrottleMaxHardBounceRate ?? 0.08));
    const maxTotal = Math.max(0, Number(camp.autoThrottleMaxBounceRate ?? 0.12));
    const cooldownMin = Math.max(5, Number(camp.autoThrottleCooldownMinutes ?? 120));

    const since = new Date(Date.now() - windowMin * 60 * 1000);
    const sent = await prisma.message
      .count({ where: { campaignId: camp.id, mailboxId, status: "sent", sentAt: { gte: since } } })
      .catch(() => 0);
    if (sent < minSent) return;

    const [hard, soft] = await Promise.all([
      prisma.event.count({ where: { type: "bounce_hard", createdAt: { gte: since }, message: { campaignId: camp.id, mailboxId } } }).catch(() => 0),
      prisma.event.count({ where: { type: "bounce_soft", createdAt: { gte: since }, message: { campaignId: camp.id, mailboxId } } }).catch(() => 0),
    ]);

    const total = hard + soft;
    const hardRate = hard / sent;
    const totalRate = total / sent;

    if (hardRate >= maxHard || totalRate >= maxTotal) {
      const until = new Date(Date.now() + cooldownMin * 60 * 1000);
      const reason = `Bounce spike (${windowMin}m): sent=${sent}, hard=${hard} (${(hardRate * 100).toFixed(1)}%), total=${total} (${(totalRate * 100).toFixed(1)}%)`;

      await prisma.mailboxThrottle.upsert({
        where: { campaignId_mailboxId: { campaignId: camp.id, mailboxId } },
        create: { campaignId: camp.id, mailboxId, until, reason },
        update: { until, reason },
      });
    }
  } catch {
    // never crash the worker due to throttling logic
  }
}



function parseSendingWindow(win: string | null | undefined): { start: number; end: number } {
  const s = String(win || "09:00-18:00").trim();
  const m = s.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!m) return { start: 9 * 60, end: 18 * 60 };
  const sh = Math.min(23, Math.max(0, Number(m[1])));
  const sm = Math.min(59, Math.max(0, Number(m[2])));
  const eh = Math.min(23, Math.max(0, Number(m[3])));
  const em = Math.min(59, Math.max(0, Number(m[4])));
  return { start: sh * 60 + sm, end: eh * 60 + em };
}

function tzParts(date: Date, timeZone: string) {
  // weekday: 0=Sun..6=Sat
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";

  const wd = get("weekday");
  const weekday =
    wd === "Sun" ? 0 :
    wd === "Mon" ? 1 :
    wd === "Tue" ? 2 :
    wd === "Wed" ? 3 :
    wd === "Thu" ? 4 :
    wd === "Fri" ? 5 :
    6;

  return {
    weekday,
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function isAllowedBySchedule(camp: any, when: Date): boolean {
  const tz = String(camp?.timezone || "UTC");
  const { start, end } = parseSendingWindow(camp?.sendingWindow);
  const p = tzParts(when, tz);
  const mins = p.hour * 60 + p.minute;

  let days: number[] | null = null;
  try {
    const v = JSON.parse(String(camp?.daysOfWeek || ""));
    if (Array.isArray(v)) days = v.map((x: any) => Number(x)).filter((x: any) => Number.isFinite(x));
  } catch {}

  if (days && days.length > 0 && !days.includes(p.weekday)) return false;

  // window can cross midnight
  if (start === end) return true;
  if (start < end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}

function nextAllowedBySchedule(camp: any, from: Date): Date {
  // Step forward in 30-minute increments up to 14 days to find the next allowed time.
  // This avoids pulling in timezone libs, but still respects the campaign timezone via Intl.
  const stepMs = 30 * 60 * 1000;
  let t = new Date(from.getTime() + stepMs);
  for (let i = 0; i < (14 * 24 * 2); i++) {
    if (isAllowedBySchedule(camp, t)) return t;
    t = new Date(t.getTime() + stepMs);
  }
  // Fallback: 1 hour later
  return new Date(from.getTime() + 60 * 60 * 1000);
}

function effectiveDailyLimit(camp: any): number {
  const base = Number(camp?.dailySendLimit || 0) || 0;
  if (!camp?.rampEnabled) return base > 0 ? base : 0;

  const start = Number(camp?.rampStartLimit || 20);
  const inc = Number(camp?.rampDailyIncrease || 20);
  const max = Number(camp?.rampMaxLimit || base || 0) || base || 0;

  const since = camp?.startAt ? new Date(camp.startAt) : camp?.createdAt ? new Date(camp.createdAt) : new Date();
  const days = Math.max(0, Math.floor((Date.now() - since.getTime()) / (24 * 60 * 60 * 1000)));

  const v = start + days * inc;
  const clamped = max > 0 ? Math.min(v, max) : v;
  return base > 0 ? Math.min(base, clamped) : clamped;
}

function injectTracking(htmlOrText: string, messageId: string, isHtml: boolean) {
  const openUrl = `${env.PUBLIC_APP_URL}/t/open?m=${encodeURIComponent(messageId)}`;
  if (isHtml) {
    const pixel = `<img src="${openUrl}" width="1" height="1" style="display:none" alt="" />`;
    if (htmlOrText.includes("</body>")) return htmlOrText.replace("</body>", `${pixel}</body>`);
    return htmlOrText + pixel;
  } else {
    // for text, append open pixel url (not ideal) - better: send multipart with html
    return htmlOrText + `\n\n[open-tracking] ${openUrl}`;
  }
}

function wrapClickTracking(body: string, messageId: string) {
  // Replace http(s) links with a signed tracking redirect to prevent open redirects.
  return body.replace(/https?:\/\/[^\s)]+/g, (m) => {
    const sig = signTrackingClick(m, messageId);
    const tracked = `${env.PUBLIC_APP_URL}/t/click?m=${encodeURIComponent(messageId)}&to=${encodeURIComponent(m)}&sig=${encodeURIComponent(sig)}`;
    return tracked;
  });
}

async function isSuppressed(workspaceId: string, email: string) {
  const s = await prisma.suppression.findUnique({
    where: { workspaceId_email: { workspaceId, email } },
  });
  return !!s;
}

function randInt(min: number, max: number) {
  const lo = Math.floor(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  if (hi <= lo) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

async function nextPacedSendTime(camp: any, mailboxId: string, now: Date): Promise<Date | null> {
  // Global pacing (env-based): enforce a random gap between sends per mailbox.
  // This avoids "send to all leads instantly" behavior when a campaign starts.
  const minGap = Number(env.SEND_GAP_MIN_SECONDS ?? 60);
  const maxGap = Number(env.SEND_GAP_MAX_SECONDS ?? 180);
  const gapSec = randInt(Math.max(0, minGap), Math.max(0, maxGap));
  if (gapSec <= 0) return null;

  const last = await prisma.message
    .findFirst({
      where: {
        campaignId: camp.id,
        mailboxId,
        status: "sent",
        sentAt: { not: null },
      },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    })
    .catch(() => null as any);

  const lastAt: Date | null = last?.sentAt ? new Date(last.sentAt) : null;
  if (!lastAt) return null;

  const earliest = new Date(lastAt.getTime() + gapSec * 1000);
  if (earliest <= now) return null;
  return earliest;
}

async function handleSendNextStep(payload: any) {
  const { enrollmentId, workspaceId } = payload;
  const enr = await prisma.enrollment.findFirst({
    where: { id: enrollmentId },
    include: { campaign: true, lead: true },
  });
  if (!enr) return;
  if (enr.status !== "active") return;

  const lead = enr.lead;
  if (!lead) return;

  // stop if suppressed
  if (await isSuppressed(workspaceId, lead.email)) {
    await prisma.enrollment.update({ where: { id: enr.id }, data: { status: "stopped" } });
    await prisma.lead.update({ where: { id: lead.id }, data: { status: "suppressed" } }).catch(() => {});
    return;
  }

  const camp = enr.campaign;
  if (!camp || camp.status !== "running") return;

  // Archived campaigns should not send
  if ((camp as any).archivedAt) {
    await prisma.enrollment.update({ where: { id: enr.id }, data: { status: "stopped", stopReason: "archived" } }).catch(() => {});
    return;
  }

  const now = new Date();
  // Campaign start/end gating
  if ((camp as any).startAt && now < new Date((camp as any).startAt)) {
    const runAt = new Date((camp as any).startAt);
    await prisma.job.create({
      data: { type: "send_next_step", payload: JSON.stringify({ enrollmentId: enr.id, workspaceId }), runAt, status: "queued" },
    }).catch(() => {});
    return;
  }
  if ((camp as any).endAt && now > new Date((camp as any).endAt)) {
    await prisma.enrollment.update({ where: { id: enr.id }, data: { status: "stopped", stopReason: "campaign_ended" } }).catch(() => {});
    return;
  }

  // Sending window + weekday gating (campaign timezone)
  if (!isAllowedBySchedule(camp as any, now)) {
    const runAt = nextAllowedBySchedule(camp as any, now);
    await prisma.job.create({
      data: { type: "send_next_step", payload: JSON.stringify({ enrollmentId: enr.id, workspaceId }), runAt, status: "queued" },
    }).catch(() => {});
    return;
  }

  // Daily limit (with optional ramp-up). This is enforced at send-time to keep logic simple.
  const limit = effectiveDailyLimit(camp as any);
  if (limit > 0) {
    const startOfDay = dayjs().startOf("day").toDate();
    const endOfDay = dayjs().endOf("day").toDate();
    const sentToday = await prisma.message.count({
      where: { campaignId: camp.id, status: "sent", sentAt: { gte: startOfDay, lte: endOfDay } },
    }).catch(() => 0);

    if (sentToday >= limit) {
      // push to next day
      const runAt = nextAllowedBySchedule(camp as any, dayjs().add(1, "day").startOf("day").toDate());
      await prisma.job.create({
        data: { type: "send_next_step", payload: JSON.stringify({ enrollmentId: enr.id, workspaceId }), runAt, status: "queued" },
      }).catch(() => {});
      return;
    }
  }

  const step = await prisma.sequenceStep.findFirst({
    where: { campaignId: camp.id, stepNumber: enr.currentStep },
    include: { variants: { where: { isActive: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!step) {
    await prisma.enrollment.update({ where: { id: enr.id }, data: { status: "completed" } });
    return;
  }

  let mailbox: any;
  try {
    mailbox = await pickMailbox(workspaceId, camp.id, camp.mailboxStrategy, (camp as any).mailboxPoolId || null, (camp as any).mailboxMinIdleMinutes ?? 0);
  } catch (e: any) {
    const msg = String(e?.message || e || "");
    if (msg.startsWith("ALL_THROTTLED:")) {
      const iso = msg.split(":")[1];
      const until = iso ? new Date(iso) : new Date(Date.now() + 5 * 60000);
      const runAt = new Date(until.getTime() + 30 * 1000);
      await prisma.job
        .create({
          data: { type: "send_next_step", payload: JSON.stringify({ enrollmentId: enr.id, workspaceId }), runAt, status: "queued" },
        })
        .catch(() => {});
      return;
    }
    throw e;
  }

  // ------------------------------------------------------------
  // Pacing: random gap between sends per mailbox.
  // This prevents the app from sending to all leads back-to-back.
  // Controlled globally via SEND_GAP_MIN_SECONDS / SEND_GAP_MAX_SECONDS.
  // ------------------------------------------------------------
  const pacedAt = await nextPacedSendTime(camp as any, String(mailbox.id), now);
  if (pacedAt) {
    const runAt = isAllowedBySchedule(camp as any, pacedAt) ? pacedAt : nextAllowedBySchedule(camp as any, pacedAt);
    await prisma.job
      .create({
        data: { type: "send_next_step", payload: JSON.stringify({ enrollmentId: enr.id, workspaceId }), runAt, status: "queued" },
      })
      .catch(() => {});
    return;
  }

  // Throttling: per mailbox per minute (campaign scope)
  const perMin = Number((camp as any).perMailboxPerMinute ?? 20);
  if (Number.isFinite(perMin) && perMin > 0) {
    const since = new Date(Date.now() - 60 * 1000);
    const sentLastMin = await prisma.message
      .count({ where: { campaignId: camp.id, mailboxId: mailbox.id, status: "sent", sentAt: { gte: since } } })
      .catch(() => 0);
    if (sentLastMin >= perMin) {
      // retry shortly; other enrollments/domains might still send
      const runAt = new Date(Date.now() + 30 * 1000);
      await prisma.job
        .create({
          data: { type: "send_next_step", payload: JSON.stringify({ enrollmentId: enr.id, workspaceId }), runAt, status: "queued" },
        })
        .catch(() => {});
      return;
    }
  }

  // Domain daily caps (campaign scope)
  const rcptDomain = getRecipientDomain(lead.email);
  if (rcptDomain) {
    const caps = parseDomainCaps((camp as any).domainCaps);
    const cap = Number(caps[rcptDomain] ?? (camp as any).domainDailyCap ?? 25);
    if (Number.isFinite(cap) && cap > 0) {
      const startOfDay = dayjs().startOf("day").toDate();
      const endOfDay = dayjs().endOf("day").toDate();
      const sentTodayToDomain = await prisma.message
        .count({
          where: {
            campaignId: camp.id,
            status: "sent",
            sentAt: { gte: startOfDay, lte: endOfDay },
            lead: { email: { endsWith: `@${rcptDomain}` } },
          },
        })
        .catch(() => 0);

      if (sentTodayToDomain >= cap) {
        const runAt = nextAllowedBySchedule(camp as any, dayjs().add(1, "day").startOf("day").toDate());
        await prisma.job
          .create({
            data: { type: "send_next_step", payload: JSON.stringify({ enrollmentId: enr.id, workspaceId }), runAt, status: "queued" },
          })
          .catch(() => {});
        return;
      }
    }
  }

  // Pick step variant (A/B testing). If no variants exist, fallback to base step templates.
  const variants: any[] = Array.isArray((step as any).variants) ? (step as any).variants : [];
  let chosenVariant: any = null;
  if (variants.length > 0) {
    // Prefer A when not running AB
    const isAB = Boolean((step as any).abEnabled) && variants.length >= 2;
    if (isAB) {
      chosenVariant = pickWeightedVariant(`${enr.id}:${(step as any).id}`, variants);
    } else {
      chosenVariant = variants.find((v) => String(v.name || "").toUpperCase() === "A") || variants[0];
    }
  }

  const subject = renderTemplate(chosenVariant?.subjectTpl || step.subjectTpl, {
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    company: lead.company,
    website: lead.website,
    senderName: mailbox.name,
    senderEmail: mailbox.fromEmail,
  });

  const bodyText = renderTemplate(chosenVariant?.bodyTpl || step.bodyTpl, {
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    company: lead.company,
    website: lead.website,
    senderName: mailbox.name,
    senderEmail: mailbox.fromEmail,
  });

  // create message row first so tracking has id
  const msg = await prisma.message.create({
    data: {
      workspaceId,
      campaignId: camp.id,
      mailboxId: mailbox.id,
      leadId: lead.id,
      stepNumber: enr.currentStep,
      stepVariantId: chosenVariant?.id || null,
      subject,
      bodyText,
      status: "queued",
    },
  });

  // Build HTML version from text (simple)
  let html = bodyText
    .split("\n")
    .map((l) => `<p>${escapeHtml(l)}</p>`)
    .join("");
  html = wrapClickTracking(html, msg.id);
  html = injectTracking(html, msg.id, true);

  const textTracked = wrapClickTracking(bodyText, msg.id);

  try {
    const fromDomain = (mailbox.fromEmail.split("@")[1] || "local").trim();
const forcedMessageId = `<${msg.id}@${fromDomain}>`;
const listUnsub = `${env.PUBLIC_APP_URL}/t/unsub?m=${encodeURIComponent(msg.id)}&email=${encodeURIComponent(lead.email)}&mb=${mailbox.id}`;

const res = await sendEmail({
  mailboxId: mailbox.id,
  to: lead.email,
  subject,
  text: textTracked,
  html,
  messageId: msg.messageId || forcedMessageId,
  headers: {
    "X-Campaign-Id": camp.id,
    "X-Enrollment-Id": enr.id,
    "X-Message-Id": msg.id,
    "List-Unsubscribe": `<${listUnsub}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  },
});

    await prisma.message.update({
      where: { id: msg.id },
      data: { status: "sent", sentAt: new Date(), messageId: res.messageId || undefined },
    });

    await prisma.event.create({ data: { messageId: msg.id, type: "sent" } });

    // deliverability guardrails (auto-pause) - best effort
    await maybeAutoPauseCampaign(camp.id).catch(() => {});

    await dispatchWebhooks(workspaceId, "sent", { messageId: msg.id, to: lead.email, campaignId: camp.id });

    // schedule next step
    const nextStep = enr.currentStep + 1;
    const next = await prisma.sequenceStep.findFirst({ where: { campaignId: camp.id, stepNumber: nextStep } });
    if (!next) {
      await prisma.enrollment.update({ where: { id: enr.id }, data: { status: "completed" } });
      return;
    }

    const nextRunAt = dayjs().add(next.delayDays, "day").toDate();
    await prisma.enrollment.update({
      where: { id: enr.id },
      data: { currentStep: nextStep, nextRunAt },
    });

    await prisma.job.create({
      data: {
        type: "send_next_step",
        payload: JSON.stringify({ enrollmentId: enr.id, workspaceId }),
        runAt: nextRunAt,
        status: "queued",
      },
    });
  } catch (e: any) {
    const err = String(e?.message || e);
    const c = classifySmtpError(err);
    const isHard = c.bounceClass === "hard";
    const isSoft = c.bounceClass === "soft";

    await prisma.message
      .update({
        where: { id: msg.id },
        data: {
          status: isHard ? "bounced" : "failed",
          error: err,
          smtpCode: c.smtpCode ?? null,
          bounceType: c.bounceType ?? null,
        },
      })
      .catch(() => {});

    const evType = isHard ? "bounce_hard" : isSoft ? "bounce_soft" : "failed";
    await prisma.event
      .create({ data: { messageId: msg.id, type: evType, meta: JSON.stringify({ error: err, smtpCode: c.smtpCode, bounceType: c.bounceType }) } })
      .catch(() => {});

    // deliverability guardrails (auto-pause) - best effort
    if (isHard || isSoft) {
      await maybeAutoPauseCampaign(camp.id).catch(() => {});

      // Auto mailbox throttling: if a specific sender spikes bounces, put it on cooldown.
      await maybeThrottleMailboxOnSpike(camp as any, mailbox.id).catch(() => {});
    }

    // Hard bounce: suppress + optionally stop
    if (isHard) {
      if (camp.stopOnBounce) {
        await prisma.enrollment.update({ where: { id: enr.id }, data: { status: "stopped", stopReason: "bounce" } }).catch(() => {});
      }
      await prisma.lead.update({ where: { id: lead.id }, data: { status: "bounced" } }).catch(() => {});
      await prisma.suppression
        .upsert({
          where: { workspaceId_email: { workspaceId, email: lead.email } },
          update: { reason: "bounce" },
          create: { workspaceId, email: lead.email, reason: "bounce" },
        })
        .catch(() => {});
      await dispatchWebhooks(workspaceId, "bounce", { messageId: msg.id, to: lead.email, error: err, campaignId: camp.id }).catch(() => {});
      return;
    }

    // Soft bounce: retry later (keeps enrollment active)
    if (isSoft) {
      const retryAt = dayjs().add(6, "hour").toDate();
      await prisma.enrollment
        .update({ where: { id: enr.id }, data: { nextRunAt: retryAt } })
        .catch(() => {});
      await prisma.job
        .create({ data: { type: "send_next_step", payload: JSON.stringify({ enrollmentId: enr.id, workspaceId }), runAt: retryAt, status: "queued" } })
        .catch(() => {});
      return;
    }
  }
}



function getJobStaleMinutes(): number {
  const v = process.env.IMAP_JOB_STALE_MINUTES || process.env.JOB_STALE_MINUTES || "5";
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

async function recoverStaleRunningJobs() {
  const imapDebug = String(process.env.DEBUG_IMAP || "") === "1";
  const staleMs = getJobStaleMinutes() * 60 * 1000;
  const cutoff = new Date(Date.now() - staleMs);

  // Re-queue stale running jobs (for example if worker crashed previously)
  const res1 = await prisma.job.updateMany({
    where: {
      status: "running",
      OR: [{ lockedAt: null }, { lockedAt: { lt: cutoff } }],
    },
    data: { status: "queued", lockedAt: null },
  }).catch(() => null);

  if (imapDebug && res1) {
    console.log("[worker] recovered stale running jobs", { count: res1.count, staleMinutes: getJobStaleMinutes() });
  }
}


async function enqueueImapSyncJobs() {
  const imapDebug = String(process.env.DEBUG_IMAP || "") === "1";

  const mailboxes = await prisma.mailbox.findMany({
    where: { isActive: true, imapHost: { not: null }, imapUser: { not: null }, imapPassEnc: { not: null } },
    select: { id: true },
  });

  if (imapDebug) {
    console.log("[imap] sweep", { mailboxes: mailboxes.length });
  }

  let enqueued = 0;
  let skipped = 0;

  for (const mb of mailboxes) {
    const already = await prisma.job.findFirst({
      where: { type: "sync_imap", status: { in: ["queued", "running"] }, payload: { contains: mb.id } },
      select: { id: true, status: true, lockedAt: true, createdAt: true },
    });

    if (already) {
      const staleMs = getJobStaleMinutes() * 60 * 1000;
      const cutoff = new Date(Date.now() - staleMs);
      const isStaleRunning =
        already.status === "running" && (!already.lockedAt || already.lockedAt < cutoff);

      if (isStaleRunning) {
        await prisma.job
          .update({
            where: { id: already.id },
            data: { status: "failed", lastError: `stale sync_imap job (>${getJobStaleMinutes()}m) auto-cleared` },
          })
          .catch(() => {});
        if (imapDebug) {
          console.log("[imap] stale job cleared", {
            mailboxId: mb.id,
            jobId: already.id,
            status: already.status,
            lockedAt: already.lockedAt,
          });
        }
      } else {
        skipped++;
        if (imapDebug) {
          console.log("[imap] skip enqueue", {
            mailboxId: mb.id,
            reason: "job_exists",
            jobId: already.id,
            status: already.status,
            lockedAt: already.lockedAt,
          });
        }
        continue;
      }
    }

    try {
      await prisma.job.create({
        data: { type: "sync_imap", payload: JSON.stringify({ mailboxId: mb.id }), runAt: new Date(), status: "queued" },
      });
      enqueued++;
    } catch {
      // ignore
    }
  }

  if (imapDebug) {
    console.log("[imap] sweep done", { enqueued, skipped });
  }
}



function safeJsonParse(v: any) {
  try {
    return JSON.parse(String(v || "{}"));
  } catch {
    return null;
  }
}

function isHealthOk(r: any): boolean {
  if (!r) return false;
  const smtp = r.smtp;
  const imap = r.imap;
  if (smtp) {
    if (!smtp.ok) return false;
  }
  if (imap) {
    if (imap.skipped) return true;
    if (!imap.ok) return false;
  }
  return true;
}

async function enqueueMailboxHealthcheckSweep() {
  if (!env.AUTO_HEALTHCHECK_ENABLED) return;

  const mailboxes = await prisma.mailbox.findMany({
    where: { isActive: true },
    select: { id: true, workspaceId: true },
  });

  if (!mailboxes.length) return;

  // Latest done/failed per mailbox
  const recent = await prisma.job.findMany({
    where: { type: "mailbox_healthcheck", status: { in: ["done", "failed"] } },
    orderBy: { createdAt: "desc" },
    take: 2000,
    select: { payload: true, lastError: true, createdAt: true, status: true },
  });

  const latest = new Map<string, { createdAt: Date; status: string; result: any }>();
  for (const j of recent as any[]) {
    const p = safeJsonParse(j.payload);
    if (!p) continue;
    const mbid = String(p.mailboxId || "");
    if (!mbid) continue;
    if (!latest.has(mbid)) {
      const r = safeJsonParse(j.lastError);
      latest.set(mbid, { createdAt: j.createdAt, status: j.status, result: r });
    }
  }

  const staleCutoff = new Date(Date.now() - env.HEALTHCHECK_STALE_HOURS * 60 * 60 * 1000);

  let enqueued = 0;
  let skipped = 0;

  for (const mb of mailboxes as any[]) {
    if (enqueued >= 200) break;

    const pending = await prisma.job.findFirst({
      where: { type: "mailbox_healthcheck", status: { in: ["queued", "running"] }, payload: { contains: mb.id } },
      select: { id: true },
    });

    if (pending) {
      skipped++;
      continue;
    }

    const last = latest.get(mb.id);
    let should = false;

    if (!last) {
      should = true;
    } else {
      if (last.createdAt < staleCutoff) should = true;
      if (!should) {
        const ok = isHealthOk(last.result);
        if (!ok || String(last.status) === "failed") should = true;
      }
    }

    if (!should) continue;

    try {
      await prisma.job.create({
        data: {
          type: "mailbox_healthcheck",
          payload: JSON.stringify({ workspaceId: mb.workspaceId, mailboxId: mb.id, mode: "both", source: "auto" }),
          runAt: new Date(),
          status: "queued",
        },
      });
      enqueued++;
    } catch {
      // ignore
    }
  }

  console.log("[healthcheck] sweep", { total: mailboxes.length, enqueued, skipped, staleHours: env.HEALTHCHECK_STALE_HOURS });
}

async function enqueueDomainDnsCheckSweep() {
  if (!env.AUTO_DOMAIN_DNSCHECK_ENABLED) return;

  const domains = await prisma.domain.findMany({
    select: { id: true, workspaceId: true, name: true },
  });

  if (!domains.length) return;

  const recent = await prisma.job.findMany({
    where: { type: "domain_dns_check", status: { in: ["done", "failed"] } },
    orderBy: { createdAt: "desc" },
    take: 2000,
    select: { payload: true, lastError: true, createdAt: true },
  });

  const latest = new Map<string, { createdAt: Date; result: any }>();
  for (const j of recent as any[]) {
    const p = safeJsonParse(j.payload);
    if (!p) continue;
    const did = String(p.domainId || "");
    if (!did) continue;
    if (!latest.has(did)) {
      const r = safeJsonParse(j.lastError);
      latest.set(did, { createdAt: j.createdAt, result: r });
    }
  }

  const staleCutoff = new Date(Date.now() - env.DOMAIN_DNSCHECK_STALE_HOURS * 60 * 60 * 1000);
  let enqueued = 0;
  let skipped = 0;

  for (const d of domains as any[]) {
    if (enqueued >= 150) break;

    const pending = await prisma.job.findFirst({
      where: { type: "domain_dns_check", status: { in: ["queued", "running"] }, payload: { contains: d.id } },
      select: { id: true },
    });
    if (pending) {
      skipped++;
      continue;
    }

    const last = latest.get(d.id);
    let should = false;
    if (!last) {
      should = true;
    } else {
      if (last.createdAt < staleCutoff) should = true;
      const st = String(last?.result?.summary?.status || "");
      if (st === "fail") should = true;
    }
    if (!should) continue;

    try {
      await prisma.job.create({
        data: {
          type: "domain_dns_check",
          payload: JSON.stringify({ workspaceId: d.workspaceId, domainId: d.id, source: "auto" }),
          runAt: new Date(),
          status: "queued",
        },
      });
      enqueued++;
    } catch {
      // ignore
    }
  }

  console.log("[domain-dns] sweep", { total: domains.length, enqueued, skipped, staleHours: env.DOMAIN_DNSCHECK_STALE_HOURS });
}

function cleanMsgId(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/<[^>]+>/);
  return (m ? m[0] : s) || null;
}

function keywordList(v: any): string[] {
  if (!v) return [];
  return String(v)
    .split(/[\n,]/g)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function anyKeywordIn(blob: string, keys: string[]): boolean {
  if (!blob) return false;
  const b = blob.toLowerCase();
  for (const k of keys) {
    const kk = (k || "").toString().trim().toLowerCase();
    if (!kk) continue;
    if (b.includes(kk)) return true;
  }
  return false;
}


function getHeader(parsed: any, key: string): string | null {
  try {
    const h = (parsed as any)?.headers;
    if (h && typeof h.get === "function") {
      const v = h.get(String(key).toLowerCase());
      if (v == null) return null;
      return String(v);
    }
  } catch {
    // ignore
  }
  return null;
}

function detectBounceEmail(parsed: any, bodyText: string, bodyHtml: string) {
  const fromAddr = (parsed as any)?.from?.value?.[0]?.address ? String((parsed as any).from.value[0].address).toLowerCase() : "";
  const fromText = (parsed as any)?.from?.text ? String((parsed as any).from.text).toLowerCase() : "";
  const subject = (parsed as any)?.subject ? String((parsed as any).subject).toLowerCase() : "";

  const ct = (getHeader(parsed, "content-type") || "").toLowerCase();
  const autoSubmitted = (getHeader(parsed, "auto-submitted") || "").toLowerCase();
  const returnPath = (getHeader(parsed, "return-path") || "").toLowerCase();
  const xFailed = (getHeader(parsed, "x-failed-recipients") || "").toLowerCase();
  const precedence = (getHeader(parsed, "precedence") || "").toLowerCase();

  // NOTE: Many DSNs keep the important fields (Final-Recipient / Diagnostic-Code / Status) inside
  // a delivery-status part which some parsers won't include in parsed.text.
  // So we:
  // 1) Trust Content-Type multipart/report delivery-status
  // 2) Trust obvious MAILER-DAEMON / postmaster senders + strong subject
  // 3) Scan whatever body text we do have for DSN markers
  const bodyStripped = bodyHtml ? stripHtml(String(bodyHtml)) : "";
  const text = `${subject}\n${bodyText || ""}\n${bodyStripped}`.toLowerCase();

  const hasReport = ct.includes("multipart/report") && (ct.includes("delivery-status") || ct.includes("report-type=delivery-status"));

  const hasDeliveryStatusPart = Array.isArray((parsed as any)?.attachments)
    ? (parsed as any).attachments.some((a: any) => {
        const t = String(a?.contentType || "").toLowerCase();
        return t.includes("message/delivery-status") || t.includes("delivery-status");
      })
    : false;

  const isMailerDaemon =
    fromAddr.includes("mailer-daemon") ||
    fromText.includes("mailer-daemon") ||
    fromText.includes("mail delivery subsystem") ||
    fromAddr.includes("postmaster") ||
    fromText.includes("postmaster") ||
    fromText.includes("mail delivery system");

  const subjBounce =
    subject.includes("undelivered") ||
    subject.includes("delivery status notification") ||
    subject.includes("returned mail") ||
    subject.includes("failure notice") ||
    subject.includes("delivery failure") ||
    subject.includes("mail delivery failed") ||
    subject.includes("returned message to sender") ||
    subject.includes("message delayed") ||
    subject.startsWith("warning:");

  // DSN markers often present in either the human-readable part or the delivery-status part.
  const bodyBounce =
    text.includes("diagnostic-code") ||
    text.includes("final-recipient") ||
    text.includes("original-recipient") ||
    text.includes("action: failed") ||
    text.includes("action: delayed") ||
    text.includes("status:") ||
    text.includes("reporting-mta") ||
    text.includes("remote-mta") ||
    text.includes("smtp error from remote mail server") ||
    text.includes("this is a permanent error") ||
    text.includes("returning message to sender") ||
    text.includes("the email account that you tried to reach does not exist");

  const autoGen =
    autoSubmitted.includes("auto-replied") ||
    autoSubmitted.includes("auto-generated") ||
    precedence.includes("bulk") ||
    precedence.includes("junk") ||
    precedence.includes("auto_reply");

  // DSN status parsing (best-effort)
  let dsnStatus: string | null = null;
  const m = text.match(/\bstatus\s*:\s*([245]\.\d+\.\d+)\b/i);
  if (m && m[1]) dsnStatus = String(m[1]);

  // Soft vs hard (best-effort)
  let bounceClass: "hard" | "soft" = "hard";
  if (dsnStatus && dsnStatus.startsWith("4")) bounceClass = "soft";
  if (!dsnStatus) {
    if (subject.includes("delayed") || text.includes("temporary") || text.includes("try again") || text.includes("temporarily") || text.includes("4.")) {
      bounceClass = "soft";
    }
  }

  // Strong rules (catch plain-text Exim bounces like your example):
  // - MAILER-DAEMON + bounce-like subject is enough even if parser didn't include DSN body.
  const strongMailerSubject = isMailerDaemon && subjBounce;

  const isBounce = Boolean(
    hasReport ||
      hasDeliveryStatusPart ||
      xFailed ||
      strongMailerSubject ||
      ((isMailerDaemon || subjBounce) && bodyBounce) ||
      (isMailerDaemon && autoGen) ||
      // extra safety: empty return-path is common for DSNs
      ((returnPath.includes("<>") || returnPath.trim() === "") && subjBounce)
  );

  return {
    isBounce,
    bounceClass,
    dsnStatus,
    reason: hasReport
      ? "dsn_report"
      : hasDeliveryStatusPart
      ? "delivery_status_part"
      : xFailed
      ? "x_failed_recipients"
      : strongMailerSubject
      ? "mailer_daemon_subject"
      : isMailerDaemon
      ? "mailer_daemon"
      : subjBounce
      ? "subject"
      : "heuristic",
  };
}

async function handleSyncImap(payload: any) {
  const { mailboxId } = payload;
  const mb = await prisma.mailbox.findUnique({ where: { id: mailboxId } });
  if (!mb || !mb.isActive || !mb.imapHost || !mb.imapUser || !mb.imapPassEnc) return;

  const pass = decrypt(mb.imapPassEnc);

  // Enable verbose IMAP protocol logging only when DEBUG_IMAP=1
  const imapDebug = String(process.env.DEBUG_IMAP || "") === "1";

  const client = new ImapFlow({
    host: mb.imapHost,
    port: mb.imapPort,
    secure: mb.imapSecure,
    auth: { user: mb.imapUser, pass },

    // TEMP workaround: allow skipping TLS certificate hostname verification for IMAP only.
    // When imapTlsSkipVerify is enabled, we skip CA/hostname validation (NOT recommended for production).
    tls: mb.imapTlsSkipVerify
      ? { rejectUnauthorized: false, servername: mb.imapHost }
      : { servername: mb.imapHost },

    // Print raw IMAP traffic only in debug mode.
    logger: imapDebug ? console : (false as any),
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
			// We store checkpoint as UID, so FETCH must use UID ranges.
			// ImapFlow's fetch() signature is fetch(range, query, options) where options.uid=true means range contains UIDs.
			// Also: avoid ranges like "1:*" when the mailbox is empty (Dovecot returns "Invalid messageset").
			const startUid = (mb.imapLastUid || 0) + 1;
			const mailbox = client.mailbox || null;
			const uidNext = mailbox?.uidNext || 1; // next UID that would be assigned
			const endUid = uidNext - 1; // last existing UID

			// Nothing to fetch (empty mailbox or no new messages since last checkpoint)
			if (endUid < startUid) {
				return;
			}

			const range = `${startUid}:${endUid}`;
			for await (const msg of client.fetch(range, { uid: true, envelope: true, source: true, flags: true }, { uid: true })) {
        const uid = (msg as any).uid as number;
        if (!uid) continue;

        const parsed = await simpleParser((msg as any).source);
        const inReplyTo = cleanMsgId(parsed.inReplyTo);
        const rawRefs: any = (parsed as any).references;
        let refList: any[] = [];
        if (Array.isArray(rawRefs)) refList = rawRefs;
        else if (typeof rawRefs === "string") refList = rawRefs.split(/\s+/).filter(Boolean);
        else if (rawRefs && typeof (rawRefs as any)[Symbol.iterator] === "function") refList = Array.from(rawRefs as any);
        else if (rawRefs) refList = [rawRefs];
        const refs = refList.map(cleanMsgId).filter(Boolean) as string[];
        const candidates = [inReplyTo, ...refs].filter(Boolean) as string[];
        if (candidates.length === 0) {
          await prisma.mailbox.update({ where: { id: mb.id }, data: { imapLastUid: Math.max(mb.imapLastUid || 0, uid) } }).catch(()=>{});
          continue;
        }

        if (imapDebug) {
          console.log("[imap] parsed", {
            uid,
            subject: parsed.subject || null,
            from: parsed.from?.text || null,
            inReplyTo,
            refs,
            candidates,
          });
        }

        // Find an outbound message in this workspace that matches any reference id.
        // Some outbound rows may have mailboxId=NULL (eg. test emails or older data), so allow both.
        let out = await prisma.message.findFirst({
          where: {
            workspaceId: mb.workspaceId,
            messageId: { in: candidates },
            OR: [{ mailboxId: mb.id }, { mailboxId: null }],
          },
          include: { campaign: true, lead: true },
        });

        // Fallback matcher: some clients (or forwarded replies) may omit In-Reply-To/References.
        // If we can identify the sender email, match to the most recent sent message to that lead.
        if (!out) {
          const senderAddr = (parsed as any)?.from?.value?.[0]?.address
            ? String((parsed as any).from.value[0].address).toLowerCase()
            : null;
          if (senderAddr) {
            const lead = await prisma.lead
              .findUnique({ where: { workspaceId_email: { workspaceId: mb.workspaceId, email: senderAddr } } })
              .catch(() => null);
            if (lead) {
              out = await prisma.message.findFirst({
                where: {
                  workspaceId: mb.workspaceId,
                  leadId: lead.id,
                  OR: [{ mailboxId: mb.id }, { mailboxId: null }],
                  status: { in: ["sent", "replied"] },
                  sentAt: { not: null },
                },
                orderBy: { sentAt: "desc" },
                include: { campaign: true, lead: true },
              });
            }
          }
        }

        if (imapDebug) {
          console.log("[imap] match", { uid, matched: Boolean(out), outId: out?.id || null, outMessageId: out?.messageId || null });
        }

        if (out) {
          // Allow MULTIPLE replies per outbound message.
          // We dedupe on the inbound reply's Message-ID when available; otherwise on (mailboxId, uid).
          const replyMessageId = cleanMsgId((parsed as any)?.messageId) || null;

          const already = replyMessageId
            ? await prisma.event.findFirst({
                where: {
                  messageId: out.id,
                  type: "reply",
                  // meta is stored as a compact JSON string (JSON.stringify), so this is stable.
                  meta: { contains: `"replyMessageId":"${replyMessageId}"` },
                },
              })
            : await prisma.event.findFirst({
                where: {
                  messageId: out.id,
                  type: "reply",
                  AND: [
                    { meta: { contains: `"mailboxId":"${mb.id}"` } },
                    { meta: { contains: `"uid":${uid}` } },
                  ],
                },
              });
          // Extract inbound reply content once (so we can both create and reconcile).
          const fromAddress = (parsed as any)?.from?.value?.[0]?.address
            ? String((parsed as any).from.value[0].address).toLowerCase()
            : null;

          const bodyTextRaw = (parsed.text || "").toString();
          const bodyHtmlRaw = typeof parsed.html === "string" ? parsed.html : parsed.html ? String(parsed.html) : "";
          const bodyText = bodyTextRaw?.trim() || (bodyHtmlRaw ? stripHtml(bodyHtmlRaw) : "").trim();
          const snippet = (bodyText || "").replace(/\s+/g, " ").trim().slice(0, 240) || null;

          // Cap stored payload sizes to avoid huge meta rows from long threads.
          const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

          const blob = `${(parsed.subject || "").toString()}\n${(bodyText || "").toString()}`.toLowerCase();

          const bounce = detectBounceEmail(parsed, bodyText || "", bodyHtmlRaw || "");
          if (bounce.isBounce) {
            const bounceMessageId = cleanMsgId((parsed as any)?.messageId) || null;
            const evType = bounce.bounceClass === "soft" ? "bounce_soft" : "bounce_hard";

            const existingBounce = bounceMessageId
              ? await prisma.event.findFirst({
                  where: {
                    messageId: out.id,
                    type: { in: ["bounce_hard", "bounce_soft", "bounce"] },
                    meta: { contains: `"bounceMessageId":"${bounceMessageId}"` },
                  },
                })
              : await prisma.event.findFirst({
                  where: {
                    messageId: out.id,
                    type: { in: ["bounce_hard", "bounce_soft", "bounce"] },
                    AND: [{ meta: { contains: `"mailboxId":"${mb.id}"` } }, { meta: { contains: `"uid":${uid}` } }],
                  },
                });

            if (!existingBounce) {
              await prisma.event
                .create({
                  data: {
                    messageId: out.id,
                    type: evType,
                    meta: JSON.stringify({
                      mailboxId: mb.id,
                      from: parsed.from?.text || null,
                      fromAddress,
                      subject: parsed.subject || null,
                      date: parsed.date ? parsed.date.toISOString() : null,
                      bounceMessageId,
                      dsnStatus: bounce.dsnStatus || null,
                      reason: bounce.reason || null,
                      snippet,
                      uid,
                    }),
                  },
                })
                .catch(() => {});
            }


            // If this DSN was previously mis-classified as a reply, remove that reply event (best-effort).
            try {
              if (bounceMessageId) {
                await prisma.event.deleteMany({
                  where: { messageId: out.id, type: "reply", meta: { contains: `"replyMessageId":"${bounceMessageId}"` } },
                });
              } else {
                await prisma.event.deleteMany({
                  where: {
                    messageId: out.id,
                    type: "reply",
                    AND: [{ meta: { contains: `"mailboxId":"${mb.id}"` } }, { meta: { contains: `"uid":${uid}` } }],
                  },
                });
              }
            } catch {
              // ignore
            }

            const err = `DSN bounce (${bounce.reason}${bounce.dsnStatus ? `, ${bounce.dsnStatus}` : ""})${snippet ? `: ${snippet}` : ""}`;

            await prisma.message
              .update({
                where: { id: out.id },
                data: {
                  status: bounce.bounceClass === "soft" ? "failed" : "bounced",
                  error: err.slice(0, 2000),
                  smtpCode: null,
                  bounceType: "dsn",
                },
              })
              .catch(() => {});

            // deliverability guardrails - best effort
            if (out.campaignId) {
              await maybeAutoPauseCampaign(String(out.campaignId)).catch(() => {});
              const campAny: any = out.campaign as any;
              if (campAny) {
                await maybeThrottleMailboxOnSpike(campAny, mb.id).catch(() => {});
              }
            }

            // Hard bounce: suppress + optionally stop
            if (bounce.bounceClass !== "soft") {
              if (out.leadId) {
                await prisma.lead
                  .updateMany({
                    where: { id: out.leadId, status: { notIn: ["unsubscribed"] } },
                    data: { status: "bounced" },
                  })
                  .catch(() => {});

                await prisma.suppression
                  .upsert({
                    where: { workspaceId_email: { workspaceId: mb.workspaceId, email: out.lead?.email || "" } },
                    update: { reason: "bounce" },
                    create: { workspaceId: mb.workspaceId, email: out.lead?.email || "", reason: "bounce" },
                  })
                  .catch(() => {});
              }

              const camp2: any = out.campaign as any;
              if (out.campaignId && out.leadId && camp2?.stopOnBounce) {
                await prisma.enrollment
                  .updateMany({
                    where: { campaignId: out.campaignId, leadId: out.leadId, status: { in: ["queued", "active"] } },
                    data: { status: "stopped", stopReason: "bounce" },
                  })
                  .catch(() => {});
              }

              await dispatchWebhooks(mb.workspaceId, "bounce", {
                mailboxId: mb.id,
                messageId: out.id,
                leadEmail: out.lead?.email || null,
                error: err.slice(0, 2000),
                campaignId: out.campaignId || null,
              }).catch(()=>{});
            }
          } else {

          if (already) {
            // Backfill body/meta for older rows that were created before we stored reply body.
            // This will only run if you re-scan the message (eg. by lowering imapLastUid for that mailbox).
            try {
              let oldMeta: any = {};
              try { oldMeta = JSON.parse(already.meta || "{}"); } catch { oldMeta = {}; }

              if (!oldMeta?.bodyText && !oldMeta?.bodyHtml) {
                await prisma.event.update({
                  where: { id: already.id },
                  data: {
                    meta: JSON.stringify({
                      ...oldMeta,
                      mailboxId: oldMeta.mailboxId || mb.id,
                      from: oldMeta.from || parsed.from?.text || null,
                      fromAddress: oldMeta.fromAddress || fromAddress,
                      subject: oldMeta.subject || parsed.subject || null,
                      date: oldMeta.date || (parsed.date ? parsed.date.toISOString() : null),
                      replyMessageId: oldMeta.replyMessageId || cleanMsgId((parsed as any)?.messageId) || null,
                      bodyText: bodyText ? clip(bodyText, 200_000) : null,
                      bodyHtml: bodyHtmlRaw ? clip(bodyHtmlRaw, 200_000) : null,
                      snippet: oldMeta.snippet || snippet,
                      uid: oldMeta.uid || uid,
                    }),
                  },
                }).catch(()=>{});
              }
            } catch {
              // ignore backfill errors
            }
          }

          let created = false;
          if (!already) {
            created = true;
            // Store enough metadata to render the reply nicely in the UI.
            let replyEventId: string | null = null;
            const createdEvent = await prisma.event.create({
              data: {
                messageId: out.id,
                type: "reply",
                meta: JSON.stringify({
                  mailboxId: mb.id,
                  from: parsed.from?.text || null,
                  fromAddress,
                  subject: parsed.subject || null,
                  date: parsed.date ? parsed.date.toISOString() : null,
                  replyMessageId: cleanMsgId((parsed as any)?.messageId) || null,
                  bodyText: bodyText ? clip(bodyText, 200_000) : null,
                  bodyHtml: bodyHtmlRaw ? clip(bodyHtmlRaw, 200_000) : null,
                  snippet,
                  uid,
                }),
              },
            }).catch(() => null as any);
            replyEventId = createdEvent?.id || null;

            // AI auto-triage / auto-reply (best-effort)
            if (replyEventId) {
              const ws = await prisma.workspace.findUnique({ where: { id: mb.workspaceId }, select: { name: true, settingsJson: true } }).catch(() => null as any);
              const leadName = [out.lead?.firstName, out.lead?.lastName].filter(Boolean).join(" ") || null;
              await maybeHandleRepliesAi({
                workspaceId: mb.workspaceId,
                workspaceName: ws?.name || "",
                settingsJson: ws?.settingsJson || {},
                mailboxId: mb.id,
                mailboxFromEmail: mb.fromEmail || null,
                campaignName: out.campaign?.name || null,
                leadId: String(out.leadId || ""),
                leadEmail: out.lead?.email || "",
                leadName,
                replyEventId,
                inboundSubject: parsed.subject || null,
                inboundBodyText: clip(bodyText || snippet || "", 20_000),
                lastOutboundSubject: out.subject || null,
                lastOutboundBody: clip(out.bodyText || stripHtml(out.bodyHtml || "") || "", 20_000),
                inReplyTo: cleanMsgId((parsed as any)?.messageId) || out.messageId || null,
                references: out.messageId || null,
              }).catch(() => {});
            }

          }

          // Always reconcile message/lead status and stop rules (even if the reply event already existed).
          await prisma.message.update({ where: { id: out.id }, data: { status: "replied" } }).catch(()=>{});
          if (out.leadId) {
            // Don't overwrite stronger states like unsubscribed/bounced.
            await prisma.lead.updateMany({
              where: { id: out.leadId, status: { notIn: ["unsubscribed", "bounced"] } },
              data: { status: "replied" },
            }).catch(()=>{});
          }

          // stop enrollment if configured
          if (out.campaignId && out.leadId && out.campaign) {
            const camp2: any = out.campaign as any;

            const oooDefaults = ["out of office", "auto-reply", "autoreply", "vacation", "away from the office", "automatic reply"];
            const niDefaults = ["not interested", "no thanks", "stop emailing", "stop e-mailing", "do not contact", "don't contact", "remove me", "take me off", "unsubscribe"];

            const oooKeys = [...keywordList(camp2.oooKeywords), ...oooDefaults];
            const niKeys = [...keywordList(camp2.notInterestedKeywords), ...keywordList(camp2.stopKeywords), ...niDefaults];

            const isOOO = Boolean(camp2.stopOnOOO) && anyKeywordIn(blob, oooKeys);
            const isNI = anyKeywordIn(blob, niKeys);
            const isUnsubReply = anyKeywordIn(blob, ["unsubscribe", "remove me", "do not email", "stop emailing", "opt out"]);

            // If reply contains "unsubscribe"-type language, treat as unsubscribe (best-effort)
            if (isUnsubReply && camp2.stopOnUnsubscribe) {
              await prisma.suppression
                .upsert({
                  where: { workspaceId_email: { workspaceId: mb.workspaceId, email: out.lead?.email || "" } },
                  update: { reason: "unsubscribe" },
                  create: { workspaceId: mb.workspaceId, email: out.lead?.email || "", reason: "unsubscribe" },
                })
                .catch(() => {});
              if (out.leadId) {
                await prisma.lead.update({ where: { id: out.leadId }, data: { status: "unsubscribed" } }).catch(() => {});
              }
              await prisma.enrollment
                .updateMany({
                  where: { campaignId: out.campaignId, leadId: out.leadId, status: { in: ["queued", "active"] } },
                  data: { status: "stopped", stopReason: "unsubscribe" },
                })
                .catch(() => {});
            } else if (camp2.stopOnReply) {
              const reason = isOOO ? "ooo" : isNI ? "not_interested" : "reply";
              await prisma.enrollment
                .updateMany({
                  where: { campaignId: out.campaignId, leadId: out.leadId, status: { in: ["queued", "active"] } },
                  data: { status: "stopped", stopReason: reason },
                })
                .catch(() => {});

              // Tag lead (best-effort)
              if (out.leadId && (isOOO || isNI)) {
                const cur = (out.lead?.tags || "").toString();
                const existing = cur.split(",").map((x) => x.trim()).filter(Boolean);
                const add = isOOO ? "ooo" : "not_interested";
                if (!existing.includes(add)) existing.push(add);
                await prisma.lead.update({ where: { id: out.leadId }, data: { tags: existing.join(",") } }).catch(() => {});
              }
            }
          }

          if (created) {
            await dispatchWebhooks(mb.workspaceId, "reply", {
              mailboxId: mb.id,
              messageId: out.id,
              leadEmail: out.lead?.email || null,
              from: parsed.from?.text || null,
              subject: parsed.subject || null,
            }).catch(()=>{});
          }
          }
        }

        // advance checkpoint
        await prisma.mailbox.update({ where: { id: mb.id }, data: { imapLastUid: Math.max(mb.imapLastUid || 0, uid) } }).catch(()=>{});
      }
    } finally {
      lock.release();
    }
  } catch (e: any) {
    // ImapFlow often throws a generic "Command failed" without printing the server response.
    // Log the structured fields so we can see AUTHENTICATIONFAILED, NO, BAD, etc.
    const details = {
      message: e?.message,
      code: e?.code,
      command: e?.command,
      responseText: e?.responseText,
      responseStatus: e?.response?.status,
      responseCode: e?.response?.code,
    };
    console.warn("[imap] sync failed", mailboxId, details);

    if (String(process.env.DEBUG_IMAP || "") === "1") {
      console.warn("[imap] raw error", e);
    }
  } finally {
    try { await client.logout(); } catch {}
  }
}

async function reconcileReplyStops() {
  // Best-effort reconciliation: if we have replies recorded but enrollments are still active/queued,
  // stop them so the campaign can reach a "completed" derived state.
  try {
    const pairs = await prisma.message.findMany({
      where: {
        status: "replied",
        campaignId: { not: null },
        leadId: { not: null },
      },
      select: { campaignId: true, leadId: true },
      // Message model does not have updatedAt; use createdAt to fetch most recent reply records.
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const conds = pairs
      .filter((p) => p.campaignId && p.leadId)
      .map((p) => ({ campaignId: String(p.campaignId), leadId: String(p.leadId) }));

    if (!conds.length) return;

    await prisma.enrollment.updateMany({
      where: {
        status: { in: ["queued", "active"] },
        campaign: { stopOnReply: true },
        OR: conds,
      },
      data: { status: "stopped", stopReason: "reply" },
    });
  } catch {
    // ignore
  }
}


function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function main() {
  console.log("[worker] starting", new Date().toISOString());
  const imapDebug = String(process.env.DEBUG_IMAP || "") === "1";
  if (imapDebug) {
    console.log("[worker] config", { IMAP_POLL_MINUTES: env.IMAP_POLL_MINUTES, SEND_TICK_SECONDS: env.SEND_TICK_SECONDS });
  }
  await recoverStaleRunningJobs();
  let lastImapSweep = 0;
  let lastHealthSweep = 0;
  let lastDomainSweep = 0;
  let lastWarmupSweep = 0;
  let lastWarmupSeedSweep = 0;
  let lastWarmupMailboxSweep = 0;
  let lastReplyReconcile = 0;
  let lastIdleLog = 0;
  let lastLogRetentionSweep = 0;
  let lastHeartbeat = 0;
  while (true) {
    // periodic IMAP sweep: enqueue sync jobs for active mailboxes
    const now = Date.now();

    // worker heartbeat (used by Warmup Control Center)
    if (now - lastHeartbeat > 60 * 1000) {
      lastHeartbeat = now;
      await appLogAsync({
        level: "info",
        category: "worker",
        event: "heartbeat",
        message: "worker_alive",
        data: {
          pid: process.pid,
          node: process.version,
          sendTickSeconds: env.SEND_TICK_SECONDS,
          imapPollMinutes: env.IMAP_POLL_MINUTES,
        },
      }).catch(() => {});
    }

    // periodic AppLog retention sweep
    if (env.LOG_RETENTION_DAYS && now - lastLogRetentionSweep > 24 * 60 * 60 * 1000) {
      lastLogRetentionSweep = now;
      const cutoff = new Date(Date.now() - env.LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      await prisma.appLog.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch(() => {});
      await appLogAsync({
        level: "info",
        category: "system",
        event: "log_retention",
        message: `AppLog retention sweep complete (days=${env.LOG_RETENTION_DAYS})`,
        data: { cutoff: cutoff.toISOString() },
      }).catch(() => {});
    }

    
    if (now - lastImapSweep > env.IMAP_POLL_MINUTES * 60 * 1000) {
      lastImapSweep = now;
      if (imapDebug) console.log("[imap] sweep tick");
      await enqueueImapSyncJobs().catch((e) => { if (imapDebug) console.warn("[imap] sweep error", String(e?.message || e)); });
    }

    // periodic mailbox healthcheck sweep
    if (now - lastHealthSweep > env.HEALTHCHECK_POLL_MINUTES * 60 * 1000) {
      lastHealthSweep = now;
      await enqueueMailboxHealthcheckSweep().catch(() => {});
    }

    // periodic domain DNS check sweep
    if (now - lastDomainSweep > env.DOMAIN_DNSCHECK_POLL_MINUTES * 60 * 1000) {
      lastDomainSweep = now;
      await enqueueDomainDnsCheckSweep().catch(() => {});
    }

    // periodic warmup sweep
    if (now - lastWarmupSweep > env.WARMUP_POLL_MINUTES * 60 * 1000) {
      lastWarmupSweep = now;
      await enqueueWarmupTickSweep().catch(() => {});
    }

    // periodic warmup seed placement check sweep
    if (now - lastWarmupSeedSweep > env.WARMUP_SEEDCHECK_POLL_MINUTES * 60 * 1000) {
      lastWarmupSeedSweep = now;
      await enqueueWarmupSeedCheckSweep().catch(() => {});
    }

    // periodic warmup internal mailbox placement check sweep
    if (now - lastWarmupMailboxSweep > env.WARMUP_SEEDCHECK_POLL_MINUTES * 60 * 1000) {
      lastWarmupMailboxSweep = now;
      await enqueueWarmupMailboxCheckSweep().catch(() => {});
    }

    // Reconcile reply-based stops periodically (helps older campaigns reach a completed state).
    if (now - lastReplyReconcile > 10 * 60 * 1000) {
      lastReplyReconcile = now;
      await reconcileReplyStops();
    }

    const job = await lockNextJob();
    if (!job) {
      if (imapDebug) {
        const now2 = Date.now();
        if (now2 - lastIdleLog > 30000) {
          lastIdleLog = now2;
          const queued = await prisma.job.count({ where: { status: "queued" } }).catch(() => -1);
          const running = await prisma.job.count({ where: { status: "running" } }).catch(() => -1);
          console.log("[worker] idle", { queued, running });
        }
      }
      await sleep(env.SEND_TICK_SECONDS * 1000);
      continue;
    }

    if (imapDebug) {
      console.log("[worker] job", { id: job.id, type: job.type, runAt: job.runAt });
    }

    let payload: any = null;

    try {
            payload = JSON.parse(job.payload || "{}");
      await executeJob(job, payload);

      await updateJobSafe(job.id, { status: "done", lockedAt: null, lastError: null }, "mark done");
    
} catch (e: any) {
  // Risky: AI suggestions only (never auto-applied). Safe: deterministic fixes auto-applied.
  await maybeLogRiskySuggestion(job, payload, e).catch(() => {});
  const shouldRetry = await maybeAutofixAndRetry(job, payload, e);

  if (shouldRetry) {
    try {
      await executeJob(job, payload);
      await updateJobSafe(job.id, { status: "done", lockedAt: null, lastError: null }, "mark done after AutoFix retry").catch(() => false);
      await logJob(job.id, `✅ Job succeeded after AutoFix retry.`);
      if (payload?.tenantId && job.type !== "mailstack:tenant-reset") {
        await prisma.mailstackTenant
          .updateMany({ where: { id: String(payload.tenantId) }, data: { lastJobStatus: "done" } })
          .catch(() => {});
      }
      continue;
    } catch (e2: any) {
      await logJob(job.id, `❌ Retry after AutoFix failed: ${String(e2?.message || e2)}`);
      // fall through and mark job failed below (increment attempts)
      e = e2;
    }
  }

  

// --------------------
// AIOps: record incident (dedupe by signature)
// --------------------
if (env.AIOPS_ENABLED) {
  const wsId = payload?.workspaceId ? String(payload.workspaceId) : null;
  const errText = String(e?.message || e);
  const jobType = String(job.type || "unknown");
  const safePlan = matchSafeAutofix(jobType, errText);

  // pull last 20 job logs for context
  const recentLines = await prisma.jobLog.findMany({
    where: { jobId: job.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { line: true, createdAt: true },
  }).catch(() => []);

  const evidence = {
    job: { id: job.id, type: jobType, runAt: job.runAt, attempts: job.attempts },
    error: errText,
    payload: (() => { try { return payload; } catch { return undefined; } })(),
    recentJobLogs: (recentLines || []).reverse(),
  };

  const suggestedFixes: any = { actions: [] as any[] };
  if (safePlan) {
    suggestedFixes.actions.push(...(safePlan.commands || []).map((cmd) => ({
      kind: "safe",
      actionType: "shell",
      command: cmd,
      args: {},
    })));
  }

  // Add AI suggestion (suggest-only) into incident
  if (env.AIOPS_AI_ANALYSIS) {
    const sug = await aiSuggestAutofix({
      jobType,
      error: errText,
      context: (() => {
        try {
          return JSON.stringify({ payload, recentJobLogs: (recentLines || []).map((x: any) => x.line) }, null, 2).slice(0, 8000);
        } catch {
          return undefined;
        }
      })(),
    }).catch(() => null as any);

    if (sug) {
      (suggestedFixes as any).ai = sug;
      for (const a of sug.suggestedActions || []) {
        (suggestedFixes.actions as any[]).push({
          kind: String(sug.risk || "risky") === "safe" ? "safe" : "risky",
          actionType: "suggestion",
          command: String(a),
          args: {},
        });
      }
    }
  }

  await upsertOpenIncident({
    workspaceId: wsId,
    severity: "error",
    source: "worker",
    signatureParts: [jobType, errText],
    summary: `Job failed: ${jobType} — ${errText}`.slice(0, 1000),
    evidence,
    suggestedFixes,
  }).catch(() => {});
}

await updateJobSafe(
    job.id,
    {
      status: "failed",
      attempts: { increment: 1 },
      lastError: String(e?.message || e),
      lockedAt: null,
    },
    "mark failed"
  ).catch(() => false);

  await logJob(job.id, `❌ FAILED: ${String(e?.message || e)}`);

  if (payload?.tenantId && job.type !== "mailstack:tenant-reset") {
    await prisma.mailstackTenant
      .updateMany({
        where: { id: String(payload.tenantId) },
        data: { lastJobStatus: "failed" },
      })
      .catch(() => {});
  }
}

  }

  }


// --------------------
// Warmup Suite (Option B)
// --------------------
function warmupMeta(meta?: any) {
  try {
    return meta ? JSON.stringify(meta) : "";
  } catch {
    return String(meta);
  }
}

async function warmupLog(jobId: string, msg: string, meta?: any) {
  if (!env.WARMUP_DEBUG) return;
  const line = meta ? `${msg} ${warmupMeta(meta)}` : msg;
  console.log("[warmup]", line);
  await logJob(jobId, `[warmup] ${line}`).catch(() => {});
}

async function warmupError(jobId: string, msg: string, meta?: any) {
  const line = meta ? `${msg} ${warmupMeta(meta)}` : msg;
  console.error("[warmup]", line);
  await logJob(jobId, `[warmup] ${line}`).catch(() => {});
}

function normalizeMessageId(maybe: any): string | null {
  const s = String(maybe || "").trim();
  if (!s) return null;
  if (s.startsWith("<") && s.endsWith(">")) return s;
  // some libs return plain ids; wrap for RFC5322 headers
  return `<${s.replace(/[<>]/g, "")}>`;
}

async function sendSeedSmtpEmail(args: {
  seed: any;
  to: string;
  subject: string;
  text: string;
  html?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  headers?: Record<string, string>;
  // optional debug logger (job-scoped)
  log?: (msg: string, meta?: any) => Promise<void> | void;
}) {
  const seed = args.seed;
  const host = String(seed.smtpHost || "").trim();

  // NOTE: Port + "secure" are a common source of errors:
  // - port 465 => implicit TLS => secure MUST be true
  // - port 587 => STARTTLS => secure MUST be false
  // If user misconfigures, we auto-normalize to the safe default.
  let port = Number(seed.smtpPort || (seed.smtpSecure ? 465 : 587));
  let secure = Boolean(seed.smtpSecure);
  if (port === 587) secure = false;
  if (port === 465) secure = true;

  const user = String(seed.smtpUser || seed.email || "").trim();
  const pass = seed.smtpPassEnc ? decrypt(seed.smtpPassEnc) : "";

  if (!host || !user || !pass) {
    throw new Error("SEED_SMTP_NOT_CONFIGURED");
  }
  const fromName = String(seed.name || "Seed").trim();
  const from = seed.email ? `"${fromName.replace(/\"/g, "")}" <${seed.email}>` : user;


  // Create transport with sensible defaults.
  // If secure=false (STARTTLS), require TLS upgrade so creds aren't sent in cleartext.
  const mkTransport = (s: boolean, p: number) =>
    nodemailer.createTransport({
      host,
      port: p,
      secure: s,
      requireTLS: !s,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: !env.SMTP_TLS_SKIP_VERIFY,
        servername: host || undefined,
      },
    } as any);

  let transport = mkTransport(secure, port);

  // Extra safety: if a mis-match still slips through (common "wrong version number"),
  // retry once with flipped secure/port pairing.
  const sendWithRetry = async () => {
    try {
      return await transport.sendMail({
        from,
        to: args.to,
        subject: args.subject,
        text: args.text,
        html: args.html || undefined,
        inReplyTo: args.inReplyTo || undefined,
        references: args.references || undefined,
        headers: args.headers || undefined,
        replyTo: seed.email || undefined,
      });
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      const looksLikeTlsMismatch =
        msg.includes("wrong version number") ||
        msg.includes("ssl3_get_record") ||
        msg.includes("SSL routines");
      if (!looksLikeTlsMismatch) throw e;

      // Flip pairing:
      // - If we tried implicit TLS, fall back to STARTTLS on 587
      // - If we tried STARTTLS, fall back to implicit TLS on 465
      const altSecure = !secure;
      const altPort = altSecure ? 465 : 587;

      args.log?.("seed_reply: SMTP retry due to TLS mismatch", {
        host,
        tried: { secure, port },
        retry: { secure: altSecure, port: altPort },
        error: msg.slice(0, 250),
      });

      transport = mkTransport(altSecure, altPort);
      return await transport.sendMail({
        from,
        to: args.to,
        subject: args.subject,
        text: args.text,
        html: args.html || undefined,
        inReplyTo: args.inReplyTo || undefined,
        references: args.references || undefined,
        headers: args.headers || undefined,
        replyTo: seed.email || undefined,
      });
    }
  };

  return sendWithRetry();
}

function getLocalMinutes(date: Date, timeZone: string): { minutes: number; weekday: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    }).formatToParts(date);
    const hh = Number(parts.find((p) => p.type === "hour")?.value || "0");
    const mm = Number(parts.find((p) => p.type === "minute")?.value || "0");
    const wd = parts.find((p) => p.type === "weekday")?.value || "Mon";
    const map: any = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { minutes: hh * 60 + mm, weekday: map[wd] ?? 1 };
  } catch {
    return { minutes: date.getUTCHours() * 60 + date.getUTCMinutes(), weekday: date.getUTCDay() };
  }
}

function inWindow(now: Date, tz: string, startMin: number, endMin: number, weekdaysOnly: boolean) {
  const { minutes, weekday } = getLocalMinutes(now, tz || "UTC");
  if (weekdaysOnly && (weekday === 0 || weekday === 6)) return false;
  if (startMin === endMin) return true;
  if (startMin < endMin) return minutes >= startMin && minutes <= endMin;
  // overnight window (eg 22:00-06:00)
  return minutes >= startMin || minutes <= endMin;
}

function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

async function ensureWarmupProfile(workspaceId: string, mailboxId: string) {
  const existing = await prisma.warmupProfile.findUnique({ where: { mailboxId } });
  if (existing) return existing;
  return prisma.warmupProfile.create({
    data: {
      workspaceId,
      mailboxId,
      mode: "hybrid",
      startPerDay: 2,
      increasePerDay: 1,
      maxPerDay: 10,
      timezone: "UTC",
      windowStartMin: 540,
      windowEndMin: 1020,
      weekdaysOnly: true,
      isActive: true,
      startedAt: new Date(),
    } as any,
  });
}

async function pickWarmupTemplate(workspaceId: string, type: "initial" | "reply") {
  const list = await prisma.warmupTemplate.findMany({
    where: { workspaceId, type, isActive: true },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { subject: true, text: true, html: true },
  });
  if (list.length) return list[Math.floor(Math.random() * list.length)];
  if (type === "reply") {
    // NOTE: keep this as a single string literal (no raw newlines) to avoid TS/esbuild parse errors.
    return { subject: "Re: [WU]", text: "Thanks! Appreciate it.\n\nHave a great day.", html: null };
  }
  // NOTE: keep as a single literal (no raw newlines).
  return { subject: "[WU] Quick question", text: "Hey! Quick question — are you using any tool to manage outbound email?\n\nJust curious. Thanks!", html: null };
}

async function handleWarmupTick(jobId: string, payload: any) {
  const workspaceId = String(payload?.workspaceId || "");
  const mailboxId = String(payload?.mailboxId || "");
  const force = Boolean(payload?.force);
  if (!workspaceId || !mailboxId) {
    await warmupError(jobId, "tick: missing workspaceId/mailboxId", { workspaceId, mailboxId });
    return;
  }

  const mb = await prisma.mailbox.findFirst({
    where: { id: mailboxId, workspaceId },
    select: { id: true, isActive: true, warmupEnabled: true, fromEmail: true, name: true },
  });
  if (!mb) {
    await warmupError(jobId, "tick: mailbox not found", { workspaceId, mailboxId });
    return;
  }
  if (!mb.isActive) {
    await warmupLog(jobId, "tick: mailbox inactive (skipping)", { mailboxId, fromEmail: mb.fromEmail });
    return;
  }
  if (!mb.warmupEnabled) {
    await warmupLog(jobId, "tick: warmupEnabled=false (enable Warmup toggle in UI)", { mailboxId, fromEmail: mb.fromEmail });
    return;
  }

  const prof = await ensureWarmupProfile(workspaceId, mailboxId);
  if (!prof.isActive) {
    await warmupLog(jobId, "tick: warmup profile inactive", { mailboxId });
    return;
  }

  const now = new Date();
  if (!force && !inWindow(now, prof.timezone, prof.windowStartMin, prof.windowEndMin, prof.weekdaysOnly)) {
    const lm = getLocalMinutes(now, prof.timezone || "UTC");
    await warmupLog(jobId, "tick: outside sending window", {
      mailboxId,
      tz: prof.timezone,
      localMinutes: lm.minutes,
      windowStartMin: prof.windowStartMin,
      windowEndMin: prof.windowEndMin,
      weekdaysOnly: prof.weekdaysOnly,
      weekday: lm.weekday,
    });
    return;
  }

  const targetPerDay = warmupTargetForToday({
    now,
    startedAt: new Date(prof.startedAt as any),
    startPerDay: prof.startPerDay,
    increasePerDay: prof.increasePerDay,
    maxPerDay: prof.maxPerDay,
    weekdaysOnly: prof.weekdaysOnly,
    timeZone: prof.timezone || "UTC",
  });

  const dayStart = startOfLocalDayUtc(now, prof.timezone || "UTC");
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const sentToday = await prisma.warmupMessage.count({
    where: { workspaceId, mailboxId, direction: "outbound", sentAt: { gte: dayStart, lt: dayEnd } },
  });
  if (sentToday >= targetPerDay) {
    await warmupLog(jobId, "tick: already met target for today", { mailboxId, sentToday, targetPerDay });
    return;
  }

  // Pacing: avoid bursty warmup sends (looks unnatural + can hurt deliverability).
  const minGapMin = env.WARMUP_MIN_GAP_MINUTES ?? 15;
  if (!force && minGapMin > 0) {
    const last = await prisma.warmupMessage.findFirst({
      where: { workspaceId, mailboxId, direction: "outbound", sentAt: { not: null } },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    });
    if (last?.sentAt) {
      const deltaMin = (now.getTime() - new Date(last.sentAt as any).getTime()) / 60000;
      if (deltaMin < minGapMin) {
        await warmupLog(jobId, "tick: pacing (min gap)", { mailboxId, sentToday, targetPerDay, minGapMin, deltaMin });
        return;
      }
    }
  }

  await warmupLog(jobId, "tick: starting", {
    mailboxId,
    fromEmail: mb.fromEmail,
    mode: prof.mode,
    sentToday,
    targetPerDay,
  });

  // Pick target according to mode
  const seeds = await prisma.warmupSeedInbox.findMany({
    where: { workspaceId, isActive: true },
    select: { id: true, email: true },
    take: 50,
  });

  let targetType: "mailbox" | "seed" = "mailbox";
  if (prof.mode === "seeds") targetType = "seed";
  else if (prof.mode === "hybrid") targetType = seeds.length && Math.random() < 0.6 ? "seed" : "mailbox";

  await warmupLog(jobId, "tick: target selection", { mailboxId, mode: prof.mode, seeds: seeds.length, targetType });

  if (targetType === "mailbox") {
    const peers = await prisma.mailbox.findMany({
      where: { workspaceId, isActive: true, warmupEnabled: true, id: { not: mailboxId } },
      select: { id: true, fromEmail: true, name: true },
      take: 200,
    });
    await warmupLog(jobId, "tick: peers", { peers: peers.length });
    if (!peers.length) {
      // fallback to seeds if available
      if (!seeds.length) {
        await warmupLog(jobId, "tick: no peers and no seeds (nothing to send)", { mailboxId });
        return;
      }
      targetType = "seed";
    } else {
      const peer = peers[Math.floor(Math.random() * peers.length)];
      await warmupLog(jobId, "tick: picked peer mailbox", { peerId: peer.id, peerEmail: peer.fromEmail });

      // Thread reuse: continue an existing conversation sometimes (more human-like).
      const maxThreadMsgs = env.WARMUP_THREAD_MAX_MESSAGES ?? 4;
      const reuseRate = env.WARMUP_THREAD_REUSE_RATE ?? 0.50;
      const reuseWindowDays = 7;
      if (Math.random() < reuseRate) {
        const since = new Date(Date.now() - reuseWindowDays * 24 * 60 * 60 * 1000);
        const existing = await prisma.warmupThread.findFirst({
          where: { workspaceId, fromMailboxId: mailboxId, toMailboxId: peer.id, status: "open", lastActivityAt: { gte: since } },
          orderBy: { lastActivityAt: "desc" },
          select: { id: true, subject: true, lastActivityAt: true, _count: { select: { messages: true } } },
        } as any);

        if (existing && (existing as any)._count?.messages < maxThreadMsgs) {
          const tplFollow = await pickWarmupTemplate(workspaceId, "reply");
          const last = await prisma.warmupMessage.findFirst({
            where: { workspaceId, threadId: existing.id, messageId: { not: null } },
            orderBy: { createdAt: "desc" },
            select: { messageId: true },
          });

          const subjectReuse = String(existing.subject || "[WU]");
          const subject = subjectReuse.startsWith("Re:") ? subjectReuse : `Re: ${subjectReuse}`;

          const msg = await prisma.warmupMessage.create({
            data: {
              workspaceId,
              mailboxId,
              threadId: existing.id,
              direction: "outbound",
              fromEmail: mb.fromEmail,
              toEmail: peer.fromEmail,
              subject,
              text: tplFollow.text,
              html: tplFollow.html,
              inReplyTo: normalizeMessageId(last?.messageId || null),
              references: normalizeMessageId(last?.messageId || null),
              sentAt: null,
              placement: "unknown",
            } as any,
          });

          let sendRes: any;
          try {
            sendRes = await sendEmail({
              mailboxId,
              to: peer.fromEmail,
              subject,
              text: tplFollow.text,
              html: tplFollow.html || undefined,
              inReplyTo: normalizeMessageId(last?.messageId || null) || undefined,
              references: normalizeMessageId(last?.messageId || null) || undefined,
              headers: {
                "X-ColdMail-Warmup-Id": msg.id,
                "X-ColdMail-Warmup-Thread": existing.id,
              },
            });
          } catch (e: any) {
            await warmupError(jobId, "tick: sendEmail failed (peer reuse)", { mailboxId, to: peer.fromEmail, error: String(e?.message || e) });
            throw e;
          }

          await prisma.warmupMessage.update({ where: { id: msg.id }, data: { messageId: sendRes.messageId, sentAt: new Date() } });
          await prisma.warmupThread.update({ where: { id: existing.id }, data: { lastActivityAt: new Date() } });

          await warmupLog(jobId, "tick: reused thread", { threadId: existing.id, to: peer.fromEmail, warmupMessageId: msg.id });

          // Schedule reply from peer mailbox
          const delayMin = 20 + Math.floor(Math.random() * 70);
          const runAt = new Date(Date.now() + delayMin * 60 * 1000);
          await prisma.job.create({
            data: {
              type: "warmup_reply",
              payload: JSON.stringify({ workspaceId, threadId: existing.id, fromMailboxId: peer.id, toEmail: mb.fromEmail, inReplyTo: sendRes.messageId, references: sendRes.messageId }),
              runAt,
              status: "queued",
            },
          }).catch(() => {});

          // Auto-close when thread gets long
          const afterCount = ((existing as any)._count?.messages || 0) + 1;
          if (afterCount >= maxThreadMsgs) {
            await prisma.warmupThread.update({ where: { id: existing.id }, data: { status: "closed" } }).catch(() => {});
          }

          return;
        }
      }

      const tpl = await pickWarmupTemplate(workspaceId, "initial");
      const subject = tpl.subject.includes("[WU]") ? tpl.subject : `[WU] ${tpl.subject}`;
      const thread = await prisma.warmupThread.create({
        data: {
          workspaceId,
          fromMailboxId: mailboxId,
          toMailboxId: peer.id,
          subject,
          status: "open",
          lastActivityAt: now,
        } as any,
      });
      const msg = await prisma.warmupMessage.create({
        data: {
          workspaceId,
          mailboxId,
          threadId: thread.id,
          direction: "outbound",
          fromEmail: mb.fromEmail,
          toEmail: peer.fromEmail,
          subject,
          text: tpl.text,
          html: tpl.html,
          sentAt: null,
          placement: "unknown",
        } as any,
      });

      let sendRes: any;
      try {
        sendRes = await sendEmail({
          mailboxId,
          to: peer.fromEmail,
          subject,
          text: tpl.text,
          html: tpl.html || undefined,
          headers: {
            "X-ColdMail-Warmup-Id": msg.id,
            "X-ColdMail-Warmup-Thread": thread.id,
          },
        });
      } catch (e: any) {
        await warmupError(jobId, "tick: sendEmail failed (peer)", { mailboxId, to: peer.fromEmail, error: String(e?.message || e) });
        throw e;
      }

      await warmupLog(jobId, "tick: sent warmup mail to peer", { to: peer.fromEmail, messageId: sendRes?.messageId, warmupMessageId: msg.id });

      await prisma.warmupMessage.update({
        where: { id: msg.id },
        data: { messageId: sendRes.messageId, sentAt: new Date() },
      });

      await prisma.warmupThread.update({ where: { id: thread.id }, data: { lastActivityAt: new Date() } });

      // schedule reply from peer mailbox to make threads realistic
      const delayMin = 20 + Math.floor(Math.random() * 70);
      const runAt = new Date(Date.now() + delayMin * 60 * 1000);
      await prisma.job.create({
        data: {
          type: "warmup_reply",
          payload: JSON.stringify({ workspaceId, threadId: thread.id, fromMailboxId: peer.id, toEmail: mb.fromEmail, inReplyTo: sendRes.messageId, references: sendRes.messageId }),
          runAt,
          status: "queued",
        },
      }).catch(() => {});
      await warmupLog(jobId, "tick: scheduled reply", { fromMailboxId: peer.id, runAt: runAt.toISOString() });
      return;
    }
  }

  if (targetType === "seed") {
    if (!seeds.length) return;
    const seed = seeds[Math.floor(Math.random() * seeds.length)];
    await warmupLog(jobId, "tick: picked seed inbox", { seedId: seed.id, seedEmail: seed.email });

    // Thread reuse with seeds: continue an existing conversation sometimes.
    const maxThreadMsgs = env.WARMUP_THREAD_MAX_MESSAGES ?? 4;
    const reuseRate = env.WARMUP_THREAD_REUSE_RATE ?? 0.50;
    const reuseWindowDays = 7;
    if (Math.random() < reuseRate) {
      const since = new Date(Date.now() - reuseWindowDays * 24 * 60 * 60 * 1000);
      const existing = await prisma.warmupThread.findFirst({
        where: { workspaceId, fromMailboxId: mailboxId, toSeedInboxId: seed.id, status: "open", lastActivityAt: { gte: since } },
        orderBy: { lastActivityAt: "desc" },
        select: { id: true, subject: true, lastActivityAt: true, _count: { select: { messages: true } } },
      } as any);

      if (existing && (existing as any)._count?.messages < maxThreadMsgs) {
        const tplFollow = await pickWarmupTemplate(workspaceId, "reply");
        const last = await prisma.warmupMessage.findFirst({
          where: { workspaceId, threadId: existing.id, messageId: { not: null } },
          orderBy: { createdAt: "desc" },
          select: { messageId: true },
        });

        const subjectReuse = String(existing.subject || "[WU]");
        const subject = subjectReuse.startsWith("Re:") ? subjectReuse : `Re: ${subjectReuse}`;

        const msg = await prisma.warmupMessage.create({
          data: {
            workspaceId,
            mailboxId,
            threadId: existing.id,
            direction: "outbound",
            fromEmail: mb.fromEmail,
            toEmail: seed.email,
            subject,
            text: tplFollow.text,
            html: tplFollow.html,
            inReplyTo: normalizeMessageId(last?.messageId || null),
            references: normalizeMessageId(last?.messageId || null),
            sentAt: null,
            placement: "unknown",
          } as any,
        });

        let sendRes: any;
        try {
          sendRes = await sendEmail({
            mailboxId,
            to: seed.email,
            subject,
            text: tplFollow.text,
            html: tplFollow.html || undefined,
            inReplyTo: normalizeMessageId(last?.messageId || null) || undefined,
            references: normalizeMessageId(last?.messageId || null) || undefined,
            headers: {
              "X-ColdMail-Warmup-Id": msg.id,
              "X-ColdMail-Warmup-Thread": existing.id,
            },
          });
        } catch (e: any) {
          await warmupError(jobId, "tick: sendEmail failed (seed reuse)", { mailboxId, to: seed.email, error: String(e?.message || e) });
          throw e;
        }

        await prisma.warmupMessage.update({ where: { id: msg.id }, data: { messageId: sendRes.messageId, sentAt: new Date() } });
        await prisma.warmupThread.update({ where: { id: existing.id }, data: { lastActivityAt: new Date() } });

        await warmupLog(jobId, "tick: reused seed thread", { threadId: existing.id, to: seed.email, warmupMessageId: msg.id });

        const afterCount = ((existing as any)._count?.messages || 0) + 1;
        if (afterCount >= maxThreadMsgs) {
          await prisma.warmupThread.update({ where: { id: existing.id }, data: { status: "closed" } }).catch(() => {});
        }

        return;
      }
    }

    const tpl = await pickWarmupTemplate(workspaceId, "initial");
    const subject = tpl.subject.includes("[WU]") ? tpl.subject : `[WU] ${tpl.subject}`;
    const thread = await prisma.warmupThread.create({
      data: {
        workspaceId,
        fromMailboxId: mailboxId,
        toSeedInboxId: seed.id,
        subject,
        status: "open",
        lastActivityAt: now,
      } as any,
    });
    const msg = await prisma.warmupMessage.create({
      data: {
        workspaceId,
        mailboxId,
        threadId: thread.id,
        direction: "outbound",
        fromEmail: mb.fromEmail,
        toEmail: seed.email,
        subject,
        text: tpl.text,
        html: tpl.html,
        seedInboxId: seed.id,
        sentAt: null,
        placement: "unknown",
      } as any,
    });

    let sendRes: any;
    try {
      sendRes = await sendEmail({
        mailboxId,
        to: seed.email,
        subject,
        text: tpl.text,
        html: tpl.html || undefined,
        headers: {
          "X-ColdMail-Warmup-Id": msg.id,
          "X-ColdMail-Warmup-Thread": thread.id,
        },
      });
    } catch (e: any) {
      await warmupError(jobId, "tick: sendEmail failed (seed)", { mailboxId, to: seed.email, error: String(e?.message || e) });
      throw e;
    }

    await warmupLog(jobId, "tick: sent warmup mail to seed", { to: seed.email, messageId: sendRes?.messageId, warmupMessageId: msg.id });

    await prisma.warmupMessage.update({ where: { id: msg.id }, data: { messageId: sendRes.messageId, sentAt: new Date() } });
    await prisma.warmupThread.update({ where: { id: thread.id }, data: { lastActivityAt: new Date() } });
  }
}

async function handleWarmupReply(jobId: string, payload: any) {
  const workspaceId = String(payload?.workspaceId || "");
  const threadId = String(payload?.threadId || "");
  const fromMailboxId = String(payload?.fromMailboxId || "");
  const toEmail = String(payload?.toEmail || "");
  if (!workspaceId || !threadId || !fromMailboxId || !toEmail) {
    await warmupError(jobId, "reply: missing required fields", { workspaceId, threadId, fromMailboxId, toEmail });
    return;
  }

  await warmupLog(jobId, "reply: start", { threadId, fromMailboxId, toEmail });

  const thread = await prisma.warmupThread.findFirst({ where: { id: threadId, workspaceId }, include: { fromMailbox: true, toMailbox: true, messages: { orderBy: { createdAt: "asc" } } } as any });
  if (!thread) {
    await warmupLog(jobId, "reply: thread not found", { threadId });
    return;
  }

  // replies only for internal mailbox threads
  if (!thread.toMailboxId) {
    await warmupLog(jobId, "reply: thread is not internal (skipping)", { threadId });
    return;
  }

  const mb = await prisma.mailbox.findFirst({ where: { id: fromMailboxId, workspaceId }, select: { id: true, isActive: true, fromEmail: true } });
  if (!mb || !mb.isActive) {
    await warmupLog(jobId, "reply: from mailbox inactive (skipping)", { fromMailboxId });
    return;
  }

  const lastOutbound = await prisma.warmupMessage.findFirst({
    where: { workspaceId, threadId, direction: "outbound" },
    orderBy: { createdAt: "desc" },
    select: { messageId: true, subject: true },
  });

  const tpl = await pickWarmupTemplate(workspaceId, "reply");
  const subject = lastOutbound?.subject?.startsWith("Re:") ? lastOutbound.subject : `Re: ${lastOutbound?.subject || "[WU]"}`;

  const msg = await prisma.warmupMessage.create({
    data: {
      workspaceId,
      mailboxId: fromMailboxId,
      threadId,
      direction: "inbound",
      fromEmail: mb.fromEmail,
      toEmail,
      subject,
      text: tpl.text,
      html: tpl.html,
      inReplyTo: payload?.inReplyTo || lastOutbound?.messageId || null,
      references: payload?.references || lastOutbound?.messageId || null,
      sentAt: null,
      placement: "unknown",
    } as any,
  });

  let sendRes: any;
  try {
    sendRes = await sendEmail({
      mailboxId: fromMailboxId,
      to: toEmail,
      subject,
      text: tpl.text,
      html: tpl.html || undefined,
      inReplyTo: payload?.inReplyTo || lastOutbound?.messageId || undefined,
      references: payload?.references || lastOutbound?.messageId || undefined,
      headers: {
        "X-ColdMail-Warmup-Id": msg.id,
        "X-ColdMail-Warmup-Thread": threadId,
      },
    });
  } catch (e: any) {
    await warmupError(jobId, "reply: sendEmail failed", { fromMailboxId, to: toEmail, error: String(e?.message || e) });
    throw e;
  }

  await warmupLog(jobId, "reply: sent", { fromMailboxId, to: toEmail, messageId: sendRes?.messageId, warmupMessageId: msg.id });

  await prisma.warmupMessage.update({ where: { id: msg.id }, data: { messageId: sendRes.messageId, sentAt: new Date() } });
  await prisma.warmupThread.update({ where: { id: threadId }, data: { lastActivityAt: new Date() } });

  // Optional: schedule a follow-up from the original sender to extend the thread (more realistic warmup).
  try {
    const followRate = env.WARMUP_FOLLOWUP_RATE ?? 0.35;
    const maxMsgs = env.WARMUP_THREAD_MAX_MESSAGES ?? 4;
    const msgCount = await prisma.warmupMessage.count({ where: { workspaceId, threadId } });
    if (msgCount >= maxMsgs) {
      await prisma.warmupThread.updateMany({ where: { id: threadId, workspaceId }, data: { status: "closed" } }).catch(() => {});
    }
    if (followRate > 0 && Math.random() < followRate && msgCount < maxMsgs) {
      const minDelay = env.WARMUP_FOLLOWUP_MIN_DELAY_MIN ?? 60;
      const maxDelay = Math.max(minDelay, env.WARMUP_FOLLOWUP_MAX_DELAY_MIN ?? 240);
      const delay = minDelay + Math.floor(Math.random() * (maxDelay - minDelay + 1));
      const runAt = new Date(Date.now() + delay * 60 * 1000);

      await prisma.job
        .create({
          data: {
            type: "warmup_followup",
            payload: JSON.stringify({
              workspaceId,
              threadId,
              fromMailboxId: thread.fromMailboxId,
              toEmail: mb.fromEmail,
              inReplyTo: sendRes.messageId,
              references: sendRes.messageId,
            }),
            runAt,
            status: "queued",
          },
        })
        .catch(() => {});

      await warmupLog(jobId, "reply: scheduled follow-up", { threadId, fromMailboxId: thread.fromMailboxId, runAt: runAt.toISOString() });
    }
  } catch (e: any) {
    await warmupLog(jobId, "reply: follow-up scheduling skipped", { threadId, error: String(e?.message || e) });
  }
}


async function handleWarmupFollowup(jobId: string, payload: any) {
  const workspaceId = String(payload?.workspaceId || "");
  const threadId = String(payload?.threadId || "");
  const fromMailboxId = String(payload?.fromMailboxId || "");
  const toEmail = String(payload?.toEmail || "");
  if (!workspaceId || !threadId || !fromMailboxId || !toEmail) {
    await warmupError(jobId, "followup: missing required fields", { workspaceId, threadId, fromMailboxId, toEmail });
    return;
  }

  const thread = await prisma.warmupThread.findFirst({ where: { id: threadId, workspaceId }, include: { messages: { orderBy: { createdAt: "asc" } } } as any });
  if (!thread || thread.status !== "open") {
    await warmupLog(jobId, "followup: thread not found/closed", { threadId });
    return;
  }

  const mb = await prisma.mailbox.findFirst({ where: { id: fromMailboxId, workspaceId }, select: { id: true, isActive: true, warmupEnabled: true, fromEmail: true } });
  if (!mb || !mb.isActive || !mb.warmupEnabled) {
    await warmupLog(jobId, "followup: mailbox inactive/disabled", { fromMailboxId });
    return;
  }

  // Pacing: enforce a minimum gap between warmup sends from this mailbox.
  const minGapMin = env.WARMUP_MIN_GAP_MINUTES ?? 15;
  if (minGapMin > 0) {
    const last = await prisma.warmupMessage.findFirst({
      where: { workspaceId, mailboxId: fromMailboxId, direction: "outbound", sentAt: { not: null } },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    });
    if (last?.sentAt) {
      const now = Date.now();
      const deltaMin = (now - new Date(last.sentAt as any).getTime()) / 60000;
      if (deltaMin < minGapMin) {
        await warmupLog(jobId, "followup: pacing (min gap)", { fromMailboxId, minGapMin, deltaMin });
        return;
      }
    }
  }

  const maxMsgs = env.WARMUP_THREAD_MAX_MESSAGES ?? 4;
  const msgCount = (thread as any).messages?.length || 0;
  if (msgCount >= maxMsgs) {
    await prisma.warmupThread.updateMany({ where: { id: threadId, workspaceId }, data: { status: "closed" } }).catch(() => {});
    await warmupLog(jobId, "followup: thread maxed, closed", { threadId, msgCount, maxMsgs });
    return;
  }

  const last = (thread as any).messages?.slice(-1)?.[0];
  const inReplyTo = payload?.inReplyTo || last?.messageId || null;
  const references = payload?.references || last?.references || last?.messageId || null;

  const tpl = await pickWarmupTemplate(workspaceId, "reply");
  const subjectBase = thread.subject || "[WU]";
  const subject = subjectBase.startsWith("Re:") ? subjectBase : `Re: ${subjectBase}`;

  const msg = await prisma.warmupMessage.create({
    data: {
      workspaceId,
      mailboxId: fromMailboxId,
      threadId,
      direction: "outbound",
      fromEmail: mb.fromEmail,
      toEmail,
      subject,
      text: tpl.text,
      html: tpl.html,
      inReplyTo,
      references,
      sentAt: null,
      placement: "unknown",
    } as any,
  });

  let sendRes: any;
  try {
    sendRes = await sendEmail({
      mailboxId: fromMailboxId,
      to: toEmail,
      subject,
      text: tpl.text,
      html: tpl.html || undefined,
      inReplyTo: inReplyTo || undefined,
      references: references || undefined,
      headers: {
        "X-ColdMail-Warmup-Id": msg.id,
        "X-ColdMail-Warmup-Thread": threadId,
      },
    });
  } catch (e: any) {
    await warmupError(jobId, "followup: sendEmail failed", { fromMailboxId, to: toEmail, error: String(e?.message || e) });
    throw e;
  }

  await prisma.warmupMessage.update({ where: { id: msg.id }, data: { messageId: sendRes.messageId, sentAt: new Date() } }).catch(() => {});
  await prisma.warmupThread.update({ where: { id: threadId }, data: { lastActivityAt: new Date() } }).catch(() => {});

  await warmupLog(jobId, "followup: sent", { fromMailboxId, to: toEmail, messageId: sendRes?.messageId, threadId });

  // Optional: schedule one more reply to keep threads realistic, but cap thread length.
  if (thread.toMailboxId && Math.random() < 0.6 && msgCount + 1 < maxMsgs) {
    const minDelay = env.WARMUP_FOLLOWUP_MIN_DELAY_MIN ?? 60;
    const maxDelay = Math.max(minDelay, env.WARMUP_FOLLOWUP_MAX_DELAY_MIN ?? 240);
    const delay = minDelay + Math.floor(Math.random() * (maxDelay - minDelay + 1));
    const runAt = new Date(Date.now() + delay * 60 * 1000);

    await prisma.job
      .create({
        data: {
          type: "warmup_reply",
          payload: JSON.stringify({
            workspaceId,
            threadId,
            fromMailboxId: thread.toMailboxId,
            toEmail: mb.fromEmail,
            inReplyTo: sendRes.messageId,
            references: sendRes.messageId,
          }),
          runAt,
          status: "queued",
        },
      })
      .catch(() => {});
  }
}

async function handleWarmupSeedReply(jobId: string, payload: any) {
  const workspaceId = String(payload?.workspaceId || "");
  const seedId = String(payload?.seedId || "");
  const warmupId = String(payload?.warmupId || "");
  if (!workspaceId || !seedId || !warmupId) {
    await warmupError(jobId, "seed_reply: missing required fields", { workspaceId, seedId, warmupId });
    return;
  }

  await warmupLog(jobId, "seed_reply: start", { workspaceId, seedId, warmupId });

  const seed = await prisma.warmupSeedInbox.findFirst({ where: { id: seedId, workspaceId } });
  if (!seed || !seed.isActive) {
    await warmupLog(jobId, "seed_reply: seed not found or inactive", { seedId });
    return;
  }

  const orig = await prisma.warmupMessage.findFirst({
    where: { id: warmupId, workspaceId },
    select: { id: true, threadId: true, mailboxId: true, fromEmail: true, subject: true, messageId: true },
  });
  if (!orig) {
    await warmupLog(jobId, "seed_reply: warmup message not found", { warmupId });
    return;
  }

  // Dedup: don't send more than one seed reply per thread per seed.
  const existing = await prisma.warmupMessage.findFirst({
    where: { workspaceId, threadId: orig.threadId, seedInboxId: seed.id, direction: "inbound", sentAt: { not: null } },
    select: { id: true },
  });
  if (existing) {
    await warmupLog(jobId, "seed_reply: already replied", { seedId, threadId: orig.threadId, existingId: existing.id });
    return;
  }

  const tpl = await pickWarmupTemplate(workspaceId, "reply");
  const subject = orig.subject?.startsWith("Re:") ? orig.subject : `Re: ${orig.subject || "[WU]"}`;
  const inReplyTo = normalizeMessageId(orig.messageId);

  let sendRes: any;
  try {
    sendRes = await sendSeedSmtpEmail({
      seed,
      to: orig.fromEmail,
      subject,
      text: tpl.text,
      html: tpl.html,
      inReplyTo: inReplyTo || undefined,
      references: inReplyTo || undefined,
      log: (msg, meta) => warmupLog(jobId, msg, meta),
      headers: {
        "X-ColdMail-Warmup-SeedReply": "1",
        "X-ColdMail-Warmup-Id": warmupId,
        "X-ColdMail-Warmup-Thread": orig.threadId,
      },
    });
  } catch (e: any) {
    await warmupError(jobId, "seed_reply: SMTP send failed", { seedId, to: orig.fromEmail, host: String(seed.smtpHost||""), port: seed.smtpPort ?? null, secure: !!seed.smtpSecure, error: String(e?.message || e) });
    throw e;
  }

  await prisma.warmupMessage
    .create({
      data: {
        workspaceId,
        mailboxId: orig.mailboxId,
        threadId: orig.threadId,
        direction: "inbound",
        fromEmail: seed.email,
        toEmail: orig.fromEmail,
        subject,
        text: tpl.text,
        html: tpl.html,
        messageId: String(sendRes?.messageId || "") || null,
        inReplyTo: inReplyTo,
        references: inReplyTo,
        sentAt: new Date(),
        placement: "unknown",
        seedInboxId: seed.id,
      } as any,
    })
    .catch(async (e) => {
      await warmupError(jobId, "seed_reply: failed to persist warmup message", { error: String((e as any)?.message || e) });
    });

  await prisma.warmupThread.update({ where: { id: orig.threadId }, data: { lastActivityAt: new Date() } }).catch(() => {});

  await warmupLog(jobId, "seed_reply: sent", { seedId, to: orig.fromEmail, messageId: sendRes?.messageId, threadId: orig.threadId });
}


async function enqueueWarmupSeedRescue(args: {
  jobId: string;
  workspaceId: string;
  seedId: string;
  warmupId: string;
  attempt: number;
  reason?: string;
}) {
  const attempt = Math.max(1, Number(args.attempt || 1));
  const maxRetries = env.WARMUP_SEED_RESCUE_MAX_RETRIES ?? 5;
  if (attempt > maxRetries) return;

  const min = env.WARMUP_SEED_RESCUE_BACKOFF_MIN ?? 10;
  const max = env.WARMUP_SEED_RESCUE_BACKOFF_MAX_MIN ?? 60;

  // Exponential backoff with jitter (minutes)
  const exp = Math.min(max, Math.round(min * Math.pow(2, attempt - 1)));
  const jitter = Math.floor(Math.random() * min);
  const delayMin = Math.min(max, exp + jitter);
  const runAt = new Date(Date.now() + delayMin * 60 * 1000);

  await prisma.job.create({
    data: {
      type: "warmup_seed_rescue",
      runAt,
      payload: JSON.stringify({
        workspaceId: args.workspaceId,
        seedId: args.seedId,
        warmupId: args.warmupId,
        attempt,
        reason: args.reason || null,
      }),
    },
  });

  await warmupLog(args.jobId, "seed_rescue: queued retry", {
    seedId: args.seedId,
    warmupId: args.warmupId,
    attempt,
    delayMin,
    reason: args.reason || null,
  });
}

async function handleWarmupSeedRescue(jobId: string, payload: any) {
  const workspaceId = String(payload?.workspaceId || "");
  const seedId = String(payload?.seedId || "");
  const warmupId = String(payload?.warmupId || "");
  const attempt = Math.max(1, Number(payload?.attempt || 1));

  if (!workspaceId || !seedId || !warmupId) {
    await warmupError(jobId, "seed_rescue: missing required fields", { workspaceId, seedId, warmupId, attempt });
    return;
  }

  const seed = await prisma.warmupSeedInbox.findFirst({ where: { id: seedId, workspaceId } });
  if (!seed || !seed.isActive) {
    await warmupLog(jobId, "seed_rescue: seed not found or inactive", { seedId, warmupId });
    return;
  }

  await warmupLog(jobId, "seed_rescue: start", { seedId, email: seed.email, warmupId, attempt });

  const pass = seed.imapPassEnc ? decrypt(seed.imapPassEnc) : "";
  if (!pass) {
    await warmupError(jobId, "seed_rescue: missing IMAP password", { seedId, warmupId });
    return;
  }

  const client = new ImapFlow({
    host: seed.imapHost,
    port: seed.imapPort,
    secure: seed.imapSecure,
    auth: { user: seed.imapUser, pass },
    logger: false as any,
  });

  try {
    await client.connect();
    const list = await client.list();
    const names = list.map((b: any) => b.path);

    const probeMailbox = async (path: string) => {
      try {
        const lock = await client.getMailboxLock(path, { readOnly: true });
        lock.release();
        return true;
      } catch {
        return false;
      }
    };


    const spamCandidates = [
      "[Gmail]/Spam",
      "[Google Mail]/Spam",
      "Spam",
      "Junk",
      "Junk Email",
      "Junk E-mail",
      "INBOX.Spam",
      "INBOX.Junk",
      "INBOX/Spam",
      "INBOX/Junk",
    ];
    const spamFolders: string[] = [];
    for (const c of spamCandidates) {
      if (names.includes(c) || (await probeMailbox(c))) spamFolders.push(c);
    }

    if (!spamFolders.length) {
      await warmupLog(jobId, "seed_rescue: no spam folders detected", { seedId, email: seed.email, names: names.slice(0, 30) });
      return;
    }

    // Look back 7 days; warmup headers are unique so we can match safely.
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    let moved = false;
    for (const folder of spamFolders) {
      try {
        await client.mailboxOpen(folder);
      } catch {
        continue;
      }

      const searchResult = await client.search({ since });
      const uids = Array.isArray(searchResult) ? searchResult : [];
      const recent = uids.slice(-200);

      for (const uid of recent) {
        const msg = await client.fetchOne(uid, { source: true });
          if (!msg || !("source" in msg) || !msg.source) continue;

        const parsed = await simpleParser(msg.source);
        const wid = String(parsed.headers.get("x-coldmail-warmup-id") || "").trim();
        if (!wid || wid !== warmupId) continue;

        // Rate limit Gmail/Outlook IMAP move operations to avoid throttling.
        const rl = env.WARMUP_SEED_RESCUE_RATE_LIMIT_MS ?? 2500;
        if (rl > 0) await sleep(rl);

        await (client as any).messageMove(uid, "INBOX", { uid: true });
        moved = true;

        await warmupLog(jobId, "seed_rescue: moved spam->inbox", { seedId: seed.id, email: seed.email, folder, uid, warmupId });

        // Update warmup message meta (best-effort)
                await prisma.warmupMessage.updateMany({ where: { id: warmupId, workspaceId }, data: { placement: "inbox", rescuedToInboxAt: new Date() } }).catch(() => {});

        break;
      }
      if (moved) break;
    }

    if (!moved) {
      const reason = "NOT_FOUND_OR_NOT_MOVED";
      if (attempt < (env.WARMUP_SEED_RESCUE_MAX_RETRIES ?? 5)) {
        await enqueueWarmupSeedRescue({ jobId, workspaceId, seedId, warmupId, attempt: attempt + 1, reason });
      } else {
        await warmupLog(jobId, "seed_rescue: giving up", { seedId, warmupId, attempt, reason });
      }
      return;
    }

    // ✅ Sequencing: schedule seed auto-reply ONLY after the message is in INBOX (i.e., after rescue succeeded)
    if (env.WARMUP_SEED_AUTOREPLY && Math.random() < (env.WARMUP_SEED_AUTOREPLY_RATE ?? 0.30)) {
      const hasSmtp = !!(seed.smtpHost && seed.smtpUser && seed.smtpPassEnc);
      if (!hasSmtp) {
        await warmupLog(jobId, "seed_rescue: auto-reply skipped (no SMTP)", { seedId: seed.id, email: seed.email, warmupId });
      } else {
        const existingJob = await prisma.job.findFirst({
          where: {
            type: "warmup_seed_reply",
            status: { in: ["queued", "running"] },
            payload: { contains: `"warmupId":"${warmupId}"` },
          },
          select: { id: true },
        });

        if (!existingJob) {
          const minDelay = env.WARMUP_SEED_AUTOREPLY_MIN_DELAY_MIN ?? 5;
          const maxDelay = Math.max(minDelay, env.WARMUP_SEED_AUTOREPLY_MAX_DELAY_MIN ?? 35);
          const delay = minDelay + Math.floor(Math.random() * (maxDelay - minDelay + 1));
          const runAt = new Date(Date.now() + delay * 60 * 1000);

          await prisma.job.create({
            data: {
              type: "warmup_seed_reply",
              runAt,
              payload: JSON.stringify({ workspaceId, seedId: seed.id, warmupId }),
            },
          });

          await warmupLog(jobId, "seed_rescue: auto-reply scheduled", { warmupId, seedId: seed.id, delayMin: delay });
        }
      }
    }
  } catch (e: any) {
    const err = String(e?.message || e);
    await warmupError(jobId, "seed_rescue: failed", { seedId, email: seed.email, warmupId, attempt, error: err });
    if (attempt < (env.WARMUP_SEED_RESCUE_MAX_RETRIES ?? 5)) {
      await enqueueWarmupSeedRescue({ jobId, workspaceId, seedId, warmupId, attempt: attempt + 1, reason: err });
    }
  } finally {
    try {
      await client.logout();
    } catch {}
  }
}



async function handleWarmupSeedCheck(jobId: string, payload: any) {
  const workspaceId = String(payload?.workspaceId || "");
  if (!workspaceId) {
    await warmupError(jobId, "seed_check: missing workspaceId");
    return;
  }

  const seedId = payload?.seedId ? String(payload.seedId) : null;
  const seeds = await prisma.warmupSeedInbox.findMany({
    where: { workspaceId, isActive: true, ...(seedId ? { id: seedId } : {}) },
  });
  if (!seeds.length) {
    await warmupLog(jobId, "seed_check: no active seeds", { workspaceId });
    return;
  }

  const now = new Date();
  const spamCandidates = ["[Gmail]/Spam", "[Gmail]/Junk", "Spam", "Junk", "Junk E-mail", "Junk Email", "Bulk Mail", "INBOX.Spam", "INBOX.Junk"];

  await warmupLog(jobId, "seed_check: start", { workspaceId, seeds: seeds.length });

  for (const seed of seeds as any[]) {
    await warmupLog(jobId, "seed_check: connect", { seedId: seed.id, email: seed.email, host: seed.imapHost, port: seed.imapPort, secure: seed.imapSecure });
    const pass = decrypt(seed.imapPassEnc);
    const client = new ImapFlow({
      host: seed.imapHost,
      port: seed.imapPort,
      secure: seed.imapSecure,
      auth: { user: seed.imapUser, pass },
      logger: false as any,
    });

    try {
      await client.connect();

      await warmupLog(jobId, "seed_check: connected", { seedId: seed.id, email: seed.email });

      const list = await client.list();
      const names = list.map((b: any) => b.path);

      const probeMailbox = async (path: string) => {
        try {
          const lock = await client.getMailboxLock(path, { readOnly: true });
          lock.release();
          return true;
        } catch {
          return false;
        }
      };

      const spamFolders: string[] = [];
      for (const c of spamCandidates) {
        if (names.includes(c) || (await probeMailbox(c))) spamFolders.push(c);
      }
      let folders = ["INBOX", ...spamFolders];

      // Optional archive folders (Gmail All Mail / provider Archive). Some providers file messages
      // directly into All Mail / Archive without INBOX, so include this folder in scans.
      const archiveCandidates = ["[Gmail]/All Mail", "[Google Mail]/All Mail", "All Mail", "Archive", "Archives", "INBOX.Archive", "INBOX/Archive"];
      const archiveFolder = await (async () => {
        for (const c of archiveCandidates) {
          if (names.includes(c) || (await probeMailbox(c))) return c;
        }
        return null;
      })();

      if (archiveFolder && !folders.includes(archiveFolder)) folders.push(archiveFolder);

      await warmupLog(jobId, "seed_check: folders", {
        seedId: seed.id,
        email: seed.email,
        folders,
        spamFolders,
      });

      const since = seed.lastCheckedAt ? new Date(seed.lastCheckedAt) : new Date(Date.now() - 48 * 60 * 60 * 1000);

      let updatedTotal = 0;
      let foundTotal = 0;

      for (const folder of folders) {
        try {
          await client.mailboxOpen(folder);
        } catch {
          await warmupLog(jobId, "seed_check: failed to open folder", { folder, seedId: seed.id });
          continue;
        }

        const searchResult = await client.search({ since });
        const uids = Array.isArray(searchResult) ? searchResult : [];
        await warmupLog(jobId, "seed_check: search", { seedId: seed.id, folder, uids: uids.length, since: since.toISOString() });
        const recentUids = uids.slice(-80); // cap
        for (const uid of recentUids) {
          const msg = await client.fetchOne(uid, { source: true });
          if (!msg || !("source" in msg) || !msg.source) continue;
          const parsed = await simpleParser(msg.source);
          const warmupId = String(parsed.headers.get("x-coldmail-warmup-id") || "").trim() || null;
          if (!warmupId) continue;

          foundTotal++;

          const placement = folder.toLowerCase().includes("spam") || folder.toLowerCase().includes("junk") ? "spam" : "inbox";

          // Seed engagement simulation: mark as read/starred (and optionally archive)
          const doEngage = !!env.WARMUP_SEED_ENGAGE;
          const doOpen = doEngage && Math.random() < (env.WARMUP_SEED_ENGAGE_OPEN_RATE ?? 0.85);
          const doStar = doEngage && Math.random() < (env.WARMUP_SEED_ENGAGE_STAR_RATE ?? 0.35);
          const doArchive = doEngage && !!archiveFolder && placement === "inbox" && Math.random() < (env.WARMUP_SEED_ENGAGE_ARCHIVE_RATE ?? 0.15);

          if (doOpen) {
            try {
              await (client as any).messageFlagsAdd(uid, ["\\Seen"], { uid: true });
              await warmupLog(jobId, "seed_check: engaged open", { seedId: seed.id, email: seed.email, folder, uid, warmupId });
            } catch (e: any) {
              await warmupError(jobId, "seed_check: engage open failed", { seedId: seed.id, email: seed.email, folder, uid, warmupId, error: String(e?.message || e) });
            }
          }

          if (doStar) {
            try {
              await (client as any).messageFlagsAdd(uid, ["\\Flagged"], { uid: true });
              // Extra compatibility: Gmail shows stars via the \Starred label. Best-effort add if supported.
              try {
                if (typeof (client as any).messageLabelsAdd === "function") {
                  await (client as any).messageLabelsAdd(uid, ["\\Starred", "$Starred"], { uid: true });
                }
              } catch {}
              await warmupLog(jobId, "seed_check: engaged star", { seedId: seed.id, email: seed.email, folder, uid, warmupId });
            } catch (e: any) {
              await warmupError(jobId, "seed_check: engage star failed", { seedId: seed.id, email: seed.email, folder, uid, warmupId, error: String(e?.message || e) });
            }
          }

          // Optional: if a warmup message landed in Spam/Junk, try to move it to INBOX to train the seed mailbox.
          // This helps Gmail/Outlook learn that warmup sender is "not spam". Some providers may restrict moves.
          let rescuedToInbox = false;
          if (placement === "spam" && env.WARMUP_SEED_RESCUE_SPAM) {
            try {
              // We are operating inside the spam/junk folder currently opened, so moving by UID should work.
              await (client as any).messageMove(uid, "INBOX", { uid: true });
              rescuedToInbox = true;
              await warmupLog(jobId, "seed_check: moved spam->inbox", { seedId: seed.id, email: seed.email, folder, uid, warmupId });
            } catch (e: any) {
              await warmupError(jobId, "seed_check: move spam->inbox failed", { seedId: seed.id, email: seed.email, folder, uid, warmupId, error: String(e?.message || e) });
              await enqueueWarmupSeedRescue({ jobId, workspaceId, seedId: seed.id, warmupId, attempt: 1, reason: String(e?.message || e) });
            }
          }

          // Optional: archive after engagement (only when message is in INBOX)
          let archived = false;
          if (doArchive) {
            try {
              await (client as any).messageMove(uid, archiveFolder, { uid: true });
              archived = true;
              await warmupLog(jobId, "seed_check: engaged archive", { seedId: seed.id, email: seed.email, fromFolder: folder, toFolder: archiveFolder, uid, warmupId });
            } catch (e: any) {
              await warmupError(jobId, "seed_check: engage archive failed", { seedId: seed.id, email: seed.email, folder, archiveFolder, uid, warmupId, error: String(e?.message || e) });
            }
          }
          try {
            const receivedAt = parsed.date ? new Date(parsed.date) : new Date();
            const updateData: any = { placement, placementFolder: folder, receivedAt };
            if (doOpen) updateData.openedAt = receivedAt;
            if (doStar) updateData.starredAt = new Date();
            if (rescuedToInbox) updateData.rescuedToInboxAt = new Date();
            if (archived) updateData.archivedAt = new Date();
            const upd = await prisma.warmupMessage.updateMany({
              where: { id: warmupId, workspaceId },
              data: updateData,
            });
            updatedTotal += upd.count;
          } catch (e: any) {
            await warmupError(jobId, "seed_check: failed to update warmup message", { warmupId, error: String(e?.message || e) });
          }

          // Optional: seed auto-reply (enterprise)
          // Only reply when the message is in INBOX (or successfully rescued into INBOX), to avoid "replying from spam".
          if (
            env.WARMUP_SEED_AUTOREPLY &&
            (placement === "inbox" || rescuedToInbox) &&
            Math.random() < (env.WARMUP_SEED_AUTOREPLY_RATE ?? 0.30)
          ) {
            try {
              // Must have SMTP configured on seed
              const hasSmtp = !!(seed.smtpHost && seed.smtpUser && seed.smtpPassEnc);
              if (!hasSmtp) {
                await warmupLog(jobId, "seed_check: auto-reply skipped (no SMTP)", { seedId: seed.id, email: seed.email, warmupId });
              } else {
                const orig = await prisma.warmupMessage.findFirst({
                  where: { id: warmupId, workspaceId },
                  select: { threadId: true },
                });
                if (orig?.threadId) {
                  // Dedup: one reply per thread per seed
                  const already = await prisma.warmupMessage.findFirst({
                    where: { workspaceId, threadId: orig.threadId, seedInboxId: seed.id, direction: "inbound", sentAt: { not: null } },
                    select: { id: true },
                  });

                  if (already) {
                    await warmupLog(jobId, "seed_check: auto-reply skipped (already replied)", { warmupId, seedId: seed.id, threadId: orig.threadId });
                  } else {
                    const existingJob = await prisma.job.findFirst({
                      where: { type: "warmup_seed_reply", status: { in: ["queued", "running"] }, payload: { contains: `"warmupId":"${warmupId}"` } },
                      select: { id: true },
                    });
                    if (!existingJob) {
                      const minDelay = env.WARMUP_SEED_AUTOREPLY_MIN_DELAY_MIN ?? 5;
                      const maxDelay = Math.max(minDelay, env.WARMUP_SEED_AUTOREPLY_MAX_DELAY_MIN ?? 35);
                      const delay = minDelay + Math.floor(Math.random() * (maxDelay - minDelay + 1));
                      const runAt = new Date(Date.now() + delay * 60 * 1000);

                      await prisma.job.create({
                        data: {
                          type: "warmup_seed_reply",
                          payload: JSON.stringify({ workspaceId, seedId: seed.id, warmupId, source: "seed_check" }),
                          runAt,
                          status: "queued",
                        },
                      });

                      await warmupLog(jobId, "seed_check: auto-reply enqueued", { warmupId, seedId: seed.id, threadId: orig.threadId, delayMin: delay });
                    }
                  }
                }
              }
            } catch (e: any) {
              await warmupError(jobId, "seed_check: auto-reply scheduling failed", { warmupId, seedId: seed.id, error: String(e?.message || e) });
            }
          }
        }
      }

      await warmupLog(jobId, "seed_check: summary", { seedId: seed.id, email: seed.email, foundTotal, updatedTotal, since: since.toISOString() });

      await prisma.warmupSeedInbox.update({ where: { id: seed.id }, data: { lastCheckedAt: now } }).catch(() => {});
    } catch (e: any) {
      // ignore per-seed errors
      await warmupError(jobId, "seed_check: seed error", { seedId: seed.id, email: seed.email, error: String(e?.message || e) });
      await prisma.warmupSeedInbox.update({ where: { id: seed.id }, data: { lastCheckedAt: now } }).catch(() => {});
    } finally {
      try { await client.logout(); } catch {}
    }
  }
}


async function handleWarmupMailboxCheck(jobId: string, payload: any) {
  const workspaceId = String(payload?.workspaceId || "");
  if (!workspaceId) {
    await warmupError(jobId, "mailbox_check: missing workspaceId");
    return;
  }

  const mailboxId = payload?.mailboxId ? String(payload.mailboxId) : null;

  const mailboxes = await prisma.mailbox.findMany({
    where: {
      workspaceId,
      isActive: true,
      warmupEnabled: true,
      imapHost: { not: null },
      imapUser: { not: null },
      imapPassEnc: { not: null },
      ...(mailboxId ? { id: mailboxId } : {}),
    },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      fromEmail: true,
      imapHost: true,
      imapPort: true,
      imapSecure: true,
      imapUser: true,
      imapPassEnc: true,
      imapTlsSkipVerify: true,
    },
    take: 2000,
  });

  if (!mailboxes.length) {
    await warmupLog(jobId, "mailbox_check: no eligible mailboxes", { workspaceId, mailboxId });
    return;
  }

  const spamCandidates = [
    "[Gmail]/Spam",
    "[Gmail]/Junk",
    "Spam",
    "Junk",
    "Junk E-mail",
    "Junk Email",
    "Bulk Mail",
    "INBOX.Spam",
    "INBOX.Junk",
    "INBOX/Spam",
    "INBOX/Junk",
  ];

  // Optional archive folders for engagement simulation
  const archiveCandidates = ["[Gmail]/All Mail", "[Google Mail]/All Mail", "All Mail", "Archive", "Archives", "INBOX.Archive", "INBOX/Archive"];

  // Look back 48 hours (safe default). Warmup headers are unique so we can match reliably.
  const sinceDefault = new Date(Date.now() - 48 * 60 * 60 * 1000);

  for (const mb of mailboxes as any[]) {
    const pass = decrypt(mb.imapPassEnc);
    const imapDebug = String(process.env.DEBUG_IMAP || "") === "1";

    const client = new ImapFlow({
      host: mb.imapHost,
      port: mb.imapPort,
      secure: mb.imapSecure,
      auth: { user: mb.imapUser, pass },
      tls: mb.imapTlsSkipVerify
        ? { rejectUnauthorized: false, servername: mb.imapHost }
        : { servername: mb.imapHost },
      logger: imapDebug ? console : (false as any),
    });

    try {
      await client.connect();

      const list = await client.list();
      const names = list.map((b: any) => b.path);

      const probeMailbox = async (path: string) => {
        try {
          const lock = await client.getMailboxLock(path, { readOnly: true });
          lock.release();
          return true;
        } catch {
          return false;
        }
      };

      const spamFolders: string[] = [];
      for (const c of spamCandidates) {
        if (names.includes(c) || (await probeMailbox(c))) spamFolders.push(c);
      }
      let folders = ["INBOX", ...spamFolders];

      const archiveFolder = await (async () => {
        for (const c of archiveCandidates) {
          if (names.includes(c) || (await probeMailbox(c))) return c;
        }
        return null;
      })();

      // Gmail (and some providers) may file messages directly into All Mail / Archive without INBOX.
      // Include an All Mail / Archive folder in scans so placement doesn't stay "unknown".
      if (archiveFolder && !folders.includes(archiveFolder)) folders.push(archiveFolder);

      const since = sinceDefault;

      let foundTotal = 0;
      let updatedTotal = 0;

      await warmupLog(jobId, "mailbox_check: folders", {
        mailboxId: mb.id,
        email: mb.fromEmail,
        folders,
        spamFolders,
        archiveFolder,
      });

      // Always emit a lightweight AppLog entry (even if WARMUP_DEBUG is off) so the Control Center
      // can explain why placement is still "unknown".
      try {
        const { appLogAsync } = await import("@/lib/app-log");
        void appLogAsync({
          level: "info",
          category: "warmup",
          event: "mailbox_check_folders",
          workspaceId,
          entityType: "mailbox",
          entityId: mb.id,
          message: `mailbox_check folders for ${mb.fromEmail}`,
          data: { folders, spamFolders, archiveFolder, since: since.toISOString() },
        });
      } catch {}

      for (const folder of folders) {
        try {
          await client.mailboxOpen(folder);
        } catch {
          await warmupLog(jobId, "mailbox_check: failed to open folder", { folder, mailboxId: mb.id });
          continue;
        }

        const searchResult = await client.search({ since });
        const uids = Array.isArray(searchResult) ? searchResult : [];
        const recentUids = uids.slice(-120);

        for (const uid of recentUids) {
          const msg = await client.fetchOne(uid, { source: true });
          if (!msg || !('source' in msg) || !msg.source) continue;

          const parsed = await simpleParser(msg.source);
          const warmupId = String(parsed.headers.get("x-coldmail-warmup-id") || "").trim() || null;
          if (!warmupId) continue;

          foundTotal++;

          const placement = folder.toLowerCase().includes("spam") || folder.toLowerCase().includes("junk") ? "spam" : "inbox";

          const doEngage = !!env.WARMUP_MAILBOX_ENGAGE;
          const doOpen = doEngage && Math.random() < (env.WARMUP_MAILBOX_ENGAGE_OPEN_RATE ?? 1.0);
          const doStar = doEngage && Math.random() < (env.WARMUP_MAILBOX_ENGAGE_STAR_RATE ?? 1.0);

          if (doOpen) {
            try {
              await (client as any).messageFlagsAdd(uid, ["\\Seen"], { uid: true });
            } catch (e: any) {
              await warmupError(jobId, "mailbox_check: engage open failed", {
                mailboxId: mb.id,
                email: mb.fromEmail,
                folder,
                uid,
                warmupId,
                error: String(e?.message || e),
              });
            }
          }

          if (doStar) {
            try {
              await (client as any).messageFlagsAdd(uid, ["\\Flagged"], { uid: true });
              // Extra compatibility: Gmail shows stars via the \Starred label. Best-effort add if supported.
              try {
                if (typeof (client as any).messageLabelsAdd === "function") {
                  await (client as any).messageLabelsAdd(uid, ["\\Starred", "$Starred"], { uid: true });
                }
              } catch {}
            } catch (e: any) {
              // Some providers (or Gmail edge cases) may behave differently; best-effort fallback.
              try {
                if (typeof (client as any).messageLabelsAdd === "function") {
                  await (client as any).messageLabelsAdd(uid, ["$Starred", "\\Starred"], { uid: true });
                }
              } catch {}
              await warmupError(jobId, "mailbox_check: engage star failed", {
                mailboxId: mb.id,
                email: mb.fromEmail,
                folder,
                uid,
                warmupId,
                error: String(e?.message || e),
              });
            }
          }

          try {
            const receivedAt = parsed.date ? new Date(parsed.date) : new Date();
            const updateData: any = { placement, placementFolder: folder, receivedAt };
            if (doOpen) updateData.openedAt = receivedAt;
            if (doStar) updateData.starredAt = new Date();

            const upd = await prisma.warmupMessage.updateMany({
              where: { id: warmupId, workspaceId },
              data: updateData,
            });
            updatedTotal += upd.count;
          } catch (e: any) {
            await warmupError(jobId, "mailbox_check: failed to update warmup message", {
              warmupId,
              mailboxId: mb.id,
              error: String(e?.message || e),
            });
          }
        }
      }

      await warmupLog(jobId, "mailbox_check: done", {
        mailboxId: mb.id,
        email: mb.fromEmail,
        foundTotal,
        updatedTotal,
      });

      try {
        const { appLogAsync } = await import("@/lib/app-log");
        void appLogAsync({
          level: "info",
          category: "warmup",
          event: "mailbox_check_done",
          workspaceId,
          entityType: "mailbox",
          entityId: mb.id,
          message: `mailbox_check done for ${mb.fromEmail}`,
          data: { foundTotal, updatedTotal, since: since.toISOString() },
        });
      } catch {}
    } catch (e: any) {
      await warmupError(jobId, "mailbox_check: failed", {
        mailboxId: mb.id,
        email: mb.fromEmail,
        host: mb.imapHost,
        error: String(e?.message || e),
      });

      try {
        const { appLogAsync } = await import("@/lib/app-log");
        void appLogAsync({
          level: "error",
          category: "warmup",
          event: "mailbox_check_failed",
          workspaceId,
          entityType: "mailbox",
          entityId: mb.id,
          message: `mailbox_check failed for ${mb.fromEmail}`,
          data: { host: mb.imapHost, error: String(e?.message || e) },
        });
      } catch {}
    } finally {
      await client.logout().catch(() => {});
    }
  }
}
async function enqueueWarmupTickSweep() {
  if (!env.AUTO_WARMUP_ENABLED) return;

  // Auto-disable warmup for mailboxes that are spiking to spam in seed inboxes.
  // This is a safety valve to avoid further damage when IP/domain reputation is temporarily degraded.
  if (env.WARMUP_AUTO_DISABLE_ON_SPAM) {
    const since = new Date(Date.now() - (env.WARMUP_SPAM_SPIKE_WINDOW_HOURS ?? 24) * 60 * 60 * 1000);
    const minMsgs = env.WARMUP_SPAM_SPIKE_MIN_MESSAGES ?? 6;
    const rate = env.WARMUP_SPAM_SPIKE_RATE ?? 0.5;

    const agg = await prisma.warmupMessage.groupBy({
      by: ["mailboxId", "placement"],
      where: { seedInboxId: { not: null }, receivedAt: { gte: since } },
      _count: { _all: true },
    }).catch(() => [] as any[]);

    const totals = new Map<string, { total: number; spam: number }>();
    for (const r of agg as any[]) {
      const cur = totals.get(r.mailboxId) || { total: 0, spam: 0 };
      cur.total += r._count?._all || 0;
      if (r.placement === "spam") cur.spam += r._count?._all || 0;
      totals.set(r.mailboxId, cur);
    }

    const spikeIds: string[] = [];
    for (const [mailboxId, v] of totals.entries()) {
      if (v.total < minMsgs) continue;
      if (v.spam / Math.max(1, v.total) >= rate) spikeIds.push(mailboxId);
    }

    if (spikeIds.length) {
      await prisma.mailbox.updateMany({ where: { id: { in: spikeIds }, warmupEnabled: true }, data: { warmupEnabled: false } }).catch(() => {});
      await prisma.warmupProfile.updateMany({ where: { mailboxId: { in: spikeIds }, isActive: true }, data: { isActive: false } }).catch(() => {});
      console.warn("[warmup] auto-disabled due to spam spike", { count: spikeIds.length, windowSince: since.toISOString(), minMsgs, rate });
    }
  }

  const mailboxes = await prisma.mailbox.findMany({
    where: { isActive: true, warmupEnabled: true },
    select: { id: true, workspaceId: true },
    take: 5000,
  });
  if (!mailboxes.length) return;

  let enqueued = 0;
  let skipped = 0;

  for (const mb of mailboxes as any[]) {
    const existing = await prisma.job.findFirst({
      where: { type: "warmup_tick", status: { in: ["queued", "running"] }, payload: { contains: `"mailboxId":"${mb.id}"` } },
      select: { id: true },
    });
    if (existing) { skipped++; continue; }
    await prisma.job.create({
      data: { type: "warmup_tick", payload: JSON.stringify({ workspaceId: mb.workspaceId, mailboxId: mb.id, source: "auto" }), runAt: new Date(), status: "queued" },
    }).catch(() => {});
    enqueued++;
  }

  if (enqueued || skipped) console.log("[warmup] tick sweep", { total: mailboxes.length, enqueued, skipped });
}


async function enqueueWarmupMailboxCheckSweep() {
  if (!env.AUTO_WARMUP_ENABLED) return;

  const workspaces = await prisma.workspace.findMany({ select: { id: true }, take: 2000 });
  if (!workspaces.length) return;

  let enqueued = 0;
  let skipped = 0;

  for (const ws of workspaces as any[]) {
    const existing = await prisma.job.findFirst({
      where: { type: "warmup_mailbox_check", status: { in: ["queued", "running"] }, payload: { contains: `"workspaceId":"${ws.id}"` } },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    await prisma.job
      .create({
        data: { type: "warmup_mailbox_check", payload: JSON.stringify({ workspaceId: ws.id, source: "auto" }), runAt: new Date(), status: "queued" },
      })
      .catch(() => {});
    enqueued++;
  }

  if (enqueued || skipped) console.log("[warmup] mailbox check sweep", { total: workspaces.length, enqueued, skipped });
}

async function enqueueWarmupSeedCheckSweep() {
  if (!env.AUTO_WARMUP_ENABLED) return;

  const workspaces = await prisma.workspace.findMany({ select: { id: true }, take: 2000 });
  if (!workspaces.length) return;

  let enqueued = 0;
  let skipped = 0;

  for (const ws of workspaces as any[]) {
    const existing = await prisma.job.findFirst({
      where: { type: "warmup_seed_check", status: { in: ["queued", "running"] }, payload: { contains: `"workspaceId":"${ws.id}"` } },
      select: { id: true },
    });
    if (existing) { skipped++; continue; }

    await prisma.job.create({
      data: { type: "warmup_seed_check", payload: JSON.stringify({ workspaceId: ws.id, source: "auto" }), runAt: new Date(), status: "queued" },
    }).catch(() => {});
    enqueued++;
  }

  if (enqueued || skipped) console.log("[warmup] seed sweep", { total: workspaces.length, enqueued, skipped });
}


main().catch((e) => {
  console.error("[worker] fatal", e);
  process.exit(1);
});
