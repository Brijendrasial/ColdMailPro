import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function clampInt(v: string | null, def: number, min: number, max: number) {
  const n = v ? parseInt(v, 10) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export async function GET(req: Request) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const url = new URL(req.url);
  const mailboxId = url.searchParams.get("mailboxId");
  const take = clampInt(url.searchParams.get("take"), 200, 50, 500);

  // Find recent warmup jobs for this workspace (and mailbox if provided)
  const jobs = await prisma.job.findMany({
    where: {
      type: { startsWith: "warmup_" },
      AND: [
        { payload: { contains: `"workspaceId":"${s.wid}"` } },
        ...(mailboxId ? [{ payload: { contains: `"mailboxId":"${mailboxId}"` } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: { id: true, type: true, status: true, createdAt: true, lastError: true },
  }).catch(() => [] as any[]);

  const jobIds = jobs.map((j: any) => j.id);
  let lines: any[] = [];
  if (jobIds.length) {
    const logs = await prisma.jobLog.findMany({
      where: { jobId: { in: jobIds } },
      orderBy: { createdAt: "desc" },
      take,
      select: { jobId: true, createdAt: true, line: true },
    }).catch(() => [] as any[]);

    const jobMap = new Map(jobIds.map((id: string) => [id, jobs.find((j: any) => j.id === id)]));
    lines = logs.map((l: any) => {
      const j = jobMap.get(l.jobId) as any;
      return {
        ts: l.createdAt,
        jobId: l.jobId,
        jobType: j?.type || "job",
        jobStatus: j?.status || null,
        line: l.line,
      };
    });
  }

  // Also include latest warmup-related AppLog entries (worker/warmup categories)
  const appLogs = await prisma.appLog.findMany({
    where: {
      workspaceId: s.wid,
      category: { in: ["warmup", "worker", "mail"] },
      ...(mailboxId ? { OR: [{ entityId: mailboxId }, { message: { contains: mailboxId } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 80,
    select: { createdAt: true, level: true, category: true, event: true, message: true },
  }).catch(() => [] as any[]);

  const appLines = appLogs.map((l: any) => ({
    ts: l.createdAt,
    jobId: null,
    jobType: `${l.category}:${l.event}`,
    jobStatus: l.level,
    line: l.message || "",
  }));

  const merged = [...lines, ...appLines].sort((a: any, b: any) => new Date(b.ts).getTime() - new Date(a.ts).getTime()).slice(0, take);

  return NextResponse.json({ ok: true, jobs, lines: merged });
}
