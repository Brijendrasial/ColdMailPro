import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { absoluteUrl } from "@/lib/url";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const form = await req.formData();

  const serverIp = String(form.get("serverIp") || "").trim();
  const outboundIpsText = String(form.get("outboundIps") || "").trim();
  const tokenRaw = String(form.get("cloudflareToken") || "").trim();

  const data: any = {};
  if (serverIp) data.serverIp = serverIp;
  if (outboundIpsText) data.outboundIpsText = outboundIpsText;
  if (tokenRaw) data.cloudflareTokenEnc = encrypt(tokenRaw);

  await prisma.mailstackConfig.upsert({
    where: { workspaceId: s.wid },
    create: { workspaceId: s.wid, ...data },
    update: data,
  });

  // If a Cloudflare token was provided, auto-init Cloudflare on the server.
  // This writes /etc/mailstack/cloudflare.env via mailstack-addon.sh (worker job).
  if (tokenRaw) {
    const job = await prisma.job.create({
      data: {
        type: "mailstack:init-cloudflare",
        payload: JSON.stringify({ workspaceId: s.wid }),
        runAt: new Date(),
        status: "queued",
      },
    });
    try {
      await prisma.jobLog.create({ data: { jobId: job.id, line: "Queued init-cloudflare (token saved from Mailstack settings)" } });
    } catch {}
  }

  return NextResponse.redirect(absoluteUrl(req, "/app/mailstack"));
}
