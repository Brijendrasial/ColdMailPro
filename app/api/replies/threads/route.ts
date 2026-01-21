import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Shared Team Inbox thread list (grouped by lead)
// Prisma-only (no raw SQL) for maximum compatibility with MariaDB.

const norm = (v: string | null | undefined) => (v || "").trim();

const normLabels = (v: any) => {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return v.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 25);
  return v;
};

export async function GET(req: NextRequest) {
  try {
    const s = await requireSession();
    const url = new URL(req.url);

    const view = (url.searchParams.get("view") || "all").toLowerCase();
    const sort = (url.searchParams.get("sort") || "priority").toLowerCase();
    const statusParam = norm(url.searchParams.get("status"));
    const mailboxId = norm(url.searchParams.get("mailboxId"));
    const campaignId = norm(url.searchParams.get("campaignId"));
    const q = norm(url.searchParams.get("q"));

    const hideSnoozedByDefault = view !== "snoozed" && view !== "due";
    const now = new Date();

    const where: any = {
      type: "reply",
      message: {
        workspaceId: s.wid,
        leadId: { not: null },
        ...(mailboxId ? { mailboxId } : {}),
        ...(campaignId ? { campaignId } : {}),
      },
    };

    if (q) {
      where.OR = [
        { meta: { contains: q } },
        { message: { subject: { contains: q } } },
        { message: { lead: { email: { contains: q } } } },
        { message: { lead: { firstName: { contains: q } } } },
        { message: { lead: { lastName: { contains: q } } } },
        { message: { lead: { company: { contains: q } } } },
        { message: { mailbox: { fromEmail: { contains: q } } } },
        { message: { campaign: { name: { contains: q } } } },
      ];
    }

    const events = await prisma.event.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 2500,
      include: { message: { include: { lead: true, mailbox: true, campaign: true } } },
    });

    type Group = {
      lead: any;
      lastEvent: any;
      replyCount: number;
      replyTimes: Date[];
      mailbox: any;
      campaign: any;
    };

    const byLead = new Map<string, Group>();

    for (const e of events) {
      const m = e.message;
      if (!m?.leadId || !m.lead) continue;
      const key = m.leadId;
      const g = byLead.get(key);
      if (!g) {
        byLead.set(key, {
          lead: m.lead,
          lastEvent: e,
          replyCount: 1,
          replyTimes: [e.createdAt],
          mailbox: m.mailbox || null,
          campaign: m.campaign || null,
        });
      } else {
        g.replyCount += 1;
        g.replyTimes.push(e.createdAt);
      }
    }

    const leadIds = Array.from(byLead.keys());
    if (leadIds.length === 0) return NextResponse.json({ threads: [] });

    const states = await prisma.replyLeadState.findMany({
      where: { workspaceId: s.wid, leadId: { in: leadIds } },
      include: { assignedTo: true },
    });
    const stateByLead = new Map<string, any>();
    for (const st of states) stateByLead.set(st.leadId, st);

    const threads: any[] = [];

    for (const leadId of leadIds) {
      const g = byLead.get(leadId)!;
      const st = stateByLead.get(leadId) || null;

      const isPinned = Boolean(st?.isPinned);
      const isStarred = Boolean(st?.isStarred);
      const status = st?.status || "open";
      const snoozeUntil: Date | null = st?.snoozeUntil ? new Date(st.snoozeUntil) : null;

      const snoozed = snoozeUntil ? snoozeUntil.getTime() > now.getTime() : false;
      const due = snoozeUntil ? snoozeUntil.getTime() <= now.getTime() : false;

      // View filters
      if (view === "pinned" && !isPinned) continue;
      if (view === "starred" && !isStarred) continue;
      if (view === "snoozed" && !snoozed) continue;
      if (view === "due" && !due) continue;
      if (view === "mine" && (st?.assignedToUserId || "") !== s.uid) continue;

      // Status filters
      const statusFilter = (statusParam || "").toLowerCase();
      const viewIsStatus = ["open", "follow_up", "closed", "spam", "unsubscribe"].includes(view);
      if (viewIsStatus && status !== view) continue;
      if (statusFilter && status !== statusFilter) continue;
      if (hideSnoozedByDefault && snoozed) continue;

      const lastReadAt: Date | null = st?.lastReadAt ? new Date(st.lastReadAt) : null;
      const unreadCount =
        lastReadAt == null
          ? g.replyCount
          : g.replyTimes.reduce((acc, t) => (t > lastReadAt ? acc + 1 : acc), 0);
      if (view === "unread" && unreadCount <= 0) continue;

      threads.push({
        leadId: g.lead.id,
        leadEmail: g.lead.email,
        leadFirstName: g.lead.firstName ?? null,
        leadLastName: g.lead.lastName ?? null,
        leadCompany: g.lead.company ?? null,

        lastReplyAt: (g.lastEvent.createdAt as Date).toISOString(),
        lastMeta: g.lastEvent.meta ?? null,

        mailboxId: g.mailbox?.id ?? null,
        mailboxFromEmail: g.mailbox?.fromEmail ?? null,
        mailboxName: g.mailbox?.name ?? null,

        campaignId: g.campaign?.id ?? null,
        campaignName: g.campaign?.name ?? null,

        replyCount: g.replyCount,
        unreadCount,

        stateStatus: status,
        isPinned,
        isStarred,
        snoozeUntil: snoozeUntil ? snoozeUntil.toISOString() : null,
        labels: normLabels(st?.labels),

        assignedToUserId: st?.assignedToUserId ?? null,
        assignedToName: st?.assignedTo?.name ?? null,
        assignedToEmail: st?.assignedTo?.email ?? null,
      });
    }

    threads.sort((a, b) => {
      if (sort === "latest") return new Date(b.lastReplyAt).getTime() - new Date(a.lastReplyAt).getTime();
      if (sort === "oldest") return new Date(a.lastReplyAt).getTime() - new Date(b.lastReplyAt).getTime();
      // priority
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      if (a.isStarred !== b.isStarred) return a.isStarred ? -1 : 1;
      if (a.unreadCount !== b.unreadCount) return b.unreadCount - a.unreadCount;
      return new Date(b.lastReplyAt).getTime() - new Date(a.lastReplyAt).getTime();
    });

    return NextResponse.json({ threads: threads.slice(0, 200) });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: "FAILED" }, { status: 500 });
  }
}
