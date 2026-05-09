import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aiSuggestLeadTags } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function splitTags(s?: string | null): string[] {
  return String(s || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({} as any));

  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : [];
  const maxTags = body.maxTags;
  const hint = body.hint;

  if (!ids.length) {
    return NextResponse.json({ ok: false, error: "Missing ids" }, { status: 400 });
  }

  const leads = await prisma.lead.findMany({
    where: { id: { in: ids }, workspaceId: s.wid },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      company: true,
      website: true,
      tags: true,
    },
  });

  if (!leads.length) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  try {
    const out = await aiSuggestLeadTags({
      leads: leads.map((l) => ({
        email: l.email,
        firstName: l.firstName,
        lastName: l.lastName,
        company: l.company,
        website: l.website,
        tags: splitTags(l.tags),
      })),
      maxTags: typeof maxTags === "number" ? maxTags : undefined,
      hint: typeof hint === "string" ? hint : undefined,
    });

    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    const msg = String(e?.message || e || "FAILED");
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
