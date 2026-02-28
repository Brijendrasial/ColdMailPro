import { env } from "@/lib/env";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type WarmupTemplate = {
  name: string;
  subject: string;
  text: string;
};

type GenerateArgs = {
  type: "initial" | "reply";
  count: number;
  tone: string;
  language: string;
  context?: string;
};

type LeadMini = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  website?: string | null;
  tags?: string[] | null;
};

function extractJsonArray(raw: string): any[] {
  // Try direct JSON first
  const trimmed = raw.trim();
  try {
    const j = JSON.parse(trimmed);
    if (Array.isArray(j)) return j;
  } catch {}

  // Try to locate first '[' ... matching ']' (best-effort)
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    const slice = trimmed.slice(start, end + 1);
    try {
      const j = JSON.parse(slice);
      if (Array.isArray(j)) return j;
    } catch {}
  }

  return [];
}


function extractJsonObject(raw: string): any | null {
  const trimmed = String(raw || '').trim();
  try {
    const j = JSON.parse(trimmed);
    if (j && typeof j === 'object' && !Array.isArray(j)) return j;
  } catch {}

  // Best-effort: locate first '{' ... last '}'
  const start = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (start !== -1 && last !== -1 && last > start) {
    const slice = trimmed.slice(start, last + 1);
    try {
      const j = JSON.parse(slice);
      if (j && typeof j === 'object' && !Array.isArray(j)) return j;
    } catch {}
  }
  return null;
}

function assertAiEnabled(feature: "warmup" | "leads" | "replies") {
  if (feature === "warmup" && !env.WARMUP_AI_ENABLED) throw new Error("WARMUP_AI_DISABLED");
  if (feature === "leads" && !env.LEADS_AI_ENABLED) throw new Error("LEADS_AI_DISABLED");
  if (feature === "replies" && !env.REPLIES_AI_ENABLED) throw new Error("REPLIES_AI_DISABLED");
}

async function chatCompletion(messages: ChatMessage[], feature: "warmup" | "leads" | "replies") {
  assertAiEnabled(feature);
  if (!env.AI_API_KEY) {
    throw new Error("AI_API_KEY_MISSING");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);

  try {
    const res = await fetch(`${env.AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.AI_MODEL,
        messages,
        temperature: 0.9,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    const j = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = j?.error?.message || j?.error || j?.message || `HTTP_${res.status}`;
      throw new Error(String(msg));
    }

    const content = j?.choices?.[0]?.message?.content;
    if (!content) throw new Error("AI_EMPTY_RESPONSE");
    return String(content);
  } finally {
    clearTimeout(timer);
  }
}

function responseOutputText(resp: any): string {
  try {
    if (typeof resp?.output_text === "string" && resp.output_text.trim()) return resp.output_text;
  } catch {}
  const out = Array.isArray(resp?.output) ? resp.output : [];
  for (const item of out) {
    if (item?.type === "message" && item?.role === "assistant") {
      const parts = Array.isArray(item?.content) ? item.content : [];
      const texts: string[] = [];
      for (const p of parts) {
        if (!p) continue;
        if (p.type === "output_text" || p.type === "text") {
          const t = String((p.text ?? p.content ?? "") || "");
          if (t) texts.push(t);
        }
      }
      const joined = texts.join("");
      if (joined.trim()) return joined;
    }
  }
  return "";
}

async function responsesWithWebSearch(args: {
  instructions: string;
  input: string;
  model?: string;
  maxToolCalls?: number;
  featureTag?: string;
}): Promise<{ text: string; raw: any }> {
  if (!env.AI_API_KEY) {
    throw new Error("AI_API_KEY_MISSING");
  }

  const base = String(env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const url = `${base}/responses`;
  const model = String(args.model || env.AI_WEBSEARCH_MODEL || env.AI_MODEL || "gpt-5");
  const maxToolCalls = Math.max(1, Math.min(10, Number(args.maxToolCalls ?? env.AI_WEBSEARCH_MAX_TOOL_CALLS ?? 3)));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(10_000, Number(env.AI_WEBSEARCH_TIMEOUT_MS || env.AI_TIMEOUT_MS || 60_000)));

  try {
    let r: Response;
    try {
      r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        tools: [{ type: "web_search" }],
        tool_choice: "auto",
        max_tool_calls: maxToolCalls,
        include: ["web_search_call.action.sources"],
        instructions: args.instructions,
        input: args.input,
        metadata: args.featureTag ? { feature: args.featureTag } : undefined,
        // IMPORTANT: Do NOT enable JSON mode here.
        // The web_search tool is incompatible with JSON mode, and the API will error.
        // We still ask the model to output JSON in the prompt and parse defensively.
      }),
      signal: controller.signal,
      });
    } catch (e: any) {
      if (e?.name === "AbortError") throw new Error("AI_TIMEOUT");
      throw e;
    }

    const j = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = String(j?.error?.message || j?.message || j?.error || `HTTP_${r.status}`);
      throw new Error(msg);
    }

    const t = responseOutputText(j);
    return { text: t, raw: j };
  } finally {
    clearTimeout(timer);
  }
}

export async function aiFindWebsiteEmailsByWebSearch(args: {
  websiteUrl: string;
  matchDomains: string[];
  max?: number;
  hint?: string;
}): Promise<{ emails: Array<{ email: string; evidenceUrls: string[]; confidence: number; notes: string }>; rationale: string }> {
  const websiteUrl = String(args.websiteUrl || "").trim();
  const matchDomains = Array.isArray(args.matchDomains)
    ? args.matchDomains.map((d) => String(d || "").toLowerCase()).filter(Boolean)
    : [];
  const max = Math.max(3, Math.min(60, Number(args.max || 20)));
  const hint = String(args.hint || "").trim();

  const sys = `You are an assistant for a cold email CRM.

Task: Find company email addresses associated with a website using web search.

Rules:
- Use web search results only. Do NOT assume or invent emails.
- Only include emails that match the allowed company domains (or subdomains).
- Output MUST be valid JSON (no markdown).
- Output MUST be an object: {"emails": [{"email": string, "evidenceUrls": string[], "confidence": number, "notes": string}], "rationale": string}.
- confidence is 0..1. Be conservative.
- evidenceUrls: up to 3 URLs where the email appears.
- notes: 1 short sentence about what evidence you found.
- Return at most ${max} emails.
`;

  const user = `Website: ${websiteUrl}
Allowed company domains: ${JSON.stringify(matchDomains)}
Optional operator hint: ${hint || "(none)"}

Use web search to find the company's published email addresses and return JSON ONLY.`;

  const { text } = await responsesWithWebSearch({
    instructions: sys,
    input: user,
    featureTag: "leads_websearch_emails",
  });

  try {
    const parsed = extractJsonObject(text);
    const arr = Array.isArray((parsed as any)?.emails) ? (parsed as any).emails : [];

    const allowed = new Set(matchDomains);
    const out = arr
      .map((x: any) => ({
        email: String(x?.email || "").trim().toLowerCase(),
        evidenceUrls: Array.isArray(x?.evidenceUrls) ? x.evidenceUrls.map((u: any) => String(u || "").trim()).filter(Boolean).slice(0, 3) : [],
        confidence: Math.max(0, Math.min(1, Number(x?.confidence ?? 0))),
        notes: String(x?.notes || "").trim(),
      }))
      .filter((x: any) => x.email && x.email.includes("@"))
      .filter((x: any) => {
        if (!allowed.size) return true;
        const dom = x.email.split("@")[1] || "";
        return Array.from(allowed).some((d) => dom === d || dom.endsWith(`.${d}`));
      });

    // Dedupe by email, keep max confidence.
    const by = new Map<string, { email: string; evidenceUrls: string[]; confidence: number; notes: string }>();
    for (const it of out) {
      const prev = by.get(it.email);
      if (!prev || it.confidence > prev.confidence) by.set(it.email, it);
    }

    const emails = Array.from(by.values())
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, max);

    return { emails, rationale: String((parsed as any)?.rationale || "").trim() };
  } catch {
    return { emails: [], rationale: "" };
  }
}


export async function aiGenerateWarmupTemplates(args: GenerateArgs): Promise<WarmupTemplate[]> {
  const count = Math.max(1, Math.min(20, Number(args.count || 5)));
  const type = args.type === "reply" ? "reply" : "initial";
  const tone = String(args.tone || "friendly, casual, human");
  const language = String(args.language || "English");
  const context = String(args.context || "").trim();

  const sys = `You write extremely realistic email warmup templates.\n\nRules:\n- Output MUST be valid JSON (no markdown).\n- Output MUST be an object with key \'templates\' which is an array.\n- Each element: {"name": string, "subject": string, "text": string}.\n- Keep each template under ~80 words.\n- Avoid salesy language. No links. No tracking words.\n- Make it look like normal human conversation.\n- Vary wording (no repeated phrases).\n- Use language: ${language}.\n- Tone: ${tone}.\n- Template type: ${type}.\n`;

  const user = `Generate ${count} ${type} templates for email warmup.\n\nOptional context (if provided, lightly reflect it without sounding marketing-heavy):\n${context ? context : "(none)"}\n\nReturn JSON ONLY like: {"templates": [...]} .`;

  const content = await chatCompletion(
    [
    { role: "system", content: sys },
    { role: "user", content: user },
    ],
    "warmup"
  );

  // Primary: parse as object
  try {
    const parsed = JSON.parse(content);
    const arr = Array.isArray(parsed?.templates) ? parsed.templates : [];
    return arr
      .map((t: any) => ({
        name: String(t?.name || "Warmup"),
        subject: String(t?.subject || (type === "reply" ? "Re:" : "Quick question")),
        text: String(t?.text || ""),
      }))
      .filter((t: WarmupTemplate) => t.text.trim().length > 0)
      .slice(0, count);
  } catch {
    // Fallback: find array
    const arr = extractJsonArray(content);
    return arr
      .map((t: any) => ({
        name: String(t?.name || "Warmup"),
        subject: String(t?.subject || (type === "reply" ? "Re:" : "Quick question")),
        text: String(t?.text || ""),
      }))
      .filter((t: WarmupTemplate) => t.text.trim().length > 0)
      .slice(0, count);
  }
}

export async function aiSuggestLeadTags(args: {
  leads: LeadMini[];
  maxTags?: number;
  hint?: string;
}): Promise<{ tags: string[]; rationale: string }> {
  const leads = Array.isArray(args.leads) ? args.leads : [];
  const maxTags = Math.max(3, Math.min(20, Number(args.maxTags || 10)));
  const hint = String(args.hint || "").trim();

  // Keep payload small for token efficiency.
  const compact = leads.slice(0, 50).map((l) => ({
    email: String(l.email || ""),
    firstName: l.firstName || null,
    lastName: l.lastName || null,
    company: l.company || null,
    website: l.website || null,
    tags: (l.tags || []).slice(0, 12),
  }));

  const sys = `You are an assistant for a cold email CRM.

Your job: suggest helpful, consistent lead tags for segmentation.

Rules:
- Output MUST be valid JSON (no markdown).
- Output MUST be an object: {"tags": string[], "rationale": string}.
- Tags MUST be lowercase, short (1-3 words), and safe for CSV.
- Prefer broad categories that help segmentation: industry, role/persona, geo, company size hints, tech stack hints.
- Do NOT include PII beyond what is already provided.
- Avoid duplicates and near-duplicates.
- Return at most ${maxTags} tags.
`;

  const user = `Given these leads (partial fields), propose a tag set that would be useful to apply to ALL of them (shared tags). If there is no strong commonality, return general-but-useful tags based on the available signals.

Optional operator hint (may be empty): ${hint || "(none)"}

Leads JSON:\n${JSON.stringify(compact)}\n\nReturn JSON ONLY.`;

  const content = await chatCompletion(
    [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    "leads"
  );

  try {
    const parsed = JSON.parse(content);
    const tags = Array.isArray(parsed?.tags) ? parsed.tags.map((t: any) => String(t || "").trim().toLowerCase()).filter(Boolean) : [];
    const uniq = Array.from(new Set(tags)).slice(0, maxTags);
    return { tags: uniq, rationale: String(parsed?.rationale || "").trim() };
  } catch {
    // fallback: attempt array extraction
    const arr = extractJsonArray(content).map((t) => String(t || "").trim().toLowerCase()).filter(Boolean);
    const uniq = Array.from(new Set(arr)).slice(0, maxTags);
    return { tags: uniq, rationale: "" };
  }
}

type LeadEnrichIn = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  website?: string | null;
};

type LeadEnrichOut = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  website?: string | null;
};

export async function aiEnrichLeads(args: {
  leads: LeadEnrichIn[];
  hint?: string;
}): Promise<{ leads: LeadEnrichOut[]; rationale: string }> {
  const leads = Array.isArray(args.leads) ? args.leads : [];
  const hint = String(args.hint || "").trim();

  const compact = leads.slice(0, 80).map((l) => ({
    id: String(l.id),
    email: String(l.email || ""),
    firstName: l.firstName ?? null,
    lastName: l.lastName ?? null,
    company: l.company ?? null,
    website: l.website ?? null,
  }));

  const sys = `You are an assistant for a cold email CRM.

Task: enrich lead records using ONLY the signals provided (primarily the email address + existing fields).

Rules:
- Output MUST be valid JSON (no markdown).
- Output MUST be an object: {"leads": Lead[], "rationale": string}.
- Each Lead: {"id": string, "firstName"?: string|null, "lastName"?: string|null, "company"?: string|null, "website"?: string|null}.
- Be conservative: if uncertain, return null for that field.
- Names: infer from email local-part when it clearly looks like a name (e.g. john.smith). Do not guess if it's ambiguous.
- Company: infer from domain when clear (e.g. acme.com -> Acme). Avoid guessing for generic providers (gmail.com, outlook.com, yahoo.com, icloud.com).
- Website:
  - If the operator hint provides a specific company website (e.g. "Company website: https://acme.com"), prefer using that exact URL for matching leads.
  - Otherwise, if company is clear, set website to https://<domain> (use the email domain).
  - Otherwise null.
- Never invent personal facts (role, location, etc.).
- Do not include any extra keys.
`;

  const user = `Optional operator hint (may be empty): ${hint || "(none)"}

Leads JSON:\n${JSON.stringify(compact)}\n\nReturn JSON ONLY.`;

  const content = await chatCompletion(
    [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    "leads"
  );

  try {
    const parsed = JSON.parse(content);
    const arr = Array.isArray(parsed?.leads) ? parsed.leads : [];
    const out = arr
      .map((x: any) => ({
        id: String(x?.id || ""),
        firstName: x?.firstName === undefined ? undefined : x?.firstName === null ? null : String(x.firstName),
        lastName: x?.lastName === undefined ? undefined : x?.lastName === null ? null : String(x.lastName),
        company: x?.company === undefined ? undefined : x?.company === null ? null : String(x.company),
        website: x?.website === undefined ? undefined : x?.website === null ? null : String(x.website),
      }))
      .filter((x: LeadEnrichOut) => !!x.id);

    return { leads: out, rationale: String(parsed?.rationale || "").trim() };
  } catch {
    return { leads: [], rationale: "" };
  }
}

export async function aiSuggestCompanyEmails(args: {
  websiteUrl: string;
  matchDomains: string[];
  max?: number;
  hint?: string;
}): Promise<{ emails: Array<{ email: string; confidence: number }>; rationale: string }> {
  const websiteUrl = String(args.websiteUrl || "").trim();
  const matchDomains = Array.isArray(args.matchDomains) ? args.matchDomains.map((d) => String(d || "").toLowerCase()).filter(Boolean) : [];
  const max = Math.max(5, Math.min(60, Number(args.max || 20)));
  const hint = String(args.hint || "").trim();

  const sys = `You are an assistant for a cold email CRM.

Task: suggest likely company email inboxes for outreach, using ONLY the website/domain signals provided.

Rules:
- Output MUST be valid JSON (no markdown).
- Output MUST be an object: {"emails": {"email": string, "confidence": number}[], "rationale": string}.
- Return at most ${max} items.
- IMPORTANT: These are UNVERIFIED suggestions. Do not claim they are published or confirmed.
- Prefer functional/shared inboxes (info, hello, contact, support, sales, partnerships, careers, press, legal, privacy, billing).
- Only include emails that match the allowed company domain(s) provided.
- confidence is a 0..1 number. Be conservative.
- Do not include any extra keys.
`;

  const user = `Company website: ${websiteUrl}
Allowed company domains: ${JSON.stringify(matchDomains)}
Optional operator hint: ${hint || "(none)"}

Return JSON ONLY.`;

  const content = await chatCompletion(
    [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    "leads"
  );

  try {
    const parsed = JSON.parse(content);
    const arr = Array.isArray(parsed?.emails) ? parsed.emails : [];

    const allowed = new Set(matchDomains);
    const out = arr
      .map((x: any) => ({
        email: String(x?.email || "").trim().toLowerCase(),
        confidence: Math.max(0, Math.min(1, Number(x?.confidence ?? 0))),
      }))
      .filter((x: any) => x.email && x.email.includes("@"))
      .filter((x: any) => {
        const dom = x.email.split("@")[1] || "";
        return allowed.size ? Array.from(allowed).some((d) => dom === d || dom.endsWith(`.${d}`)) : true;
      });

    // Dedupe by email, keep highest confidence.
    const by = new Map<string, { email: string; confidence: number }>();
    for (const it of out) {
      const prev = by.get(it.email);
      if (!prev || it.confidence > prev.confidence) by.set(it.email, it);
    }

    const emails = Array.from(by.values())
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, max);

    return { emails, rationale: String(parsed?.rationale || "").trim() };
  } catch {
    return { emails: [], rationale: "" };
  }
}

export async function aiAnalyzeWebsiteEmails(args: {
  websiteUrl: string;
  emails: Array<{ email: string; evidenceUrls?: string[] }>;
  hint?: string;
}): Promise<{
  emails: Array<{ email: string; purpose: string; recommended: boolean; confidence: number; notes: string }>;
  rationale: string;
}> {
  const websiteUrl = String(args.websiteUrl || "").trim();
  const hint = String(args.hint || "").trim();
  const emailsIn = Array.isArray(args.emails) ? args.emails : [];

  // Keep payload small.
  const compact = emailsIn
    .map((e) => ({
      email: String(e?.email || "").trim().toLowerCase(),
      evidenceUrls: Array.isArray(e?.evidenceUrls) ? e.evidenceUrls.slice(0, 5).map((u) => String(u || "").trim()).filter(Boolean) : [],
    }))
    .filter((e) => e.email && e.email.includes("@"))
    .slice(0, 80);

  const sys = `You are an assistant for a cold email CRM.

Task: explain what each email address is likely used for, and whether it is appropriate for cold outreach.

Rules:
- Output MUST be valid JSON (no markdown).
- Output MUST be an object: {"emails": Email[], "rationale": string}.
- Email: {"email": string, "purpose": string, "recommended": boolean, "confidence": number, "notes": string}.
- purpose should be one of: "sales", "support", "partnerships", "careers", "press", "billing", "legal", "privacy", "general", "other".
- recommended=true only if it is reasonable for business outreach (e.g., sales, partnerships, general). recommended=false for support/careers/legal/privacy.
- confidence is 0..1. Be conservative.
- notes should be 1-2 short sentences, practical for operators.
- Use the provided evidence URLs only as context; do not claim verification beyond that.
`;

  const user = `Website: ${websiteUrl}
Optional operator hint: ${hint || "(none)"}

Emails (with where they were seen, if available):
${JSON.stringify(compact)}

Return JSON ONLY.`;

  const content = await chatCompletion(
    [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    "leads"
  );

  try {
    const parsed = JSON.parse(content);
    const arr = Array.isArray(parsed?.emails) ? parsed.emails : [];
    const out = arr
      .map((x: any) => ({
        email: String(x?.email || "").trim().toLowerCase(),
        purpose: String(x?.purpose || "other").trim().toLowerCase(),
        recommended: Boolean(x?.recommended),
        confidence: Math.max(0, Math.min(1, Number(x?.confidence ?? 0))),
        notes: String(x?.notes || "").trim(),
      }))
      .filter((x: any) => x.email && x.email.includes("@"));

    // Dedupe by email, keep highest confidence.
    const by = new Map<string, { email: string; purpose: string; recommended: boolean; confidence: number; notes: string }>();
    for (const it of out) {
      const prev = by.get(it.email);
      if (!prev || it.confidence > prev.confidence) by.set(it.email, it);
    }

    const emails = Array.from(by.values()).slice(0, compact.length || 80);
    return { emails, rationale: String(parsed?.rationale || "").trim() };
  } catch {
    return { emails: [], rationale: "" };
  }
}

export async function aiSuggestLeadViews(args: {
  total: number;
  statusCounts: Record<string, number>;
  topTags: Array<{ tag: string; count: number }>;
}): Promise<{ views: Array<{ name: string; description: string; payload: any }> }> {
  const total = Number(args.total || 0);
  const statusCounts = args.statusCounts || {};
  const topTags = Array.isArray(args.topTags) ? args.topTags.slice(0, 20) : [];

  const sys = `You are an assistant for a cold email CRM.

Task: suggest useful saved lead views (segments).

Rules:
- Output MUST be valid JSON (no markdown).
- Output MUST be an object: {"views": View[]}
- Each View: {"name": string, "description": string, "payload": {"q": string, "status": string, "tag": string, "contacted": string, "pageSize": number}}
- payload.status must be one of: "all", "active", "replied", "unsubscribed", "bounced", "suppressed".
- payload.contacted must be "" (any) or "1" (contacted) or "0" (not contacted).
- payload.tag is a substring filter (lowercase), keep it short.
- Provide 5-8 views.
- Prefer views that help operators take action: cleanup, follow-up, segmentation, deliverability.
`;

  const user = `Workspace lead stats:
- total: ${total}
- statusCounts: ${JSON.stringify(statusCounts)}
- topTags: ${JSON.stringify(topTags)}

Return JSON ONLY.`;

  const content = await chatCompletion(
    [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    "leads"
  );

  try {
    const parsed = JSON.parse(content);
    const arr = Array.isArray(parsed?.views) ? parsed.views : [];
    const views = arr
      .map((v: any) => ({
        name: String(v?.name || "").trim(),
        description: String(v?.description || "").trim(),
        payload: {
          q: String(v?.payload?.q || ""),
          status: String(v?.payload?.status || "all"),
          tag: String(v?.payload?.tag || ""),
          contacted: String(v?.payload?.contacted || ""),
          pageSize: Number(v?.payload?.pageSize || 50),
        },
      }))
      .filter((v: any) => v.name);

    return { views: views.slice(0, 10) };
  } catch {
    return { views: [] };
  }
}

// -------------------------
// Replies AI (Shared Inbox)
// -------------------------

export type AiReplyClassification = {
  sentiment: "positive" | "negative" | "neutral" | "ooo" | "unsubscribe" | "spam" | "unknown";
  intent: "meeting_request" | "question" | "pricing" | "follow_up" | "other";
  confidence: number; // 0..1
  summary: string;
  suggestedAction: "send_reply" | "needs_human" | "ignore" | "close_thread" | "mark_unsubscribe";
  draftSubject?: string;
  draftBodyText?: string;
};

function clamp01(n: any) {
  const x = Number(n);
  if (!isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function normEnum<T extends string>(v: any, allowed: T[], fallback: T): T {
  const s = String(v || "").trim() as T;
  return (allowed as any).includes(s) ? (s as T) : fallback;
}

export async function aiClassifyAndDraftReply(args: {
  workspaceName?: string;
  mailboxFrom?: string;
  campaignName?: string | null;
  leadEmail: string;
  leadName?: string | null;
  lastOutboundSubject?: string | null;
  lastOutboundBody?: string | null;
  inboundSubject?: string | null;
  inboundBodyText: string;
  bookingLink?: string | null;
  language?: string | null;
}): Promise<AiReplyClassification> {
  const language = (args.language || "English").trim() || "English";

  const system = `You are an assistant inside a cold email CRM (shared team inbox).

Goal: classify an inbound reply and, if appropriate, draft a helpful response.

Hard rules:
- Do NOT invent facts. If you don't know something, keep it generic.
- Respect unsubscribe/opt-out requests: if the reply indicates unsubscribe, set sentiment="unsubscribe" and suggestedAction="mark_unsubscribe" and do NOT draft a persuasive reply.
- If the reply is negative (not interested), set sentiment="negative" and suggestedAction="ignore" or "close_thread".
- If the reply is out-of-office/auto-reply, set sentiment="ooo" and suggestedAction="ignore".
- If the reply is positive or asks to meet, set sentiment="positive" and draft a short reply.
- Keep the draft concise (max ~120 words), 1-2 short paragraphs.
- If a booking link is provided and the intent is meeting_request, include it.

Output MUST be valid JSON (no markdown), with exactly this shape:
{
  "sentiment": "positive|negative|neutral|ooo|unsubscribe|spam|unknown",
  "intent": "meeting_request|question|pricing|follow_up|other",
  "confidence": number,
  "summary": string,
  "suggestedAction": "send_reply|needs_human|ignore|close_thread|mark_unsubscribe",
  "draftSubject": string (optional),
  "draftBodyText": string (optional)
}`;

  const user = {
    workspace: args.workspaceName || "",
    mailboxFrom: args.mailboxFrom || "",
    campaign: args.campaignName || "",
    lead: { email: args.leadEmail, name: args.leadName || "" },
    context: {
      lastOutboundSubject: args.lastOutboundSubject || "",
      lastOutboundBody: (args.lastOutboundBody || "").slice(0, 6000),
    },
    inbound: {
      subject: args.inboundSubject || "",
      bodyText: (args.inboundBodyText || "").slice(0, 9000),
    },
    bookingLink: args.bookingLink || "",
    language,
  };

  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user) },
    ],
    "replies"
  );

  const obj = extractJsonObject(raw) || {};

  const sentiment = normEnum(obj.sentiment, ["positive", "negative", "neutral", "ooo", "unsubscribe", "spam", "unknown"], "unknown");
  const intent = normEnum(obj.intent, ["meeting_request", "question", "pricing", "follow_up", "other"], "other");
  const confidence = clamp01(obj.confidence);
  const suggestedAction = normEnum(obj.suggestedAction, ["send_reply", "needs_human", "ignore", "close_thread", "mark_unsubscribe"], "needs_human");
  const summary = String(obj.summary || "").trim().slice(0, 400) || "";

  let draftSubject = typeof obj.draftSubject === "string" ? obj.draftSubject.trim().slice(0, 512) : undefined;
  let draftBodyText = typeof obj.draftBodyText === "string" ? obj.draftBodyText.trim().slice(0, 20_000) : undefined;

  // Safety: never draft for unsubscribe/spam.
  if (sentiment === "unsubscribe" || sentiment === "spam") {
    draftSubject = undefined;
    draftBodyText = undefined;
  }

  return { sentiment, intent, confidence, summary, suggestedAction, draftSubject, draftBodyText };
}

export type AiMeetingTime = {
  hasTime: boolean;
  confidence: number;
  timezone?: string;
  startIso?: string;
  endIso?: string;
  rationale?: string;
};

export async function aiExtractMeetingTimeFromReply(args: {
  inboundSubject?: string | null;
  inboundBodyText: string;
  nowIso?: string;
  defaultTimezone?: string;
  defaultDurationMin?: number;
}): Promise<AiMeetingTime> {
  const nowIso = String(args.nowIso || new Date().toISOString());
  const defaultTimezone = String(args.defaultTimezone || "Asia/Kolkata");
  const defaultDurationMin = Math.max(10, Math.min(180, Number(args.defaultDurationMin || 30)));

  const system = `You are an assistant inside a cold email CRM.

Task: Determine whether an inbound reply contains an explicit meeting time that can be scheduled.

Rules:
- Only set hasTime=true if the reply gives a specific time and date (or a relative time like "tomorrow 3pm") that you can resolve.
- If the reply is vague ("next week", "sometime Monday", "let's talk") set hasTime=false.
- When resolving relative dates, use nowIso as the reference "current time".
- Output RFC3339 timestamps with timezone offset (e.g. 2026-01-19T15:00:00+05:30).
- If only a start time is given, set endIso = startIso + defaultDurationMin minutes.

Output MUST be valid JSON (no markdown) with exactly this shape:
{
  "hasTime": boolean,
  "confidence": number,
  "timezone": string,
  "startIso": string,
  "endIso": string,
  "rationale": string
}`;

  const user = {
    nowIso,
    defaultTimezone,
    defaultDurationMin,
    inbound: {
      subject: String(args.inboundSubject || ""),
      bodyText: String(args.inboundBodyText || "").slice(0, 9000),
    },
  };

  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user) },
    ],
    "replies"
  );

  const obj = extractJsonObject(raw) || {};
  const hasTime = Boolean(obj.hasTime);
  const confidence = clamp01(obj.confidence);
  const timezone = typeof obj.timezone === "string" ? obj.timezone.trim().slice(0, 64) : defaultTimezone;
  const startIso = typeof obj.startIso === "string" ? obj.startIso.trim().slice(0, 64) : undefined;
  const endIso = typeof obj.endIso === "string" ? obj.endIso.trim().slice(0, 64) : undefined;
  const rationale = typeof obj.rationale === "string" ? obj.rationale.trim().slice(0, 300) : undefined;

  if (!hasTime || !startIso) {
    return { hasTime: false, confidence: Math.min(confidence, 0.49), rationale };
  }

  return { hasTime: true, confidence, timezone, startIso, endIso, rationale };
}




export async function aiSuggestAutofix(args: {
  jobType: string;
  error: string;
  context?: string;
}): Promise<{ summary: string; risk: "safe" | "risky"; suggestedActions: string[] } | null> {
  if (!env.AI_API_KEY) return null;
  const system = [
    "You are an expert email infrastructure SRE helping operate an AlmaLinux 9 mail stack (Exim + Dovecot) controlled by an app.",
    "Your job: suggest a fix plan for a failure. Be conservative and avoid destructive actions.",
    "Return STRICT JSON with keys: summary (string), risk ('safe'|'risky'), suggestedActions (array of strings).",
    "Only suggest actions from this allowed set:",
    "- restorecon -Rv <path>",
    "- semanage fcontext -a -t <type> '<path_regex>'",
    "- setsebool -P <boolean> on|off",
    "- systemctl restart|reload <service>",
    "- chown/chmod on known paths: /var/vmail, /etc/exim, /etc/exim/maps, /etc/mailstack",
    "- run /root/coldmail-pro/scripts/mailstack.sh or mailstack-addon.sh with a specific subcommand",
    "If the fix could delete data or DNS, set risk='risky' and still suggest it.",
  ].join("\n");

  const user = [
    `Job type: ${args.jobType}`,
    `Error: ${args.error}`,
    args.context ? `Context:\n${args.context}` : "",
  ].filter(Boolean).join("\n\n");

  try {
    const res = await aiChatJson<{ summary: string; risk: "safe" | "risky"; suggestedActions: string[] }>([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    if (!res?.summary || !res?.risk || !Array.isArray(res?.suggestedActions)) return null;
    return {
      summary: String(res.summary),
      risk: res.risk === "safe" ? "safe" : "risky",
      suggestedActions: res.suggestedActions.map((s) => String(s)).slice(0, 8),
    };
  } catch {
    return null;
  }
}
