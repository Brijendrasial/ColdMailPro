import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { domainMatchers, normalizeWebsiteInput } from "@/lib/domain";
import { aiEnrichLeads } from "@/lib/ai";

export const runtime = "nodejs";

const Body = z.object({
  websiteUrl: z.string().min(1),
  emails: z.array(z.string()).min(1),
  // Optional: if provided, we set it on new leads (still fill-missing-only semantics because these are new)
  tags: z.string().optional().nullable(),
});

const MAX_IMPORT = 500;

function normEmail(e: string): string {
  return String(e || "").trim().toLowerCase();
}

function normalizeTags(tags: string | null | undefined) {
  if (!tags) return null;
  const out = String(tags)
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return out.length ? Array.from(new Set(out)).slice(0, 200).join(",") : null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const raw = await req.json().catch(() => ({} as any));
  const parsedBody = Body.safeParse(raw);
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false, error: "Invalid input", details: parsedBody.error.flatten() }, { status: 400 });
  }

  const { websiteUrl, emails, tags } = parsedBody.data;
  const parsedWebsite = normalizeWebsiteInput(websiteUrl);
  if (!parsedWebsite.ok) return NextResponse.json({ ok: false, error: parsedWebsite.error }, { status: 400 });

  const matchDomains = domainMatchers(parsedWebsite.host);

  // Keep only emails belonging to the company domain.
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const e of emails) {
    const v = normEmail(e);
    if (!v || !v.includes("@")) continue;
    if (seen.has(v)) continue;
    const dom = v.split("@")[1] || "";
    const ok = matchDomains.some((d) => dom === d || dom.endsWith(`.${d}`));
    if (!ok) continue;
    seen.add(v);
    uniq.push(v);
    if (uniq.length >= MAX_IMPORT) break;
  }

  if (!uniq.length) {
    return NextResponse.json({ ok: false, error: "No company-domain emails to import" }, { status: 400 });
  }

  const normTags = normalizeTags(tags);

  // AI-only: create minimal lead rows (email + status + tags). Enrichment happens via aiEnrichLeads.
  const data = uniq.map((email) =>
    ({
      workspaceId: s.wid,
      email,
      status: "active",
      tags: normTags,
    }) as any
  );

  const created = await prisma.lead.createMany({ data, skipDuplicates: true });

  // Fetch the current set (created + pre-existing duplicates) so we can enrich consistently.
  const existing = await prisma.lead.findMany({
    where: { workspaceId: s.wid, email: { in: uniq } },
    select: { id: true, email: true, firstName: true, lastName: true, company: true, website: true },
  });

  const hint = `Company website: ${parsedWebsite.url}. Apply this company website to matching leads when setting website. Be conservative with names.`;
  const batches = chunk(existing, 80);
  const aiOut: Array<{ id: string; firstName?: string | null; lastName?: string | null; company?: string | null; website?: string | null }> = [];
  for (const b of batches) {
    const out = await aiEnrichLeads({
      leads: b.map((l) => ({
        id: l.id,
        email: l.email,
        firstName: l.firstName,
        lastName: l.lastName,
        company: l.company,
        website: l.website,
      })),
      hint,
    });
    aiOut.push(...out.leads);
  }

  const byId = new Map(aiOut.map((x) => [String(x.id), x] as const));
  const ops: Promise<any>[] = [];
  for (const cur of existing) {
    const ai = byId.get(String(cur.id));
    if (!ai) continue;
    const data: any = {};
    if (!cur.firstName && ai.firstName) data.firstName = ai.firstName;
    if (!cur.lastName && ai.lastName) data.lastName = ai.lastName;
    if (!cur.company && ai.company) data.company = ai.company;
    if (!cur.website && ai.website) data.website = ai.website;
    if (Object.keys(data).length) ops.push(prisma.lead.update({ where: { id: cur.id }, data }));
  }
  await Promise.all(ops);

  return NextResponse.json({
    ok: true,
    website: parsedWebsite.url,
    importedRequested: uniq.length,
    created: created.count,
    skipped: Math.max(0, uniq.length - created.count),
    enriched: ops.length,
    note: uniq.length >= MAX_IMPORT ? `Reached safety limit of ${MAX_IMPORT} emails.` : "",
  });
}
