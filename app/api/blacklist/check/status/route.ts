import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeJson(v: any) { try { return JSON.parse(String(v || "{}")); } catch { return null; } }

export async function GET(req: NextRequest) {
  let s: any;
  try { s = await requireSession(); } catch { return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }); }
  const jobId = req.nextUrl.searchParams.get("jobId") || "";
  if (!jobId) return NextResponse.json({ error: "MISSING_JOB" }, { status: 400 });

  const job = await prisma.job.findFirst({ where: { id: jobId, type: "blacklist_check", payload: { contains: s.wid } } });
  if (!job) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const logs = await prisma.jobLog.findMany({ where: { jobId }, orderBy: { createdAt: "asc" }, take: 250, select: { line: true, createdAt: true } });
  const result = safeJson(job.lastError);
  return NextResponse.json({
    job: { id: job.id, status: job.status, attempts: job.attempts, createdAt: job.createdAt, lockedAt: job.lockedAt },
    result,
    logs,
  });
}
