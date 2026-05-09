import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function enqueueJob(type: string, payload: any) {
  const delegate = (prisma as any)?.job;
  if (delegate?.create) {
    return await delegate.create({
      data: { type, payload: JSON.stringify(payload ?? {}), runAt: new Date(), status: "queued" },
    });
  }

  const id = crypto.randomUUID();
  const now = new Date();
  await prisma.$executeRaw`
    INSERT INTO \`Job\` (\`id\`, \`type\`, \`payload\`, \`runAt\`, \`status\`, \`attempts\`, \`createdAt\`)
    VALUES (${id}, ${type}, ${JSON.stringify(payload ?? {})}, ${now}, ${"queued"}, ${0}, ${now})
  `;
  return { id } as any;
}

export async function POST(req: NextRequest) {
  const s = await requireSession();

  let body: any = {};
  try {
    body = await req.json();
  } catch {}

  const domainId = String(body?.domainId || "").trim();
  const tenantIdHint = String(body?.tenantId || "").trim();
  if (!domainId) return NextResponse.json({ ok: false, error: "missing_domainId" }, { status: 400 });

  const d = await prisma.domain.findFirst({ where: { id: domainId, workspaceId: s.wid } });
  if (!d) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  // Determine which Mailstack tenant owns this domain.
  let tenantId = "";
  try {
    const msAny: any = prisma as any;
    if (tenantIdHint && msAny.mailstackTenant?.findFirst) {
      const t = await msAny.mailstackTenant.findFirst({ where: { id: tenantIdHint, workspaceId: s.wid }, select: { id: true } });
      if (t?.id) tenantId = String(t.id);
    }

    if (!tenantId && msAny.mailstackTenantDomain?.findFirst) {
      const link = await msAny.mailstackTenantDomain.findFirst({
        where: { domainName: d.name, tenant: { workspaceId: s.wid } },
        select: { tenantId: true },
      });
      if (link?.tenantId) tenantId = String(link.tenantId);
    }
  } catch {}

  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "domain_not_linked_to_tenant" }, { status: 400 });
  }

  const job = await enqueueJob("mailstack:dkim-stage", { tenantId, domainId: d.id, domainName: d.name });
  return NextResponse.json({ ok: true, jobId: String((job as any)?.id || "") });
}
