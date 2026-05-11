import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { collectBlacklistAssets } from "@/lib/blacklist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeJson(v: any) {
  try { return JSON.parse(String(v || "{}")); } catch { return null; }
}

export async function GET() {
  let s: any;
  try { s = await requireSession(); } catch { return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }); }

  const assets = await collectBlacklistAssets(prisma, s.wid);
  const jobs = await prisma.job.findMany({
    where: { type: "blacklist_check", status: { in: ["queued", "running", "done", "failed"] }, payload: { contains: s.wid } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, status: true, payload: true, lastError: true, createdAt: true, lockedAt: true },
  });

  const pendingJobs = jobs.filter((j: any) => j.status === "queued" || j.status === "running");
  const latestDone = jobs.find((j: any) => j.status === "done" || j.status === "failed") || null;
  const latestResult = latestDone ? safeJson(latestDone.lastError) : null;
  const byKey = new Map<string, any>();
  if (Array.isArray(latestResult?.results)) {
    for (const r of latestResult.results) byKey.set(`${r.type}:${r.value}`, r);
  }

  const merged = assets.map((a) => ({ ...a, check: byKey.get(`${a.type}:${a.value}`) || null }));
  const listed = merged.filter((a) => a.check?.status === "listed").length;
  const warning = merged.filter((a) => a.check?.status === "warning").length;
  const clear = merged.filter((a) => a.check?.status === "clear").length;

  return NextResponse.json({
    assets: merged,
    summary: {
      total: merged.length,
      domains: merged.filter((a) => a.type === "domain").length,
      ips: merged.filter((a) => a.type === "ip").length,
      listed,
      warning,
      clear,
      unknown: merged.length - listed - warning - clear,
      status: listed ? "listed" : warning ? "warning" : clear ? "clear" : "unknown",
      lastCheckedAt: latestResult?.checkedAt || latestDone?.createdAt?.toISOString?.() || null,
    },
    latestJob: latestDone ? { id: latestDone.id, status: latestDone.status, createdAt: latestDone.createdAt } : null,
    pendingJob: pendingJobs[0] ? { id: pendingJobs[0].id, status: pendingJobs[0].status, createdAt: pendingJobs[0].createdAt } : null,
  });
}
