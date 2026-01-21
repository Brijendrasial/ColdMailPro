import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function clampInt(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

export async function POST(req: NextRequest) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const ids = Array.isArray(body?.ids) ? body.ids.map((x: any) => String(x)).filter(Boolean) : [];
  const patchIn = body?.patch || {};
  if (ids.length === 0) return NextResponse.json({ error: "NO_IDS" }, { status: 400 });

  const patch: any = {};
  if ("isActive" in patchIn) patch.isActive = !!patchIn.isActive;
  if ("warmupEnabled" in patchIn) patch.warmupEnabled = !!patchIn.warmupEnabled;
  if ("dailyLimit" in patchIn) patch.dailyLimit = clampInt(Number(patchIn.dailyLimit), 1, 100000);
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "NO_PATCH" }, { status: 400 });

  const res = await prisma.mailbox.updateMany({
    where: { workspaceId: s.wid, id: { in: ids } },
    data: patch,
  });

  return NextResponse.json({ ok: true, updated: res.count });
}
