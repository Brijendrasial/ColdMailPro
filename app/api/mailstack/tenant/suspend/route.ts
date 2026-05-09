import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const form = await req.formData();
  const tenantId = String(form.get("tenantId") || "").trim();
  if (!tenantId) return NextResponse.redirect(absoluteUrl(req, "/app/mailstack"));

  const t = await prisma.mailstackTenant.findFirst({ where: { id: tenantId, workspaceId: s.wid } });
  if (!t) return NextResponse.redirect(absoluteUrl(req, "/app/mailstack"));

  const job = await prisma.job.create({
    data: {
      type: "mailstack:tenant-suspend",
      payload: JSON.stringify({ tenantId }),
      runAt: new Date(),
      status: "queued",
    },
  });

  await prisma.mailstackTenant.update({
    where: { id: tenantId },
    data: { lastJobId: job.id, lastJobStatus: "queued" },
  });

  try { await prisma.jobLog.create({ data: { jobId: job.id, line: "Queued suspend" } }); } catch {}

  return NextResponse.redirect(absoluteUrl(req, `/app/mailstack/${tenantId}`));
}
