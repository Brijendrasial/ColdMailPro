import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const now = Date.now();
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000);

  const [heartbeat, activeWarmupMailboxes, placement7d, jobStatus, recentFailed] = await Promise.all([
    prisma.appLog.findFirst({
      where: { category: "worker", event: "heartbeat" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, message: true, data: true },
    }).catch(() => null),
    prisma.mailbox.count({ where: { workspaceId: s.wid, isActive: true, warmupEnabled: true } }).catch(() => 0),
    prisma.warmupMessage.groupBy({
      by: ["placement"],
      where: { workspaceId: s.wid, receivedAt: { gte: since7d } },
      _count: { _all: true },
    }).catch(() => [] as any[]),
    prisma.job.groupBy({
      by: ["status"],
      where: { type: { startsWith: "warmup_" }, payload: { contains: `"workspaceId":"${s.wid}"` } },
      _count: { _all: true },
    }).catch(() => [] as any[]),
    prisma.job.findMany({
      where: { status: "failed", type: { startsWith: "warmup_" }, payload: { contains: `"workspaceId":"${s.wid}"` } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, type: true, attempts: true, runAt: true, lastError: true, createdAt: true },
    }).catch(() => [] as any[]),
  ]);

  const placementTotals = { inbox: 0, spam: 0, unknown: 0 } as any;
  for (const r of placement7d as any[]) {
    const k = r.placement === "inbox" ? "inbox" : r.placement === "spam" ? "spam" : "unknown";
    placementTotals[k] += r._count._all;
  }

  const jobTotals: Record<string, number> = { queued: 0, running: 0, done: 0, failed: 0 };
  for (const r of jobStatus as any[]) {
    jobTotals[String(r.status || "queued")] = r._count._all;
  }

  const hbAt = heartbeat?.createdAt ? new Date(heartbeat.createdAt).getTime() : 0;
  const hbAgeSec = hbAt ? Math.floor((Date.now() - hbAt) / 1000) : null;
  const worker = {
    lastHeartbeatAt: heartbeat?.createdAt || null,
    lastHeartbeatAgeSec: hbAgeSec,
    alive: hbAgeSec != null ? hbAgeSec < 140 : false,
    meta: heartbeat?.data || null,
  };

  return NextResponse.json({
    ok: true,
    worker,
    activeWarmupMailboxes,
    placement7d: placementTotals,
    warmupJobs: jobTotals,
    recentFailed,
  });
}
