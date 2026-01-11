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
      tags: tagsArr,
      createdAt: l.createdAt,
      enrollmentsCount: (l as any)._count?.enrollments || l.enrollments?.length || 0,
      campaigns: (l.enrollments || []).map((e) => e.campaign).filter(Boolean),
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
