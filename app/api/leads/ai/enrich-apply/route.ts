import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aiEnrichLeads } from "@/lib/ai";
import { logLeadActivity } from "@/lib/lead-activity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  ids: z.array(z.string().min(1)).min(1),
  hint: z.string().optional().default(""),
  overwrite: z.boolean().optional().default(false),
});

function clean(s: any): string | null {
  if (s === undefined) return null;
  if (s === null) return null;
  const t = String(s).trim();
  return t ? t : null;
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const raw = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });

  const ids = parsed.data.ids.map(String);
  const hint = parsed.data.hint || "";
  const overwrite = !!parsed.data.overwrite;

  const leads = await prisma.lead.findMany({
    where: { id: { in: ids }, workspaceId: s.wid },
    select: { id: true, email: true, firstName: true, lastName: true, company: true, website: true },
  });
  if (!leads.length) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

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

    const byId = new Map(out.leads.map((x: any) => [String(x.id), x] as const));
    let updated = 0;

    for (const cur of leads) {
      const v: any = byId.get(String(cur.id));
      if (!v) continue;

      const data: any = {};
      const nextFirst = v.firstName === undefined ? undefined : clean(v.firstName);
      const nextLast = v.lastName === undefined ? undefined : clean(v.lastName);
      const nextCompany = v.company === undefined ? undefined : clean(v.company);
      const nextWebsite = v.website === undefined ? undefined : clean(v.website);

      if (nextFirst !== undefined && (overwrite || !cur.firstName)) data.firstName = nextFirst;
      if (nextLast !== undefined && (overwrite || !cur.lastName)) data.lastName = nextLast;
      if (nextCompany !== undefined && (overwrite || !cur.company)) data.company = nextCompany;
      if (nextWebsite !== undefined && (overwrite || !cur.website)) data.website = nextWebsite;

      if (!Object.keys(data).length) continue;
      await prisma.lead.update({ where: { id: cur.id }, data });
      updated++;
      await logLeadActivity({
        workspaceId: s.wid,
        leadId: cur.id,
        actorUserId: s.uid || null,
        type: "enrich",
        text: `Enriched: ${Object.keys(data).join(", ")}`,
        meta: { updatedFields: Object.keys(data), overwrite },
      });
    }

    return NextResponse.json({ ok: true, updated, rationale: out.rationale || "" });
  } catch (e: any) {
    const msg = String(e?.message || e || "FAILED");
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
