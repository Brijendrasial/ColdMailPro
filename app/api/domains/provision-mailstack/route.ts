import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/url";
import * as dns from "node:dns/promises";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  domainId: string;
  tenantName: string;
  senderName: string;
  usersRaw: string;
  serverIp?: string;
  ipsRaw?: string;
  heloTemplate?: string;
  dmarcPolicy?: string;
  dmarcRuaTemplate?: string;
  createZones?: boolean;
  wantsJson?: boolean;
};

async function readBody(req: NextRequest): Promise<Body> {
  const accept = (req.headers.get("accept") || "").toLowerCase();
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  const wantsJson = accept.includes("application/json") || ct.includes("application/json");

  if (ct.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as any;
    return {
      domainId: String(j?.domainId || ""),
      tenantName: String(j?.tenantName || ""),
      senderName: String(j?.senderName || ""),
      usersRaw: String(j?.users || j?.usersRaw || ""),
      serverIp: j?.serverIp ? String(j.serverIp) : undefined,
      ipsRaw: j?.ips ? (Array.isArray(j.ips) ? j.ips.join("\n") : String(j.ips)) : undefined,
      heloTemplate: j?.heloTemplate ? String(j.heloTemplate) : undefined,
      dmarcPolicy: j?.dmarcPolicy ? String(j.dmarcPolicy) : undefined,
      dmarcRuaTemplate: j?.dmarcRuaTemplate ? String(j.dmarcRuaTemplate) : undefined,
      createZones: typeof j?.createZones === "boolean" ? j.createZones : undefined,
      wantsJson,
    };
  }

  const f = await req.formData();
  return {
    domainId: String(f.get("domainId") || ""),
    tenantName: String(f.get("tenantName") || ""),
    senderName: String(f.get("senderName") || ""),
    usersRaw: String(f.get("users") || ""),
    serverIp: f.get("serverIp") ? String(f.get("serverIp")) : undefined,
    ipsRaw: f.get("ips") ? String(f.get("ips")) : undefined,
    heloTemplate: f.get("heloTemplate") ? String(f.get("heloTemplate")) : undefined,
    dmarcPolicy: f.get("dmarcPolicy") ? String(f.get("dmarcPolicy")) : undefined,
    dmarcRuaTemplate: f.get("dmarcRuaTemplate") ? String(f.get("dmarcRuaTemplate")) : undefined,
    createZones: f.get("createZones") ? true : undefined,
    wantsJson,
  };
}

async function enqueueJob(type: string, payload: any) {
  // Prisma client can be out-of-sync on some installs if `prisma generate` was skipped.
  // Avoid hard-crashing by falling back to a raw INSERT if the model delegate is missing.
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

/**
 * Some deployments run with Prisma Client generated from an older schema.
 * In those cases, delegates like `prisma.mailstackTenantIP` / `prisma.mailstackTenantDomain`
 * may be missing (or have different casing), which would crash on `.create()`.
 *
 * To keep provisioning working reliably, we use raw SQL for the few simple
 * insert/upsert operations below.
 */

async function ensureTenantIp(tenantId: string, ip: string) {
  const now = new Date();
  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT IGNORE INTO \`MailstackTenantIp\` (\`id\`, \`tenantId\`, \`ip\`, \`createdAt\`)
    VALUES (${id}, ${tenantId}, ${ip}, ${now})
  `;
}

async function replaceTenantIps(tenantId: string, ips: string[]) {
  await prisma.$executeRaw`DELETE FROM \`MailstackTenantIp\` WHERE \`tenantId\` = ${tenantId}`;
  for (const ip of ips) {
    await ensureTenantIp(tenantId, ip);
  }
}

async function linkTenantDomain(tenantId: string, domainName: string) {
  const now = new Date();
  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT IGNORE INTO \`MailstackTenantDomain\` (\`id\`, \`tenantId\`, \`domainName\`, \`createdAt\`)
    VALUES (${id}, ${tenantId}, ${domainName}, ${now})
  `;
}

async function addTenantUsers(tenantId: string, emails: string[]) {
  if (!emails?.length) return;
  const now = new Date();
  for (const email of emails) {
    const id = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT IGNORE INTO \`MailstackTenantUser\` (\`id\`, \`tenantId\`, \`email\`, \`createdAt\`)
      VALUES (${id}, ${tenantId}, ${email}, ${now})
    `;
  }
}

function isIPv4(v: string) {
  return /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(v);
}

function sanitizeTenantName(raw: string) {
  const s = String(raw || "").trim().toLowerCase();
  const cleaned = s
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
  return (cleaned || "tenant").slice(0, 48);
}

function parseUsers(raw: string) {
  const out: string[] = [];
  for (const line of String(raw || "").split(/\r?\n/)) {
    const v = line.trim().toLowerCase();
    if (!v) continue;
    // allow either a local-part (prefix) or a full email address
    if (/^[a-z0-9._-]+$/.test(v) || /^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(v)) {
      out.push(v);
    }
  }
  return Array.from(new Set(out)).slice(0, 200);
}

function parseIps(raw?: string) {
  const out: string[] = [];
  for (const line of String(raw || "").split(/\r?\n/)) {
    const v = line.trim();
    if (!v) continue;
    if (isIPv4(v)) out.push(v);
  }
  return Array.from(new Set(out)).slice(0, 200);
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return await Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

async function resolveTxtFlat(name: string): Promise<string[]> {
  try {
    const rows = await withTimeout(dns.resolveTxt(name), 3500, [] as string[][]);
    return rows.map((parts) => parts.join(""));
  } catch {
    return [];
  }
}

async function resolveMxSafe(name: string): Promise<Array<{ exchange: string; priority: number }>> {
  try {
    const rows = await withTimeout(dns.resolveMx(name), 3500, [] as Array<{ exchange: string; priority: number }>);
    return rows.map((r) => ({ exchange: String(r.exchange || "").trim().toLowerCase().replace(/\.$/, ""), priority: Number(r.priority || 0) }));
  } catch {
    return [];
  }
}

async function resolveASafe(name: string): Promise<string[]> {
  try {
    const rows = await withTimeout(dns.resolve4(name), 3500, [] as string[]);
    return rows.map(String);
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const b = await readBody(req);

  const domainId = String(b.domainId || "");
  const tenantName = sanitizeTenantName(String(b.tenantName || ""));
  const senderName = String(b.senderName || "").trim();
  const users = parseUsers(String(b.usersRaw || ""));
  const wantsJson = !!b.wantsJson;

  if (!domainId) {
    return wantsJson
      ? NextResponse.json({ error: "MISSING_DOMAIN" }, { status: 400 })
      : NextResponse.redirect(absoluteUrl(req, "/app/domains?err=1"));
  }

  const d = await prisma.domain.findFirst({ where: { id: domainId, workspaceId: s.wid } });
  if (!d) {
    return wantsJson
      ? NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
      : NextResponse.redirect(absoluteUrl(req, "/app/domains?err=1"));
  }

  // Determine server IP for mail.<domain> A record suggestion.
  const cfg = await prisma.mailstackConfig.findUnique({ where: { workspaceId: s.wid } });
  // Determine server IP for mail.<domain> A record suggestion.
  // Priority: body.serverIp > cfg.serverIp > env.HOST_IP > "".
  // NOTE: TypeScript forbids mixing ?? with || without explicit parentheses.
  const bodyIp = (b.serverIp ? String(b.serverIp).trim() : "").trim();
  const cfgIp = (cfg?.serverIp ? String(cfg.serverIp).trim() : "").trim();
  const envIp = String(process.env.HOST_IP || "").trim();
  let serverIp = bodyIp || cfgIp || envIp || "";
  if (!serverIp && process.env.PUBLIC_APP_URL) {
    try {
      const u = new URL(process.env.PUBLIC_APP_URL);
      serverIp = u.hostname;
    } catch {}
  }

  if (!isIPv4(serverIp)) {
    return wantsJson
      ? NextResponse.json({ error: "MAILSTACK_IP_INVALID" }, { status: 400 })
      : NextResponse.redirect(absoluteUrl(req, `/app/domains/${d.id}?err=mailstack_ip`));
  }

  // STRICT gating (server-side): only provision when DNS is ready for inbound + sending auth.
  // This prevents users from bypassing the UI button disable by POSTing manually.
  const domain = String(d.name || "").trim().toLowerCase().replace(/\.$/, "");
  const selectorRaw = String(d.dkimSelector || "").trim();
  // Mailstack/Exim uses selector "default" (default._domainkey.<domain>). Some older UI used "cm".
  // For strict DNS gating, we require the *default* selector to exist.
  const selectorPreferred = selectorRaw && selectorRaw.toLowerCase() !== "cm" ? selectorRaw : "default";
  const selectorCandidates = Array.from(
    new Set([selectorPreferred, selectorRaw, "default"].filter(Boolean).map((x) => String(x).trim()))
  );

  const mailHost = `mail.${domain}`;
  const dmarcName = `_dmarc.${domain}`;

  const [mx, mailA, txtRoot, ...rest] = await Promise.all([
    resolveMxSafe(domain),
    resolveASafe(mailHost),
    resolveTxtFlat(domain),
    ...selectorCandidates.map((sel) => resolveTxtFlat(`${sel}._domainkey.${domain}`)),
    resolveTxtFlat(dmarcName),
  ]);

  const txtDmarc = rest.pop() as string[];
  const txtDkimAll = rest.flat();

  const mxOk = mx.length > 0;
  const mxHasMail = mx.some((m) => String(m.exchange || "").trim().toLowerCase().replace(/\.$/, "") === mailHost);
  const mailAOk = mailA.length > 0;
  const mailIpMatch = mailAOk ? mailA.includes(serverIp) : false;

  const spf = txtRoot.find((x) => String(x).toLowerCase().startsWith("v=spf1")) || "";
  const spfOk = !!spf;

  const txtDkimDefault = await resolveTxtFlat(`default._domainkey.${domain}`);
  const dkimRec =
    txtDkimDefault.find((x) => String(x).toLowerCase().includes("v=dkim1")) || (txtDkimDefault[0] || "");
  const dkimOk = !!(
    dkimRec &&
    String(dkimRec).toLowerCase().includes("v=dkim1") &&
    /(?:^|;)\s*p\s*=\s*[^;\s]+/i.test(String(dkimRec))
  );

  const dmarcRec = txtDmarc.find((x) => String(x).toLowerCase().startsWith("v=dmarc1")) || (txtDmarc[0] || "");
  const dmarcOk = !!(dmarcRec && String(dmarcRec).toLowerCase().startsWith("v=dmarc1") && /(?:^|;)\s*p\s*=\s*[^;\s]+/i.test(String(dmarcRec)));

  const dnsReady = Boolean(mxOk && mxHasMail && mailAOk && mailIpMatch && spfOk && dkimOk && dmarcOk);
  if (!dnsReady) {
    return wantsJson
      ? NextResponse.json({ error: "DNS_NOT_READY" }, { status: 409 })
      : NextResponse.redirect(absoluteUrl(req, `/app/domains/${d.id}?err=dns_not_ready`));
  }

  // Normalize stored selector for future UI/verification.
  if (!d.dkimSelector || String(d.dkimSelector).trim().toLowerCase() === "cm") {
    await prisma.domain.update({ where: { id: d.id }, data: { dkimSelector: "default" } });
  }

  // Create (or reuse) the tenant
  let tenant = await prisma.mailstackTenant.findFirst({
    where: { workspaceId: s.wid, name: tenantName },
    include: { ips: true },
  });

  // Outbound IP pool
  const ips: string[] = [];
  for (const line of String(b.ipsRaw || "").split(/\r?\n/)) {
    const v = line.trim();
    if (!v) continue;
    if (isIPv4(v)) ips.push(v);
  }
  const uniqIps = Array.from(new Set(ips)).slice(0, 200);

  const heloTemplate = String(b.heloTemplate || cfg?.heloTemplate || "mail.%d").trim() || "mail.%d";
  const dmarcPolicy = String(b.dmarcPolicy || cfg?.dmarcPolicy || "none").trim() || "none";
  const dmarcRuaTemplate = String(b.dmarcRuaTemplate || cfg?.dmarcRuaTemplate || "dmarc@%d").trim() || "dmarc@%d";
  const createZones = typeof b.createZones === "boolean" ? !!b.createZones : false;

  if (!tenant) {
    tenant = await prisma.mailstackTenant.create({
      data: {
        workspaceId: s.wid,
        name: tenantName,
        serverIp,
        heloTemplate,
        dmarcPolicy,
        dmarcRuaTemplate,
        createZones,
      },
      include: { ips: true },
    });
  } else if (tenant.serverIp !== serverIp) {
    await prisma.mailstackTenant.update({
      where: { id: tenant.id },
      data: { serverIp, heloTemplate, dmarcPolicy, dmarcRuaTemplate, createZones },
    });
  } else {
    // keep tenant settings in sync
    await prisma.mailstackTenant.update({
      where: { id: tenant.id },
      data: { heloTemplate, dmarcPolicy, dmarcRuaTemplate, createZones },
    });
  }

  // Replace tenant outbound IPs if user provided any, otherwise ensure at least serverIp.
  if (uniqIps.length) {
    await prisma.$executeRaw`DELETE FROM \`MailstackTenantIp\` WHERE \`tenantId\` = ${tenant.id}`;
    for (const ip of uniqIps) await ensureTenantIp(tenant.id, ip);
  } else if (!tenant.ips?.length) {
    await ensureTenantIp(tenant.id, serverIp);
  }

  // Link the domain (raw SQL so we don't depend on Prisma delegate naming)
  await linkTenantDomain(tenant.id, d.name);

  // Add users (prefixes / emails) (raw SQL so we don't depend on Prisma delegate naming)
  await addTenantUsers(tenant.id, users);

  // Queue provisioning job (robust even if Prisma Client is stale)
  const job = await enqueueJob("mailstack:tenant-setup", { tenantId: tenant.id, senderName });

  if (wantsJson) return NextResponse.json({ ok: true, tenantId: tenant.id, jobId: (job as any)?.id || null });
  return NextResponse.redirect(absoluteUrl(req, `/app/domains/${d.id}?provisioned=1`));
}
