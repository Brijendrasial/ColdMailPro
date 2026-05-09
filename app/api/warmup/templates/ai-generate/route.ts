import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { aiGenerateWarmupTemplates } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try { await requireSession(); } catch { return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }); }

  const b = await req.json().catch(() => ({} as any));
  const type = b?.type === "reply" ? "reply" : "initial";
  const count = Number(b?.count ?? 5);
  const tone = String(b?.tone || "friendly, casual, human");
  const language = String(b?.language || "English");
  const context = String(b?.context || "");

  try {
    const templates = await aiGenerateWarmupTemplates({ type, count, tone, language, context });
    return NextResponse.json({ ok: true, templates });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 400 });
  }
}
