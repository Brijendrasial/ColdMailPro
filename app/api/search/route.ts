import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { searchWorkspace } from "@/lib/search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const s = await requireSession();
  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") || "");

  // Guardrails
  const needle = q.trim().slice(0, 120);
  if (!needle) return NextResponse.json({ ok: true, q: "", items: [] });

  const { items } = await searchWorkspace({ workspaceId: s.wid, q: needle, limit: 5 });
  return NextResponse.json({ ok: true, q: needle, items });
}
