import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (s.includes("\"") || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({} as any));
  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : [];
  if (!ids.length) return NextResponse.json({ ok: false, error: "Missing ids" }, { status: 400 });

  const leads = await prisma.lead.findMany({
    where: { workspaceId: s.wid, id: { in: ids } },
    orderBy: { createdAt: "desc" },
    select: { email: true, firstName: true, lastName: true, company: true, website: true, status: true, tags: true, createdAt: true },
  });

  const header = ["email", "firstName", "lastName", "company", "website", "status", "tags", "createdAt"].join(",");
  const lines = leads.map((l) =>
    [l.email, l.firstName || "", l.lastName || "", l.company || "", l.website || "", l.status || "", l.tags || "", l.createdAt.toISOString()].map(csvEscape).join(",")
  );
  const csv = [header, ...lines].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=leads_export_${Date.now()}.csv`,
    },
  });
}
