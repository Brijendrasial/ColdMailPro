import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function splitLines(input: string) {
  return input
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const form = await req.formData();

  const name = String(form.get("name") || "").trim();
  const serverIp = String(form.get("serverIp") || "").trim();
  const heloTemplate = String(form.get("heloTemplate") || "mail.%d").trim() || "mail.%d";
  const dmarcPolicy = String(form.get("dmarcPolicy") || "none").trim() || "none";
  const dmarcRuaTemplate = String(form.get("dmarcRuaTemplate") || "dmarc@%d").trim() || "dmarc@%d";
  const createZones = String(form.get("createZones") || "") === "on";

  const domains = splitLines(String(form.get("domains") || ""));
  const ips = splitLines(String(form.get("ips") || ""));
  const users = splitLines(String(form.get("users") || ""));

  if (!name || !serverIp || domains.length === 0 || ips.length === 0 || users.length === 0) {
    return NextResponse.redirect(absoluteUrl(req, "/app/mailstack/new"));
  }

  const tenant = await prisma.mailstackTenant.create({
    data: {
      workspaceId: s.wid,
      name,
      serverIp,
      heloTemplate,
      dmarcPolicy,
      dmarcRuaTemplate,
      createZones,
      domains: { create: domains.map((d) => ({ domainName: d })) },
      ips: { create: ips.map((ip) => ({ ip })) },
      users: { create: users.map((email) => ({ email })) },
    },
  });

  const job = await prisma.job.create({
    data: {
      type: "mailstack:tenant-setup",
      payload: JSON.stringify({ tenantId: tenant.id }),
      runAt: new Date(),
      status: "queued",
    },
  });

  await prisma.mailstackTenant.update({
    where: { id: tenant.id },
    data: { lastJobId: job.id, lastJobStatus: "queued" },
  });

  try { await prisma.jobLog.create({ data: { jobId: job.id, line: `Queued tenant-setup for ${tenant.name}` } }); } catch {}

  return NextResponse.redirect(absoluteUrl(req, `/app/mailstack/${tenant.id}`));
}
