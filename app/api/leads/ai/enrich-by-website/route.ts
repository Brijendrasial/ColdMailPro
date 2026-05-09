import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aiEnrichLeads, aiFindWebsiteEmailsByWebSearch } from "@/lib/ai";
import { domainMatchers, normalizeWebsiteInput } from "@/lib/domain";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


// Safety guard so a single click cannot trigger enormous AI spends.
const MAX_MATCHED_LEADS = 500;

// When discovering new emails via AI web search.
const MAX_DISCOVERED_EMAIL_LEADS = 50;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({} as any));

  const websiteUrl = typeof body.websiteUrl === "string" ? body.websiteUrl : "";
  const parsed = normalizeWebsiteInput(websiteUrl);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  if (!env.LEADS_AI_ENABLED) {
    return NextResponse.json(
      { ok: false, error: "LEADS_AI_DISABLED", message: "Set LEADS_AI_ENABLED=1 to use AI enrich." },
      { status: 400 }
    );
  }

  if (!env.AI_WEBSEARCH_ENABLED) {
    return NextResponse.json(
      {
        ok: false,
        error: "AI_WEBSEARCH_DISABLED",
        message:
          "This project is configured to avoid crawling websites. Enable AI web search by setting AI_WEBSEARCH_ENABLED=1 (uses OpenAI Responses API + web_search tool).",
      },
      { status: 400 }
    );
  }

  const matchDomains = domainMatchers(parsed.host);

  // Find all leads in this workspace whose email domain matches the given host/root.
  const whereOr: any[] = [];
  for (const d of matchDomains) {
    whereOr.push({ email: { endsWith: `@${d}` } });
    // subdomains: john@mail.example.com endsWith ".example.com"
    whereOr.push({ email: { endsWith: `.${d}` } });
  }

  const matched = await prisma.lead.findMany({
    where: { workspaceId: s.wid, OR: whereOr },
    select: { id: true, email: true, firstName: true, lastName: true, company: true, website: true },
    take: MAX_MATCHED_LEADS,
  });

  // Optional: discover additional emails for the company (AI web search) and create leads for them.
  const discover = body?.discover === undefined ? true : Boolean(body.discover);
  const hint = typeof body?.hint === "string" ? body.hint : "";

  let discoveredEmails: string[] = [];
  let created = 0;

  let discoverError: string | null = null;



  if (discover) {
    try {
      const d = await aiFindWebsiteEmailsByWebSearch({
        websiteUrl: parsed.url,
        matchDomains,
        max: MAX_DISCOVERED_EMAIL_LEADS,
        hint,
      });
      discoveredEmails = (d.emails || []).map((x) => x.email).filter(Boolean).slice(0, MAX_DISCOVERED_EMAIL_LEADS);

      if (discoveredEmails.length) {
        const createdRes = await prisma.lead.createMany({
          data: discoveredEmails.map((email) => ({
            workspaceId: s.wid,
            email,
            website: parsed.url,
          })),
          skipDuplicates: true,
        });
        created = Number((createdRes as any)?.count || 0);
      }
    } catch (e: any) {
      // Don't hard-fail the whole enrichment run if web search is slow / times out.
      // We'll continue enriching existing leads (if any) and return the error in the response.
      discoverError = String(e?.message || e || "AI_WEBSEARCH_FAILED");
    }
  }


  // Re-fetch matched leads including newly created discovered emails.
  const refreshMatched = await prisma.lead.findMany({
    where: { workspaceId: s.wid, OR: whereOr },
    select: { id: true, email: true, firstName: true, lastName: true, company: true, website: true },
    take: MAX_MATCHED_LEADS,
  });

  if (!refreshMatched.length) {
    return NextResponse.json({
      ok: true,
      website: parsed.url,
      matched: 0,
      updated: 0,
      created,
      discovered: discoveredEmails.length,
      discoverError,
      note: discoveredEmails.length
        ? "Discovered emails, but they did not match the domain filter after import."
        : "No leads matched this domain, and AI web search did not find published emails.",
    });
  }

  // Run AI enrichment pass across matched leads (fill missing values only).
  const baseHint = `Company website: ${parsed.url}. Apply this company website to matching leads when setting website. Be conservative with names. ${hint ? `Extra hint: ${hint}` : ""}`;

  const leadsForAi = refreshMatched.map((l) => ({
    id: l.id,
    email: l.email,
    firstName: l.firstName,
    lastName: l.lastName,
    company: l.company,
    website: l.website,
  }));

  const batches = chunk(leadsForAi, 80);
  const aiOut: Array<{ id: string; firstName?: string | null; lastName?: string | null; company?: string | null; website?: string | null }> = [];
  const rationales: string[] = [];
  for (const b of batches) {
    const out = await aiEnrichLeads({ leads: b, hint: baseHint });
    aiOut.push(...out.leads);
    if (out.rationale) rationales.push(out.rationale);
  }

  const aiById = new Map(aiOut.map((x) => [String(x.id), x] as const));

  const updates = refreshMatched
    .map((cur) => {
      const ai = aiById.get(cur.id);
      const nextFirst = ai?.firstName ?? null;
      const nextLast = ai?.lastName ?? null;
      const nextCompany = (ai?.company ?? null) as any;
      const nextWebsite = (ai?.website ?? null) as any;
      const u: any = { id: cur.id };
      if (!cur.firstName && nextFirst) u.firstName = nextFirst;
      if (!cur.lastName && nextLast) u.lastName = nextLast;
      if (!cur.company && nextCompany) u.company = nextCompany;
      if (!cur.website && nextWebsite) u.website = nextWebsite;
      const has = Object.keys(u).length > 1;
      return has ? u : null;
    })
    .filter(Boolean) as any[];

  const ops: Promise<any>[] = [];
  for (const u of updates) {
    const data: any = {};
    if (u.firstName) data.firstName = u.firstName;
    if (u.lastName) data.lastName = u.lastName;
    if (u.company) data.company = u.company;
    if (u.website) data.website = u.website;
    if (Object.keys(data).length) ops.push(prisma.lead.update({ where: { id: u.id }, data }));
  }
  await Promise.all(ops);

  return NextResponse.json({
    ok: true,
    website: parsed.url,
    matched: refreshMatched.length,
    updated: ops.length,
    created,
    discovered: discoveredEmails.length,
      discoverError,
    rationale: rationales.filter(Boolean).join("\n\n").trim(),
    note:
      discoveredEmails.length && !matched.length
        ? `Discovered ${discoveredEmails.length} emails via AI web search.`
        : discoveredEmails.length
          ? `Discovered ${discoveredEmails.length} emails via AI web search (created ${created} new leads, skipped duplicates for the rest).`
          : "AI enrichment completed.",
    ai: { mode: "web_search", model: env.AI_WEBSEARCH_MODEL || env.AI_MODEL },
  });
}
