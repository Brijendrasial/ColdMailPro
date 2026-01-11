import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/url";

async function readTenantId(req: NextRequest): Promise<{ tenantId: string; wantsJson: boolean }> {
  const accept = (req.headers.get("accept") || "").toLowerCase();
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  const wantsJson = accept.includes("application/json") || ct.includes("application/json");
  if (ct.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as any;
    return { tenantId: String(j?.tenantId || "").trim(), wantsJson };
  }
  const form = await req.formData().catch(() => null);
  const tenantId = String(form?.get("tenantId") || "").trim();
  return { tenantId, wantsJson };
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const { tenantId, wantsJson } = await readTenantId(req);
  if (!tenantId) {
    return wantsJson
      ? NextResponse.json({ error: "MISSING_TENANT" }, { status: 400 })
      : NextResponse.redirect(absoluteUrl(req, "/app/mailstack"));
  }

  const t = await prisma.mailstackTenant.findFirst({ where: { id: tenantId, workspaceId: s.wid } });
  if (!t) {
    return wantsJson
      ? NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
      : NextResponse.redirect(absoluteUrl(req, "/app/mailstack"));
  }

  const job = await prisma.job.create({
    data: {
      type: "mailstack:tenant-rotate-now",
      payload: JSON.stringify({ tenantId }),
      runAt: new Date(),
      status: "queued",
    },
  });

  await prisma.mailstackTenant.update({
    where: { id: tenantId },
    data: { lastJobId: job.id, lastJobStatus: "queued" },
  });

  try { await prisma.jobLog.create({ data: { jobId: job.id, line: "Queued rotate-now" } }); } catch {}

  if (wantsJson) return NextResponse.json({ ok: true, jobId: job.id, tenantId });
  return NextResponse.redirect(absoluteUrl(req, `/app/mailstack/${tenantId}`));
}
