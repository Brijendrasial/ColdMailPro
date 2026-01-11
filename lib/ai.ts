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

async function chatCompletion(messages: ChatMessage[]) {
  if (!env.WARMUP_AI_ENABLED) {
    throw new Error("WARMUP_AI_DISABLED");
  }
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

export async function aiGenerateWarmupTemplates(args: GenerateArgs): Promise<WarmupTemplate[]> {
  const count = Math.max(1, Math.min(20, Number(args.count || 5)));
  const type = args.type === "reply" ? "reply" : "initial";
  const tone = String(args.tone || "friendly, casual, human");
  const language = String(args.language || "English");
  const context = String(args.context || "").trim();

  const sys = `You write extremely realistic email warmup templates.\n\nRules:\n- Output MUST be valid JSON (no markdown).\n- Output MUST be an object with key \'templates\' which is an array.\n- Each element: {"name": string, "subject": string, "text": string}.\n- Keep each template under ~80 words.\n- Avoid salesy language. No links. No tracking words.\n- Make it look like normal human conversation.\n- Vary wording (no repeated phrases).\n- Use language: ${language}.\n- Tone: ${tone}.\n- Template type: ${type}.\n`;

  const user = `Generate ${count} ${type} templates for email warmup.\n\nOptional context (if provided, lightly reflect it without sounding marketing-heavy):\n${context ? context : "(none)"}\n\nReturn JSON ONLY like: {"templates": [...]} .`;

  const content = await chatCompletion([
    { role: "system", content: sys },
    { role: "user", content: user },
  ]);

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
