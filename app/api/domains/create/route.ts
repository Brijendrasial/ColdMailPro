import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/url";
import { encrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function enqueueJob(type: string, payload: any) {
  const delegate = (prisma as any)?.job;
  if (delegate?.create) {
    return await delegate.create({
      data: {
        type,
        payload: JSON.stringify(payload ?? {}),
        runAt: new Date(),
        status: "queued",
      },
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

function isIPv4(v: string) {
  return /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(v);
}

function parseIps(raw: string): string[] {
  const ips = String(raw || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter(isIPv4);
  return Array.from(new Set(ips));
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const f = await req.formData();
  // Backwards compatible:
  // - old UI used `name` (single domain)
  // - new UI uses `names` (one per line)
  const namesRaw = String(f.get("names") || f.get("name") || "").trim().toLowerCase();
  // DKIM is generated on the MAIL SERVER (Exim) for Mailstack tenants.
  // We keep selector as "default" for compatibility, but do NOT generate keys in-app.
  const dkimSelector = "default";
  const trackingSubdomain = String(f.get("trackingSubdomain") || "").trim() || null;
  const outboundIpsText = String(f.get("outboundIps") || "").trim();
  const serverIp = String(f.get("serverIp") || "").trim();
  const tokenRaw = String(f.get("cloudflareToken") || "").trim();
  const tenantId = String(f.get("tenantId") || "").trim();
  const tenantName = String(f.get("tenantName") || "").trim();

  const names = Array.from(
    new Set(
      namesRaw
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean)
        .filter((x) => x.includes("."))
    )
  ).slice(0, 200);

  if (!names.length) {
    return NextResponse.redirect(absoluteUrl(req, "/app/domains?err=1"));
  }

  // Tenant is REQUIRED for domain creation in the Domains tab.
  // This ensures DKIM keys are created on the server and the printed DNS records are correct.
  if (!tenantId && !tenantName) {
    return NextResponse.redirect(absoluteUrl(req, "/app/domains?err=tenant"));
  }

  // Save optional Mailstack defaults early (used for SPF suggestions + DNS guidance)
  const cfgData: any = {};
  if (serverIp) cfgData.serverIp = serverIp;
  if (outboundIpsText) cfgData.outboundIpsText = outboundIpsText;
  if (tokenRaw) cfgData.cloudflareTokenEnc = encrypt(tokenRaw);
  if (Object.keys(cfgData).length) {
    await prisma.mailstackConfig.upsert({
      where: { workspaceId: s.wid },
      create: { workspaceId: s.wid, ...cfgData },
      update: cfgData,
    });
  }

  // If bulk adding and tracking subdomain does not include %d, only apply to single-domain creates.
  const trackingTemplate = trackingSubdomain && trackingSubdomain.includes("%d") ? trackingSubdomain : null;

  const created: { id: string; name: string }[] = [];
  let skipped = 0;

  for (const name of names) {
    const tracking = trackingTemplate
      ? trackingTemplate.replace(/%d/g, name)
      : (names.length === 1 ? trackingSubdomain : null);

    try {
      const d = await prisma.domain.create({
        data: {
          workspaceId: s.wid,
          name,
          dkimSelector,
          // Do not generate DKIM in-app. Server-side (Exim) key will be synced after prepare/provision.
          dkimPrivate: null,
          dkimPublic: null,
          trackingSubdomain: tracking,
        },
      });
      created.push({ id: d.id, name: d.name });
    } catch {
      // likely duplicate (unique constraint)
      skipped += 1;
    }
  }

  // Link all created domains under the requested Mailstack tenant (create if missing).
  // Guard for older Prisma clients.
  const p: any = prisma as any;
  let tenant: any = null;
  if (created.length && p.mailstackTenantDomain?.createMany && p.mailstackTenant?.findFirst) {
    if (tenantId) {
      tenant = await p.mailstackTenant.findFirst({ where: { id: tenantId, workspaceId: s.wid } });
    } else if (tenantName) {
      const nameNorm = tenantName.trim();
      tenant = await p.mailstackTenant.findFirst({ where: { workspaceId: s.wid, name: nameNorm } });

      if (!tenant?.id) {
        // Create tenant on first domain add.
        const cfg = await p.mailstackConfig?.findUnique?.({ where: { workspaceId: s.wid } }).catch(() => null);
        const resolvedServerIp = String(serverIp || cfg?.serverIp || process.env.HOST_IP || "").trim();
        if (!isIPv4(resolvedServerIp)) {
          return NextResponse.redirect(absoluteUrl(req, "/app/domains?err=serverip"));
        }

        tenant = await p.mailstackTenant.create({
          data: {
            workspaceId: s.wid,
            name: nameNorm,
            serverIp: resolvedServerIp,
            heloTemplate: String(cfg?.heloTemplate || "mail.%d"),
            dmarcPolicy: String(cfg?.dmarcPolicy || "none"),
            dmarcRuaTemplate: String(cfg?.dmarcRuaTemplate || "dmarc@%d"),
            createZones: false,
          },
        });

        // Seed IP pool from selected outbound IPs (or Mailstack config).
        const ips = parseIps(outboundIpsText || String(cfg?.outboundIpsText || ""));
        if (ips.length && p.mailstackTenantIp?.createMany) {
          await p.mailstackTenantIp.createMany({
            data: ips.map((ip) => ({ tenantId: tenant.id, ip })),
            skipDuplicates: true,
          });
        }
      }
    }

    if (tenant?.id) {
      await p.mailstackTenantDomain.createMany({
        data: created.map((d: any) => ({ tenantId: tenant.id, domainName: d.name })),
        skipDuplicates: true,
      });
    }
  }

  // IMPORTANT: Immediately prepare tenant DNS on the server (DKIM keys + dns-records.txt + Exim maps).
  // This ensures the DKIM TXT value shown in the app is the REAL server key.
  if (tenant?.id) {
    await enqueueJob("mailstack:tenant-prepare", { tenantId: tenant.id });
  }

  if (created.length === 1) {
    return NextResponse.redirect(absoluteUrl(req, `/app/domains/${created[0].id}`));
  }

  return NextResponse.redirect(absoluteUrl(req, `/app/domains?created=${created.length}&skipped=${skipped}`));
}