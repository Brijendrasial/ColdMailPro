import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import * as dns from "node:dns/promises";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isIPv4(v: string) {
  return /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(v);
}

function normalizeHost(h: string) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
}

function clip(s: string, n: number) {
  const v = String(s || "");
  return v.length > n ? v.slice(0, n - 1) + "…" : v;
}

async function readBody(req: NextRequest): Promise<{ domainId?: string; serverIp?: string }> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as any;
    const domainId = j?.domainId ? String(j.domainId) : undefined;
    const serverIp = j?.serverIp ? String(j.serverIp) : undefined;
    return { domainId, serverIp };
  }
  const f = await req.formData().catch(() => null);
  if (!f) return {};
  const domainId = f.get("domainId") ? String(f.get("domainId")) : undefined;
  const serverIp = f.get("serverIp") ? String(f.get("serverIp")) : undefined;
  return { domainId, serverIp };
}

function parseTagValue(record: string, tag: string): string {
  const r = String(record || "");
  const m = r.match(new RegExp(`(?:^|;)\\s*${tag}\\s*=\\s*([^;\\s]+)`, "i"));
  return m?.[1] ? String(m[1]).trim() : "";
}

function spfLookupEstimate(spf: string): number {
  // Rough estimate (good enough for UI guidance)
  const s = String(spf || "").toLowerCase();
  let n = 0;
  const count = (re: RegExp) => ((s.match(re) || []).length);
  n += count(/\binclude:/g);
  n += count(/\bexists:/g);
  n += count(/\bredirect=/g);
  // a/mx/ptr are mechanisms that trigger DNS lookups when evaluated
  n += count(/\bmx\b/g);
  n += count(/\ba\b/g);
  n += count(/\bptr\b/g);
  return n;
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
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
    return rows.map((r) => ({ exchange: normalizeHost(r.exchange), priority: Number(r.priority || 0) }));
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

async function resolveCnameSafe(name: string): Promise<string[]> {
  try {
    const rows = await withTimeout(dns.resolveCname(name), 3500, [] as string[]);
    return rows.map(normalizeHost);
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const body = await readBody(req);
  const domainId = String(body.domainId || "");
  if (!domainId) return NextResponse.json({ error: "MISSING_DOMAIN" }, { status: 400 });

  const d = await prisma.domain.findFirst({ where: { id: domainId, workspaceId: s.wid } });
  if (!d) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // Expected values
  const domain = normalizeHost(d.name);
  const selectorRaw = String(d.dkimSelector || "").trim();
  // Mailstack uses selector "default" (default._domainkey.<domain>). Some older UI stored "cm".
  // For verification, accept either selector if a DKIM TXT exists.
  const selectorPreferred = selectorRaw && selectorRaw.toLowerCase() !== "cm" ? selectorRaw : "default";
  const selectorCandidates = Array.from(
    new Set([selectorPreferred, selectorRaw, "default"].filter(Boolean).map((x) => String(x).trim()))
  );
  const expectedDkimP = String(d.dkimPublic || "").replaceAll(/\s+/g, "").trim();

  // Try to find Mailstack server IP (preferred), then fall back to HOST_IP.
  const p: any = prisma as any;
  const hasMailstackModels = !!p.mailstackTenantDomain && !!p.mailstackConfig;

  const tenantDomain = hasMailstackModels
    ? await p.mailstackTenantDomain.findFirst({
        where: { domainName: domain, tenant: { workspaceId: s.wid } },
        include: { tenant: true },
      })
    : null;

  const cfg = hasMailstackModels ? await p.mailstackConfig.findUnique({ where: { workspaceId: s.wid } }) : null;

  let expectedServerIp = String(body?.serverIp || tenantDomain?.tenant?.serverIp || cfg?.serverIp || process.env.HOST_IP || "").trim();
  if (!isIPv4(expectedServerIp)) expectedServerIp = "";

  const mailHost = `mail.${domain}`;
  // Mailstack/Exim uses selector "default" => default._domainkey.<domain>
  const dkimName = `default._domainkey.${domain}`;
  // We'll still look up any alternate selector (e.g. legacy "cm") so we can show a helpful message,
  // but DKIM is considered OK only when the *default* record exists.
  const dkimAltNames = selectorCandidates
    .filter((sel) => String(sel).toLowerCase() !== "default")
    .map((sel) => `${sel}._domainkey.${domain}`);
  const dmarcName = `_dmarc.${domain}`;
  const tracking = d.trackingSubdomain ? normalizeHost(d.trackingSubdomain) : "";

  // DNS lookups
  const lookups = await Promise.all([
    resolveTxtFlat(domain),
    resolveTxtFlat(dkimName),
    ...dkimAltNames.map((n) => resolveTxtFlat(n)),
    resolveTxtFlat(dmarcName),
    resolveMxSafe(domain),
    resolveASafe(mailHost),
    tracking ? resolveCnameSafe(tracking) : Promise.resolve([] as string[]),
  ]);

  let idx = 0;
  const txtRoot = lookups[idx++] as string[];
  const txtDkimDefault = lookups[idx++] as string[];
  const txtDkimAltLists = lookups.slice(idx, idx + dkimAltNames.length) as string[][];
  idx += dkimAltNames.length;
  const txtDmarc = lookups[idx++] as string[];
  const mx = lookups[idx++] as any[];
  const mailA = lookups[idx++] as string[];
  const trackingCname = lookups[idx++] as string[];

  // SPF
  const spf = txtRoot.find((x) => x.toLowerCase().startsWith("v=spf1")) || null;
  const spfLookups = spf ? spfLookupEstimate(spf) : 0;
  const spfAll = spf ? (spf.match(/\s([\-~?]all)\b/i)?.[1] || "") : "";
  const spfOk = !!spf;

  // DKIM (STRICT: default selector only)
  const dkimRecDefault =
    txtDkimDefault.find((x) => x.toLowerCase().includes("v=dkim1")) || (txtDkimDefault[0] || null);
  const dkimP = dkimRecDefault ? (parseTagValue(dkimRecDefault, "p") || "") : "";
  const dkimOk = !!(dkimRecDefault && dkimRecDefault.toLowerCase().includes("v=dkim1") && dkimP);
  const dkimMatch = dkimOk && expectedDkimP ? dkimP.replaceAll(/\s+/g, "") === expectedDkimP : dkimOk;

  // Helpful hint: do we see DKIM at a non-default selector?
  const txtDkimAlt = txtDkimAltLists.flat();
  const dkimRecAlt = txtDkimAlt.find((x) => x.toLowerCase().includes("v=dkim1")) || (txtDkimAlt[0] || null);

  // DMARC
  const dmarcRec = txtDmarc.find((x) => x.toLowerCase().startsWith("v=dmarc1")) || (txtDmarc[0] || null);
  const dmarcPolicy = dmarcRec ? (parseTagValue(dmarcRec, "p") || "") : "";
  const dmarcOk = !!(dmarcRec && dmarcRec.toLowerCase().startsWith("v=dmarc1") && dmarcPolicy);

  // MX
  const mxOk = mx.length > 0;
  const mxHasMail = mx.some((m) => normalizeHost(m.exchange) === mailHost);

  // A for mail host
  const mailAOk = mailA.length > 0;
  const mailIpMatch = expectedServerIp ? mailA.includes(expectedServerIp) : null;

  // Tracking
  const appHost = (() => {
    try {
      return normalizeHost(new URL(process.env.PUBLIC_APP_URL || "").host);
    } catch {
      return "";
    }
  })();
  const trackingOk = tracking ? trackingCname.some((c) => normalizeHost(c) === appHost) : null;

  // Required checks for mailbox provisioning (STRICT):
  // - Inbound must work (MX -> mail host)
  // - Mail host must resolve (A -> server IP when known)
  // - Sending auth must be in place (SPF + DKIM + DMARC)
  //
  // Note: we intentionally keep SPF validation lightweight here because SPF can be
  // configured via includes/redirects or multiple IPs. Presence is required;
  // detailed SPF correctness is still surfaced via `issues`.
  const requiredOk = Boolean(
    mxOk &&
      mxHasMail &&
      (expectedServerIp ? mailAOk && mailIpMatch !== false : mailAOk) &&
      spfOk &&
      dkimOk &&
      dkimMatch &&
      dmarcOk
  );

  const issues: string[] = [];
  if (!mxOk) issues.push("Missing MX records (inbound mail will not work)");
  if (mxOk && !mxHasMail) issues.push(`MX does not point to ${mailHost} (required)`);

  if (!mailAOk) issues.push(`Missing A record for ${mailHost} (required)`);
  if (expectedServerIp && mailAOk && mailIpMatch === false) issues.push(`A record for ${mailHost} does not match server IP (${expectedServerIp})`);

  // Sending reputation guidance
  if (!spfOk) issues.push("Missing SPF (v=spf1) TXT record at root");
  if (spfOk && spfLookups > 10) issues.push(`SPF has too many DNS lookups (estimated ${spfLookups}/10)`);
  if (spfOk && spfAll && spfAll.toLowerCase() !== "-all") issues.push(`SPF ends with ${spfAll} (recommended: -all for strict senders)`);

  if (!dkimOk) issues.push(`Missing DKIM TXT at ${dkimName}`);
  if (!dkimOk && dkimRecAlt)
    issues.push(
      `DKIM TXT was found at a non-default selector (${dkimAltNames[0] || "alt"}), but Mailstack expects ${dkimName} (selector \"default\")`
    );
  if (dkimOk && !dkimMatch) issues.push("DKIM public key does not match the key generated in app (wrong selector or old record)");

  if (!dmarcOk) issues.push(`Missing DMARC TXT at ${dmarcName}`);
  if (dmarcOk && String(dmarcPolicy).toLowerCase() === "none") issues.push("DMARC policy is p=none (ok for testing, but weaker trust)");

  if (tracking && trackingOk === false) issues.push(`Tracking CNAME should point to ${appHost}`);
  if (tracking && trackingCname.length === 0) issues.push("Tracking CNAME record missing");

  // Score & status
  let score = 0;
  if (requiredOk) score += 35;
  if (spfOk) score += 20;
  if (dkimOk && dkimMatch) score += 25;
  if (dmarcOk) score += 15;
  if (!tracking || trackingOk) score += 5;
  score = Math.max(0, Math.min(100, score));

  let status: "unknown" | "healthy" | "warning" | "fail" = "healthy";
  if (!requiredOk) status = "fail";
  else if (!spfOk || !dkimOk || !dkimMatch) status = "warning";
  else if (issues.length) status = "warning";

  const checkedAt = new Date();

  const result: any = {
    kind: "domain_dns_check",
    domainId,
    domain,
    checkedAt: checkedAt.toISOString(),
    summary: {
      status,
      score,
      requiredOk,
      issues,
    },
    records: {
      mx: {
        ok: mxOk && mxHasMail,
        records: mx,
        expected: mailHost,
        detail: mxOk ? (mxHasMail ? `ok (points to ${mailHost})` : `not pointing to ${mailHost}`) : "missing",
      },
      mailA: {
        ok: expectedServerIp ? mailAOk && mailIpMatch !== false : mailAOk,
        name: mailHost,
        ips: mailA,
        expectedIp: expectedServerIp || null,
        detail: !mailAOk ? "missing" : expectedServerIp ? (mailIpMatch ? "ok" : "mismatch") : "found",
      },
      spf: {
        ok: spfOk,
        value: spf,
        lookups: spfLookups,
        all: spfAll,
        detail: spfOk ? `found (${spfAll || "no all"}, lookups~${spfLookups})` : "missing",
      },
      dkim: {
        ok: dkimOk && dkimMatch,
        selector: "default",
        name: dkimName,
        value: dkimRecDefault,
        altName: dkimAltNames[0] || null,
        altValue: dkimRecAlt,
        matchesAppKey: dkimMatch,
        detail: dkimOk
          ? dkimMatch
            ? "found (matches app key)"
            : "found (mismatch)"
          : dkimRecAlt
            ? "missing at default (found at non-default selector)"
            : "missing",
      },
      dmarc: {
        ok: dmarcOk,
        name: dmarcName,
        policy: dmarcPolicy,
        value: dmarcRec,
        detail: dmarcOk ? `found (p=${dmarcPolicy})` : "missing",
      },
      tracking: tracking
        ? {
            ok: trackingOk === true,
            name: tracking,
            cnames: trackingCname,
            expectedHost: appHost,
          }
        : null,
    },
    note: "Instant verify (manual DNS)\n" + clip(issues.join(" | "), 800),
  };

  // Store in Job history so the Domain page can render the latest status.
  await prisma.job
    .create({
      data: {
        type: "domain_dns_check",
        payload: JSON.stringify({ workspaceId: s.wid, domainId, source: "instant-verify" }),
        runAt: checkedAt,
        status: "done",
        lastError: JSON.stringify(result),
      },
      select: { id: true },
    })
    .catch(() => {});

  return NextResponse.json(result);
}
