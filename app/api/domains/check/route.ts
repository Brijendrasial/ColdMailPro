import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readBody(req: NextRequest): Promise<{ domainId?: string; domainIds?: string[] }> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as any;
    const domainId = j?.domainId ? String(j.domainId) : undefined;
    const domainIds = Array.isArray(j?.domainIds) ? j.domainIds.map((x: any) => String(x)) : undefined;
    return { domainId, domainIds };
  }
  const f = await req.formData().catch(() => null);
  if (!f) return {};
  const domainId = f.get("domainId") ? String(f.get("domainId")) : undefined;
  const domainIdsRaw = f.get("domainIds") ? String(f.get("domainIds")) : "";
  const domainIds = domainIdsRaw ? domainIdsRaw.split(",").map((x) => x.trim()).filter(Boolean) : undefined;
  return { domainId, domainIds };
}

export async function POST(req: NextRequest) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const body = await readBody(req);
  const ids = Array.from(new Set([...(body.domainIds || []), ...(body.domainId ? [body.domainId] : [])])).filter(Boolean);
  if (!ids.length) return NextResponse.json({ error: "MISSING_DOMAIN" }, { status: 400 });

  // Ensure domain(s) belong to workspace
  const found = await prisma.domain.findMany({ where: { workspaceId: s.wid, id: { in: ids } }, select: { id: true } });
  const okIds = found.map((d) => d.id);
  if (!okIds.length) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  let enqueued = 0;
  let reused = 0;
  const jobs: Array<{ id: string; domainId: string; status: string; reused: boolean }> = [];

  for (const id of okIds) {
    // avoid duplicate queued/running jobs for same domain, but return the existing job id
    // so the UI can keep polling instead of looking stuck.
    const pending = await prisma.job.findFirst({
      where: { type: "domain_dns_check", status: { in: ["queued", "running"] }, payload: { contains: id } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, payload: true },
    });
    if (pending) {
      jobs.push({ id: pending.id, domainId: id, status: pending.status, reused: true });
      reused++;
      continue;
    }

    const job = await prisma.job.create({
      data: {
        type: "domain_dns_check",
        payload: JSON.stringify({ workspaceId: s.wid, domainId: id, source: "manual" }),
        runAt: new Date(),
        status: "queued",
      },
      select: { id: true, status: true },
    });
    jobs.push({ id: job.id, domainId: id, status: job.status, reused: false });
    enqueued++;
  }

  return NextResponse.json({
    enqueued,
    reused,
    domainIds: okIds,
    jobs,
    jobId: jobs[0]?.id || null,
  });
}
