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

async function readDomainId(req: NextRequest): Promise<string> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      const j = await req.json();
      return String((j as any)?.domainId || "");
    } catch {
      return "";
    }
  }
  try {
    const f = await req.formData();
    return String(f.get("domainId") || "");
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const domainId = (await readDomainId(req)).trim();
  if (!domainId) return NextResponse.json({ ok: false, error: "missing_domainId" }, { status: 400 });

  const d = await prisma.domain.findFirst({ where: { id: domainId, workspaceId: s.wid } });
  if (!d) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  // Enqueue server-side removal on Mailstack (best-effort). We do this BEFORE deleting DB rows
  // so we can discover tenant links even if the deletion is immediate.
  try {
    const msAny: any = prisma as any;
    if (msAny.mailstackTenantDomain?.findMany) {
      const links = await msAny.mailstackTenantDomain.findMany({
        where: { domainName: d.name, tenant: { workspaceId: s.wid } },
        select: { tenantId: true },
      });
      const tenantIds = Array.from(new Set(links.map((x: any) => String(x.tenantId)))).filter(Boolean);
      for (const tenantId of tenantIds) {
        await enqueueJob("mailstack:domain-delete", { tenantId, domainName: d.name });
      }
    }
  } catch {
    // If Prisma client is stale / models missing, we still proceed with app-side deletion.
  }

  const suffix = `@${d.name.toLowerCase()}`;

  const result = await prisma.$transaction(async (tx) => {
    // 1) Delete app Mailboxes that belong to this domain
    const mb = await tx.mailbox.findMany({
      where: {
        workspaceId: s.wid,
        OR: [{ fromEmail: { endsWith: suffix } }, { smtpUser: { endsWith: suffix } }],
      },
      select: { id: true },
    });
    const mailboxIds = mb.map((x) => x.id);
    const deletedMailboxes = mailboxIds.length
      ? (await tx.mailbox.deleteMany({ where: { id: { in: mailboxIds } } })).count
      : 0;

    // 2) Unlink/delete Mailstack side records if those models exist
    const txAny: any = tx as any;
    let affectedTenants = 0;
    if (txAny.mailstackTenantDomain?.findMany) {
      const links = await txAny.mailstackTenantDomain.findMany({
        where: { domainName: d.name, tenant: { workspaceId: s.wid } },
        select: { tenantId: true },
      });
      const tenantIds = Array.from(new Set(links.map((x: any) => String(x.tenantId)))).filter(Boolean);
      affectedTenants = tenantIds.length;

      if (tenantIds.length) {
        // Remove mailstack mailbox/user rows for this domain
        try {
          await txAny.mailstackMailbox.deleteMany({ where: { tenantId: { in: tenantIds }, email: { endsWith: suffix } } });
        } catch {}
        try {
          await txAny.mailstackTenantUser.deleteMany({ where: { tenantId: { in: tenantIds }, email: { endsWith: suffix } } });
        } catch {}

        // Remove the tenant-domain link
        try {
          await txAny.mailstackTenantDomain.deleteMany({ where: { tenantId: { in: tenantIds }, domainName: d.name } });
        } catch {}
      }
    }

    // 3) Remove historical DNS-check jobs for this domain (optional cleanup)
    try {
      await tx.job.deleteMany({ where: { type: "domain_dns_check", payload: { contains: domainId } } });
    } catch {
      // ignore if Job model isn't available (stale client) or table missing
    }

    // 4) Delete the Domain itself
    const deletedDomains = (await tx.domain.deleteMany({ where: { id: domainId, workspaceId: s.wid } })).count;

    return { deletedMailboxes, deletedDomains, affectedTenants };
  });

  return NextResponse.json({ ok: true, ...result });
}
