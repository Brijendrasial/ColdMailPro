import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const s = await requireSession();

  const cfg = await prisma.mailstackConfig.findUnique({ where: { workspaceId: s.wid } });
  if (!cfg) {
    return NextResponse.redirect(absoluteUrl(req, "/app/mailstack"));
  }

  // enqueue job
  const job = await prisma.job.create({
    data: {
      type: "mailstack:init-cloudflare",
      payload: JSON.stringify({ workspaceId: s.wid }),
      runAt: new Date(),
      status: "queued",
    },
  });

  try { await prisma.jobLog.create({ data: { jobId: job.id, line: "Queued init-cloudflare" } }); } catch {}

  return NextResponse.redirect(absoluteUrl(req, "/app/mailstack"));
}
