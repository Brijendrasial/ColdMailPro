import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { domainMatchers, normalizeWebsiteInput } from "@/lib/domain";
import { aiAnalyzeWebsiteEmails, aiFindWebsiteEmailsByWebSearch } from "@/lib/ai";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


type FoundEmail = { email: string; evidenceUrls: string[] };

function isPrivateLikeHost(host: string): boolean {
  const h = String(host || "").trim().toLowerCase();
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  // Block direct IP literals (best-effort).
  const isIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(h);
  const isIpv6 = h.includes(":");
  if (isIpv4 || isIpv6) return true;
  return false;
}

export async function POST(req: NextRequest) {
  // Always respond with JSON so UI can show diagnostics.
  let body: any = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const debug = Boolean(body?.debug);
  const includeMore = Boolean(body?.includeSuggested); // backwards-compat; now maps to "max"
  const hint = typeof body?.hint === "string" ? body.hint : "";

  try {
    await requireSession();

    const websiteUrl = typeof body?.websiteUrl === "string" ? body.websiteUrl : "";
    const parsed = normalizeWebsiteInput(websiteUrl);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    if (isPrivateLikeHost(parsed.host)) {
      return NextResponse.json({ ok: false, error: "Unsupported website host" }, { status: 400 });
    }

    if (!env.LEADS_AI_ENABLED) {
      return NextResponse.json(
        { ok: false, error: "LEADS_AI_DISABLED", message: "Set LEADS_AI_ENABLED=1 to use AI email discovery." },
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
    const max = includeMore ? 40 : 20;

    // 1) Use AI web search (like ChatGPT) to discover published emails for the company.
    const found = await aiFindWebsiteEmailsByWebSearch({ websiteUrl: parsed.url, matchDomains, max, hint });
    const foundEmails: FoundEmail[] = (found.emails || []).map((e) => ({ email: e.email, evidenceUrls: e.evidenceUrls || [] }));

    // 2) Ask AI to explain what these emails are for (and whether suitable for outreach).
    const explain = foundEmails.length
      ? await aiAnalyzeWebsiteEmails({
          websiteUrl: parsed.url,
          emails: foundEmails,
          hint,
        })
      : { emails: [], rationale: "" };
    const explainMap = new Map(explain.emails.map((x) => [x.email, x] as const));

    const rows = foundEmails.map((f) => {
      const a = explainMap.get(f.email);
      return {
        email: f.email,
        sourceUrl: f.evidenceUrls[0] || "web_search",
        foundOnSite: true,
        evidenceUrls: f.evidenceUrls,
        purpose: a?.purpose || "other",
        recommended: a?.recommended ?? false,
        confidence: typeof a?.confidence === "number" ? a.confidence : 0,
        notes: a?.notes || "",
      };
    });

    const payload: any = {
      ok: true,
      website: parsed.url,
      host: parsed.host,
      matchDomains,
      emails: rows,
      suggested: [],
      otherEmails: [],
      contactForms: [],
      deepMode: { requested: false, tried: false, used: true, enabled: true },
      note: rows.length ? `Found ${rows.length} email${rows.length === 1 ? "" : "s"} via AI web search.` : "No emails found via AI web search.",
      rationale: [found.rationale, explain.rationale].filter(Boolean).join("\n\n").trim(),
      ai: {
        mode: "web_search",
        model: env.AI_WEBSEARCH_MODEL || env.AI_MODEL,
        maxToolCalls: env.AI_WEBSEARCH_MAX_TOOL_CALLS,
      },
    };

    if (debug) payload.debug = { max, includeMore, hint: String(hint || "") };
    return NextResponse.json(payload);
  } catch (e: any) {
    const msg = String(e?.message || e || "INTERNAL_ERROR");
    if (msg === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }
    return NextResponse.json(
      {
        ok: false,
        error: msg === "AI_TIMEOUT" ? "AI_TIMEOUT" : "INTERNAL_SERVER_ERROR",
        message: msg,
        ...(debug ? { stack: String(e?.stack || "") } : {}),
      },
      { status: msg === "AI_TIMEOUT" ? 504 : 500 }
    );
  }
}
