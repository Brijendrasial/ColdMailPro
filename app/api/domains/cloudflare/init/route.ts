import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/url";

function safeRedirect(path: string, fallback: string) {
  const p = String(path || "").trim();
  if (!p || !p.startsWith("/")) return fallback;
  return p;
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const form = await req.formData().catch(() => null);
  const domainId = String(form?.get("domainId") || "").trim();
  const redirectTo = safeRedirect(String(form?.get("redirectTo") || ""), domainId ? `/app/domains/${domainId}` : "/app/domains");

  const cfg = await prisma.mailstackConfig.findUnique({ where: { workspaceId: s.wid } });
  if (!cfg) return NextResponse.redirect(absoluteUrl(req, redirectTo));

  const job = await prisma.job.create({
    data: {
      type: "mailstack:init-cloudflare",
      payload: JSON.stringify({ workspaceId: s.wid }),
      runAt: new Date(),
      status: "queued",
    },
  });
  try { await prisma.jobLog.create({ data: { jobId: job.id, line: "Queued init-cloudflare" } }); } catch {}

  return NextResponse.redirect(absoluteUrl(req, redirectTo));
}
