import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (s.includes("\"") || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function norm(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

function buildLeadWhere(workspaceId: string, rawFilters: any = {}) {
  const filters = rawFilters && typeof rawFilters === "object" ? rawFilters : {};
  const q = norm(filters.q);
  const status = norm(filters.status);
  const stage = norm(filters.stage);
  const listId = norm(filters.listId);
  const ownerUserId = norm(filters.ownerUserId);
  const tasks = norm(filters.tasks);
  const tag = norm(filters.tag);
  const contacted = norm(filters.contacted);
  const snoozed = norm(filters.snoozed || "hide");

  const where: any = { workspaceId };
  const now = new Date();

  if (!snoozed || snoozed === "hide") {
    where.OR = [{ snoozeUntil: null }, { snoozeUntil: { lte: now } }];
  } else if (snoozed === "only") {
    where.snoozeUntil = { gt: now };
  }

  if (status && status !== "all") where.status = status;
  if (stage && stage !== "all") where.stage = stage;
  if (listId && listId !== "all") where.listId = listId;
  if (ownerUserId && ownerUserId !== "all") where.ownerUserId = ownerUserId;
  if (tag) where.tags = { contains: tag };

  if (contacted === "1") {
    where.messages = { some: {} };
  } else if (contacted === "0") {
    where.messages = { none: {} };
  }

  if (tasks === "overdue") {
    where.tasks = { some: { completedAt: null, dueAt: { lt: new Date() } } };
  } else if (tasks === "due_7d") {
    const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    where.tasks = { some: { completedAt: null, dueAt: { gte: now, lte: soon } } };
  } else if (tasks === "none") {
    where.tasks = { none: { completedAt: null } };
  }

  if (q) {
    const searchOr = [
      { email: { contains: q } },
      { firstName: { contains: q } },
      { lastName: { contains: q } },
      { company: { contains: q } },
      { website: { contains: q } },
      { tags: { contains: q } },
    ];
    if (where.OR) {
      where.AND = where.AND || [];
      where.AND.push({ OR: searchOr });
    } else {
      where.OR = searchOr;
    }
  }

  return where;
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({} as any));
  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
  const scope = norm(body.scope || (ids.length ? "selected" : "filtered"));

  let where: any;
  if (ids.length) {
    where = { workspaceId: s.wid, id: { in: ids } };
  } else if (scope === "all") {
    where = { workspaceId: s.wid };
  } else {
    where = buildLeadWhere(s.wid, body.filters || body);
  }

  const leads = await prisma.lead.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50000,
    select: {
      email: true,
      firstName: true,
      lastName: true,
      company: true,
      website: true,
      status: true,
      stage: true,
      tags: true,
      createdAt: true,
      owner: { select: { name: true, email: true } },
      list: { select: { name: true } },
    },
  });

  const header = [
    "email",
    "firstName",
    "lastName",
    "company",
    "website",
    "status",
    "stage",
    "tags",
    "owner",
    "list",
    "createdAt",
  ].join(",");

  const lines = leads.map((l) =>
    [
      l.email,
      l.firstName || "",
      l.lastName || "",
      l.company || "",
      l.website || "",
      l.status || "",
      (l as any).stage || "",
      l.tags || "",
      l.owner?.name || l.owner?.email || "",
      l.list?.name || "",
      l.createdAt.toISOString(),
    ].map(csvEscape).join(",")
  );
  const csv = [header, ...lines].join("\n");
  const filenameScope = ids.length ? "selected" : scope === "all" ? "all" : "filtered";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=leads_${filenameScope}_${Date.now()}.csv`,
      "X-Export-Count": String(leads.length),
    },
  });
}
