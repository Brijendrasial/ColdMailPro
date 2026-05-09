import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aiClassifyAndDraftReply } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeStr(v: any, max = 5000) {
  const s = String(v || "").trim();
  return s.length > max ? s.slice(0, max) : s;
}

export async function POST(req: NextRequest) {
  try {
    const s = await requireSession();
    const body = (await req.json().catch(() => ({}))) as any;
    const leadId = String(body.leadId || "");
    if (!leadId) return NextResponse.json({ ok: false, error: "INVALID" }, { status: 400 });

    const [lead, ws] = await Promise.all([
      prisma.lead.findFirst({ where: { id: leadId, workspaceId: s.wid }, select: { id: true, email: true, firstName: true, lastName: true, company: true } }),
      prisma.workspace.findUnique({ where: { id: s.wid }, select: { name: true, settingsJson: true } }),
    ]);
    if (!lead) return NextResponse.json({ ok: false, error: "LEAD_NOT_FOUND" }, { status: 404 });

    // Latest inbound reply event in this thread (maps to an outbound message row)
    const latestReply = await prisma.event.findFirst({
      where: { type: "reply", message: { workspaceId: s.wid, leadId } },
      orderBy: { createdAt: "desc" },
      include: { message: { include: { mailbox: { select: { fromEmail: true } }, campaign: { select: { name: true } } } } },
    });
    if (!latestReply) return NextResponse.json({ ok: false, error: "NO_INBOUND" }, { status: 400 });

    let meta: any = {};
    try {
      meta = JSON.parse(latestReply.meta || "{}");
    } catch {
      meta = {};
    }

    const repliesAi = (ws?.settingsJson as any)?.repliesAi || {};
    const bookingLink = typeof repliesAi.bookingLink === "string" ? repliesAi.bookingLink : null;
    const language = typeof repliesAi.language === "string" ? repliesAi.language : "English";

    const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || null;

    const cls = await aiClassifyAndDraftReply({
      workspaceName: ws?.name || "",
      mailboxFrom: latestReply.message.mailbox?.fromEmail || "",
      campaignName: latestReply.message.campaign?.name || null,
      leadEmail: lead.email,
      leadName,
      lastOutboundSubject: latestReply.message.subject || null,
      lastOutboundBody: safeStr(latestReply.message.bodyText || latestReply.message.bodyHtml || "", 9000),
      inboundSubject: meta.subject || null,
      inboundBodyText: safeStr(meta.bodyText || meta.snippet || "", 9000),
      bookingLink,
      language,
    });

    const draftSubject = cls.draftSubject || (meta.subject ? `Re: ${String(meta.subject).replace(/^Re:\s*/i, "").slice(0, 250)}` : (latestReply.message.subject ? `Re: ${latestReply.message.subject.replace(/^Re:\s*/i, "").slice(0, 250)}` : "Re:"));

    const action = cls.draftBodyText ? "drafted" : "none";

    const row = await prisma.replyAiAction.upsert({
      where: { workspaceId_replyEventId: { workspaceId: s.wid, replyEventId: latestReply.id } },
      update: {
        leadId: lead.id,
        sentiment: cls.sentiment,
        intent: cls.intent,
        confidence: cls.confidence,
        action,
        draftSubject: cls.draftBodyText ? draftSubject : null,
        draftBodyText: cls.draftBodyText ? cls.draftBodyText : null,
      },
      create: {
        workspaceId: s.wid,
        leadId: lead.id,
        replyEventId: latestReply.id,
        sentiment: cls.sentiment,
        intent: cls.intent,
        confidence: cls.confidence,
        action,
        draftSubject: cls.draftBodyText ? draftSubject : null,
        draftBodyText: cls.draftBodyText ? cls.draftBodyText : null,
      },
      select: {
        id: true,
        sentiment: true,
        intent: true,
        confidence: true,
        action: true,
        draftSubject: true,
        draftBodyText: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ ok: true, ai: row, summary: cls.summary, suggestedAction: cls.suggestedAction });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ ok: false, error: "FAILED", detail: String(e?.message || e) }, { status: 500 });
  }
}
