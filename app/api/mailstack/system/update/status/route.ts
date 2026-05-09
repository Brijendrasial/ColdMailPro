import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function payloadWorkspaceMatches(payload: string, workspaceId: string) {
  try {
    const parsed = JSON.parse(payload || "{}");
    return parsed?.workspaceId === workspaceId;
  } catch {
    return payload.includes(`"workspaceId":"${workspaceId}"`);
  }
}

export async function GET(req: NextRequest) {
  let session: any;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const url = new URL(req.url);
  const jobId = (url.searchParams.get("jobId") || "").trim();
  if (!jobId) {
    return NextResponse.json({ ok: false, error: "Missing jobId" }, { status: 400 });
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      type: true,
      payload: true,
      status: true,
      attempts: true,
      lastError: true,
      createdAt: true,
      runAt: true,
      lockedAt: true,
    },
  });

  if (!job || job.type !== "mailstack:system-update" || !payloadWorkspaceMatches(job.payload, session.wid)) {
    return NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
  }

  const logs = await prisma.jobLog.findMany({
    where: { jobId },
    orderBy: { createdAt: "asc" },
    take: 500,
    select: { id: true, createdAt: true, line: true },
  }).catch(() => [] as any[]);

  return NextResponse.json({
    ok: true,
    job: {
      id: job.id,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      lastError: job.lastError,
      createdAt: job.createdAt,
      runAt: job.runAt,
      lockedAt: job.lockedAt,
    },
    logs,
  });
}
