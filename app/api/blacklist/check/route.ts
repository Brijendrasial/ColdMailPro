import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { collectBlacklistAssets, normalizeDomain, normalizeIp } from "@/lib/blacklist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let s: any;
  try { s = await requireSession(); } catch { return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }); }

  const body = (await req.json().catch(() => ({}))) as any;
  const mode = String(body?.mode || "all");
  const assets = await collectBlacklistAssets(prisma, s.wid);
  let targets = assets;

  if (Array.isArray(body?.targets) && body.targets.length) {
    const wanted = new Set<string>();
    for (const raw of body.targets) {
      const type = String(raw?.type || "").toLowerCase();
      const value = type === "ip" ? normalizeIp(raw?.value) : normalizeDomain(raw?.value);
      if ((type === "ip" || type === "domain") && value) wanted.add(`${type}:${value}`);
    }
    targets = assets.filter((a) => wanted.has(`${a.type}:${a.value}`));
  } else if (mode === "listed") {
    // keep target list empty here; worker will still collect all if none are supplied.
    targets = assets;
  }

  if (!targets.length) return NextResponse.json({ error: "NO_TARGETS" }, { status: 400 });

  const existing = await prisma.job.findFirst({
    where: { type: "blacklist_check", status: { in: ["queued", "running"] }, payload: { contains: s.wid } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });
  if (existing) return NextResponse.json({ jobId: existing.id, status: existing.status, reused: true, targetCount: targets.length });

  const job = await prisma.job.create({
    data: {
      type: "blacklist_check",
      payload: JSON.stringify({ workspaceId: s.wid, source: "manual", targets: targets.map(({ type, value, label, sources }) => ({ type, value, label, sources })) }),
      runAt: new Date(),
      status: "queued",
    },
    select: { id: true, status: true },
  });

  return NextResponse.json({ jobId: job.id, status: job.status, reused: false, targetCount: targets.length });
}
