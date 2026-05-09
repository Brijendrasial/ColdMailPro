import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aiEnrichLeads } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({} as any));

  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : [];
  const hint = typeof body.hint === "string" ? body.hint : "";

  if (!ids.length) {
    return NextResponse.json({ ok: false, error: "Missing ids" }, { status: 400 });
  }

  const leads = await prisma.lead.findMany({
    where: { id: { in: ids }, workspaceId: s.wid },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      company: true,
      website: true,
    },
  });

  if (!leads.length) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  try {
    const out = await aiEnrichLeads({
      leads: leads.map((l) => ({
        id: l.id,
        email: l.email,
        firstName: l.firstName,
        lastName: l.lastName,
        company: l.company,
        website: l.website,
      })),
      hint,
    });

    // Keep only ids requested + fields we support.
    const byId = new Map(out.leads.map((x) => [String(x.id), x] as const));
    const normalized = ids
      .map((id) => {
        const v = byId.get(String(id));
        if (!v) return null;
        return {
          id: String(id),
          firstName: v.firstName ?? null,
          lastName: v.lastName ?? null,
          company: v.company ?? null,
          website: v.website ?? null,
        };
      })
      .filter(Boolean);

    return NextResponse.json({ ok: true, leads: normalized, rationale: out.rationale || "" });
  } catch (e: any) {
    const msg = String(e?.message || e || "FAILED");
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
