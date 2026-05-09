import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function deepMerge(base: any, patch: any) {
  if (Array.isArray(base) || Array.isArray(patch)) return patch;
  if (typeof base !== "object" || base === null) return patch;
  if (typeof patch !== "object" || patch === null) return patch;
  const out: any = { ...base };
  for (const k of Object.keys(patch)) out[k] = deepMerge(base[k], patch[k]);
  return out;
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({}));

  const deliverability = body?.deliverability ?? body;
  if (!deliverability || typeof deliverability !== "object") {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const ws = await prisma.workspace.findUnique({
    where: { id: s.wid },
    select: { settingsJson: true },
  });

  const current = (ws?.settingsJson as any) || {};
  const next = deepMerge(current, { deliverability });

  await prisma.workspace.update({
    where: { id: s.wid },
    data: { settingsJson: next as any },
  });

  return NextResponse.json({ ok: true, settingsJson: next });
}
