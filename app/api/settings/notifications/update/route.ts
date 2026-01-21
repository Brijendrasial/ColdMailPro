import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

  const notifications = body?.notifications ?? body;
  if (!notifications || typeof notifications !== "object") {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const me = await prisma.user.findUnique({
    where: { id: s.uid },
    select: { settingsJson: true },
  });

  const current = (me?.settingsJson as any) || {};
  const next = deepMerge(current, { notifications });

  await prisma.user.update({
    where: { id: s.uid },
    data: { settingsJson: next as any },
  });

  return NextResponse.json({ ok: true, settingsJson: next });
}
