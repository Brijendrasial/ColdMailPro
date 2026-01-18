import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function parseIntSafe(v: string | null, def: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

function norm(s: string) {
  return s.trim().toLowerCase();
}

function splitTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  return String(tags)
    .split(",")
    .map((t) => norm(t))
    .filter(Boolean);
}

export async function GET(req: NextRequest) {
  const s = await requireSession();
  const url = new URL(req.url);

  const q = norm(url.searchParams.get("q") || "");
  const status = norm(url.searchParams.get("status") || "");
  const stage = norm(url.searchParams.get("stage") || "");
  const listId = norm(url.searchParams.get("listId") || "");
  const ownerUserId = norm(url.searchParams.get("ownerUserId") || "");
  const tasks = norm(url.searchParams.get("tasks") || ""); // "" | overdue | due_7d | none
  const tag = norm(url.searchParams.get("tag") || "");
  const campaignId = norm(url.searchParams.get("campaignId") || "");
  const contacted = norm(url.searchParams.get("contacted") || ""); // "1" | "0" | ""

  const page = parseIntSafe(url.searchParams.get("page"), 1);
  const pageSize = Math.min(200, parseIntSafe(url.searchParams.get("pageSize"), 50));
  const skip = (page - 1) * pageSize;

  const where: any = { workspaceId: s.wid };

  if (status && status !== "all") {
    where.status = status;
  }

  if (stage && stage !== "all") {
    where.stage = stage;
  }

  if (listId && listId !== "all") {
    where.listId = listId;
  }

  if (ownerUserId && ownerUserId !== "all") {
    where.ownerUserId = ownerUserId;
  }

  if (tag) {
    // tags are stored as comma-separated string; contains() is a pragmatic filter
    where.tags = { contains: tag };
  }

  if (campaignId) {
    where.enrollments = { some: { campaignId } };
  }

  if (contacted === "1") {
    where.messages = { some: {} };
  } else if (contacted === "0") {
    where.messages = { none: {} };
  }

  if (tasks === "overdue") {
    where.tasks = { some: { completedAt: null, dueAt: { lt: new Date() } } };
  } else if (tasks === "due_7d") {
    const now = new Date();
    const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    where.tasks = { some: { completedAt: null, dueAt: { gte: now, lte: soon } } };
  } else if (tasks === "none") {
    where.tasks = { none: { completedAt: null } };
  }

  if (q) {
    where.OR = [
      { email: { contains: q } },
      { firstName: { contains: q } },
      { lastName: { contains: q } },
      { company: { contains: q } },
      { website: { contains: q } },
      { tags: { contains: q } },
    ];
  }

  const [total, leads] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        _count: { select: { enrollments: true } },
        owner: { select: { id: true, name: true, email: true } },
        list: { select: { id: true, name: true } },
        tasks: {
          select: { id: true, dueAt: true, completedAt: true, title: true },
          where: { completedAt: null },
          orderBy: { dueAt: "asc" },
          take: 1,
        },
        activities: {
          select: { id: true, type: true, text: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        enrollments: {
          select: {
            id: true,
            status: true,
            currentStep: true,
            nextRunAt: true,
            campaign: { select: { id: true, name: true, status: true } },
          },
          orderBy: { updatedAt: "desc" },
          take: 5,
        },
        messages: {
          select: {
            id: true,
            status: true,
            subject: true,
            createdAt: true,
            sentAt: true,
            campaign: { select: { id: true, name: true } },
            mailbox: { select: { id: true, fromEmail: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
  ]);

  const items = leads.map((l) => {
    const tagsArr = splitTags(l.tags);
    const last = l.messages?.[0] || null;
    return {
      id: l.id,
      email: l.email,
      firstName: l.firstName,
      lastName: l.lastName,
      company: l.company,
      website: l.website,
      status: l.status,
      stage: (l as any).stage,
      owner: (l as any).owner ? { id: (l as any).owner.id, name: (l as any).owner.name, email: (l as any).owner.email } : null,
      list: (l as any).list ? { id: (l as any).list.id, name: (l as any).list.name } : null,
      tags: tagsArr,
      createdAt: l.createdAt,
      enrollmentsCount: (l as any)._count?.enrollments || l.enrollments?.length || 0,
      campaigns: (l.enrollments || []).map((e) => e.campaign).filter(Boolean),
      nextTask: (l as any).tasks?.[0] ? { id: (l as any).tasks[0].id, title: (l as any).tasks[0].title, dueAt: (l as any).tasks[0].dueAt } : null,
      lastActivity: (l as any).activities?.[0]
        ? { type: (l as any).activities[0].type, text: (l as any).activities[0].text, createdAt: (l as any).activities[0].createdAt }
        : null,
      lastMessage: last
        ? {
            status: last.status,
            subject: last.subject,
            createdAt: last.createdAt,
            sentAt: last.sentAt,
            campaign: last.campaign,
            mailbox: last.mailbox,
          }
        : null,
    };
  });

  return NextResponse.json({
    ok: true,
    page,
    pageSize,
    total,
    items,
  });
}
