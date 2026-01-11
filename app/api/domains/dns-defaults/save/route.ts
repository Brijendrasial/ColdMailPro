import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/url";

function safeRedirect(path: string, fallback: string) {
  const p = String(path || "").trim();
  if (!p || !p.startsWith("/")) return fallback;
  return p;
}

// Manual-DNS workspace defaults (no Cloudflare required)
export async function POST(req: NextRequest) {
  const s = await requireSession();
  const form = await req.formData();

  const domainId = String(form.get("domainId") || "").trim();
  const redirectTo = safeRedirect(String(form.get("redirectTo") || ""), domainId ? `/app/domains/${domainId}` : "/app/domains");

  const serverIp = String(form.get("serverIp") || "").trim();
  const outboundIpsText = String(form.get("outboundIps") || "").trim();

  const data: any = {};
  if (serverIp) data.serverIp = serverIp;
  if (outboundIpsText) data.outboundIpsText = outboundIpsText;

  if (Object.keys(data).length) {
    await prisma.mailstackConfig.upsert({
      where: { workspaceId: s.wid },
      create: { workspaceId: s.wid, ...data },
      update: data,
    });
  }

  return NextResponse.redirect(absoluteUrl(req, redirectTo));
}
