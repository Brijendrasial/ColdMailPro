import * as dns from "node:dns/promises";
import { Resolver } from "node:dns/promises";

export type BlacklistAssetType = "ip" | "domain";

export type BlacklistAsset = {
  type: BlacklistAssetType;
  value: string;
  label: string;
  sources: string[];
  sourceIds?: string[];
};

export type BlacklistProvider = {
  id: string;
  name: string;
  zone: string;
  type: BlacklistAssetType;
  notes?: string;
};

export const IP_BLACKLIST_PROVIDERS: BlacklistProvider[] = [
  { id: "spamhaus_zen", name: "Spamhaus ZEN", zone: "zen.spamhaus.org", type: "ip" },
  { id: "spamcop", name: "SpamCop", zone: "bl.spamcop.net", type: "ip" },
  { id: "barracuda", name: "Barracuda", zone: "b.barracudacentral.org", type: "ip" },
  { id: "sorbs", name: "SORBS", zone: "dnsbl.sorbs.net", type: "ip" },
  { id: "psbl", name: "PSBL", zone: "psbl.surriel.com", type: "ip" },
  { id: "spamrats", name: "SpamRATS", zone: "all.spamrats.com", type: "ip" },
  { id: "uceprotect_l1", name: "UCEPROTECT Level 1", zone: "dnsbl-1.uceprotect.net", type: "ip" },
  { id: "cbl", name: "Composite Blocking List", zone: "cbl.abuseat.org", type: "ip" },
];

export const DOMAIN_BLACKLIST_PROVIDERS: BlacklistProvider[] = [
  { id: "spamhaus_dbl", name: "Spamhaus DBL", zone: "dbl.spamhaus.org", type: "domain" },
  { id: "surbl_multi", name: "SURBL Multi", zone: "multi.surbl.org", type: "domain" },
  { id: "uribl_black", name: "URIBL Black", zone: "black.uribl.com", type: "domain" },
  { id: "uribl_grey", name: "URIBL Grey", zone: "grey.uribl.com", type: "domain" },
  { id: "hostkarma", name: "Hostkarma DBL", zone: "hostkarma.junkemailfilter.com", type: "domain" },
  { id: "sem_uri", name: "SpamEatingMonkey URI", zone: "uribl.spameatingmonkey.net", type: "domain" },
];

export const BLACKLIST_PROVIDERS = [...IP_BLACKLIST_PROVIDERS, ...DOMAIN_BLACKLIST_PROVIDERS];

export const BLOCKED_OR_POLICY_RESPONSE_CODES = new Set([
  "127.0.0.1",
  "127.255.255.1",
  "127.255.255.2",
  "127.255.255.3",
  "127.255.255.4",
  "127.255.255.5",
  "127.255.255.254",
  "127.255.255.255",
]);

const HIGH_CONFIDENCE_RESPONSE_CODES: Record<string, Set<string>> = {
  spamhaus_zen: new Set(["127.0.0.2", "127.0.0.3", "127.0.0.4", "127.0.0.5", "127.0.0.6", "127.0.0.7", "127.0.0.9", "127.0.0.10", "127.0.0.11"]),
  spamhaus_dbl: new Set(["127.0.1.2", "127.0.1.3", "127.0.1.4", "127.0.1.5", "127.0.1.6", "127.0.1.102", "127.0.1.103", "127.0.1.104", "127.0.1.105", "127.0.1.106"]),
  spamcop: new Set(["127.0.0.2"]),
  barracuda: new Set(["127.0.0.2"]),
  psbl: new Set(["127.0.0.2"]),
  spamrats: new Set(["127.0.0.36", "127.0.0.37", "127.0.0.38"]),
  cbl: new Set(["127.0.0.2"]),
  uribl_black: new Set(["127.0.0.2"]),
  uribl_grey: new Set(["127.0.0.4"]),
  surbl_multi: new Set(["127.0.0.2", "127.0.0.4", "127.0.0.8", "127.0.0.16", "127.0.0.32", "127.0.0.64"]),
};

function isPolicyOrBlockedCode(code: string) {
  return BLOCKED_OR_POLICY_RESPONSE_CODES.has(code) || code.startsWith("127.255.255.");
}

const ADVISORY_ONLY_PROVIDER_IDS = new Set([
  // cbl.abuseat.org can produce resolver/provider false positives on shared datacenter DNS.
  // Spamhaus ZEN is the modern high-confidence path for CBL-style listings, so CBL is shown as advisory.
  "cbl",
  // Grey/listing-style URI providers are useful as signals, but should not block sending by themselves.
  "uribl_grey",
]);

function isAdvisoryOnlyProvider(provider: BlacklistProvider) {
  return ADVISORY_ONLY_PROVIDER_IDS.has(provider.id);
}

function expectedListingCodes(provider: BlacklistProvider) {
  return HIGH_CONFIDENCE_RESPONSE_CODES[provider.id] || null;
}

function explainPolicyBlockedCode(provider: BlacklistProvider, code: string) {
  if (isSpamhausProvider(provider) && code.startsWith("127.255.255.")) return explainSpamhausSpecialCode(code);
  if (code === "127.0.0.1") return `${providerLabel(provider)} returned ${code}, which commonly means the DNSBL rejected/blocked the lookup from this resolver or returned a policy/test response. Not counted as a blacklist hit.`;
  if (code.startsWith("127.255.255.")) return `${providerLabel(provider)} returned ${code}, a provider policy/query-block response. Not counted as a blacklist hit.`;
  return `${providerLabel(provider)} returned ${code}, but this code is not a confirmed listing code for this provider. Not counted as a blacklist hit.`;
}

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function normalizeIp(value: any): string | null {
  const s = String(value || "").trim();
  return IPV4_RE.test(s) ? s : null;
}

export function normalizeDomain(value: any): string | null {
  let s = String(value || "").trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0] || "";
  s = s.replace(/^@/, "").replace(/\.$/, "");
  if (!s || s.includes("@") || !DOMAIN_RE.test(s)) return null;
  return s;
}

export function domainFromEmail(value: any): string | null {
  const s = String(value || "").trim().toLowerCase();
  const parts = s.split("@");
  return parts.length === 2 ? normalizeDomain(parts[1]) : null;
}

export function parseIpList(value: any): string[] {
  return Array.from(new Set(String(value || "").split(/[\s,;]+/g).map(normalizeIp).filter(Boolean) as string[]));
}

function addAsset(map: Map<string, BlacklistAsset>, type: BlacklistAssetType, value: string | null, source: string, label?: string, sourceId?: string | null) {
  if (!value) return;
  const key = `${type}:${value}`;
  const existing = map.get(key);
  if (existing) {
    if (!existing.sources.includes(source)) existing.sources.push(source);
    if (sourceId && !existing.sourceIds?.includes(sourceId)) existing.sourceIds = [...(existing.sourceIds || []), sourceId];
    return;
  }
  map.set(key, {
    type,
    value,
    label: label || value,
    sources: [source],
    sourceIds: sourceId ? [sourceId] : [],
  });
}

export async function collectBlacklistAssets(prisma: any, workspaceId: string): Promise<BlacklistAsset[]> {
  const map = new Map<string, BlacklistAsset>();

  const [domains, mailboxes, cfg] = await Promise.all([
    prisma.domain.findMany({ where: { workspaceId }, select: { id: true, name: true } }).catch(() => []),
    prisma.mailbox.findMany({ where: { workspaceId }, select: { id: true, fromEmail: true, localAddress: true, smtpHost: true } }).catch(() => []),
    prisma.mailstackConfig.findUnique({ where: { workspaceId }, select: { serverIp: true, outboundIpsText: true } }).catch(() => null),
  ]);

  for (const d of domains as any[]) addAsset(map, "domain", normalizeDomain(d.name), "Domains", d.name, d.id);

  for (const mb of mailboxes as any[]) {
    addAsset(map, "domain", domainFromEmail(mb.fromEmail), "Mailbox sender domains", mb.fromEmail, mb.id);
    addAsset(map, "ip", normalizeIp(mb.localAddress), "Mailbox bound IPs", mb.localAddress, mb.id);
    addAsset(map, "ip", normalizeIp(mb.smtpHost), "Mailbox SMTP host IPs", mb.smtpHost, mb.id);
  }

  addAsset(map, "ip", normalizeIp(cfg?.serverIp), "MailStack server IP", cfg?.serverIp || undefined);
  for (const ip of parseIpList(cfg?.outboundIpsText)) addAsset(map, "ip", ip, "MailStack outbound IP pool", ip);

  const p: any = prisma;
  if (p.mailstackTenantDomain?.findMany) {
    const links = await p.mailstackTenantDomain.findMany({
      where: { tenant: { workspaceId } },
      select: { id: true, domainName: true },
    }).catch(() => []);
    for (const d of links as any[]) addAsset(map, "domain", normalizeDomain(d.domainName), "MailStack tenant domains", d.domainName, d.id);
  }

  if (p.mailstackTenantIp?.findMany) {
    const ips = await p.mailstackTenantIp.findMany({
      where: { tenant: { workspaceId } },
      select: { id: true, ip: true },
    }).catch(() => []);
    for (const row of ips as any[]) addAsset(map, "ip", normalizeIp(row.ip), "MailStack tenant IPs", row.ip, row.id);
  }

  return Array.from(map.values()).sort((a, b) => a.type.localeCompare(b.type) || a.value.localeCompare(b.value));
}

function reverseIp(ip: string) {
  return ip.split(".").reverse().join(".");
}

function isDnsNotListedError(err: any) {
  const code = String(err?.code || "").toUpperCase();
  return ["ENOTFOUND", "ENODATA", "ETIMEOUT"].includes(code);
}

export function parseBlacklistResolvers(value: any): string[] {
  return Array.from(new Set(String(value || "")
    .split(/[\s,;]+/g)
    .map((x) => x.trim())
    .filter(Boolean)));
}

function makeResolver(resolvers?: string[]) {
  const clean = parseBlacklistResolvers((resolvers || []).join(","));
  if (!clean.length) return dns;
  const resolver = new Resolver();
  resolver.setServers(clean);
  return resolver;
}

async function resolve4WithTimeout(query: string, timeoutMs: number, resolvers?: string[]): Promise<string[]> {
  let timer: NodeJS.Timeout | null = null;
  const resolver = makeResolver(resolvers);
  try {
    return await Promise.race([
      resolver.resolve4(query),
      new Promise<string[]>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("DNS lookup timed out"), { code: "ETIMEOUT" })), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function providerLabel(provider: BlacklistProvider) {
  return `${provider.name} (${provider.zone})`;
}

function isSpamhausProvider(provider: BlacklistProvider) {
  return /spamhaus/i.test(provider.name) || /spamhaus\.org$/i.test(provider.zone);
}

function explainSpamhausSpecialCode(code: string) {
  // Spamhaus 127.255.255.0/24 responses are query/access errors, not reputation listings.
  // Treating them as "listed" creates false positives when the server uses a public/open resolver.
  if (code === "127.255.255.254") return "Spamhaus query blocked: public/open resolver or generic reverse DNS. Not a blacklist hit.";
  if (code === "127.255.255.255") return "Spamhaus query blocked: excessive queries or resolver usage limit. Not a blacklist hit.";
  if (code.startsWith("127.255.255.")) return "Spamhaus query/access error response. Not a blacklist hit.";
  return null;
}

function interpretProviderResponse(provider: BlacklistProvider, query: string, responses: string[]) {
  const uniqueResponses = Array.from(new Set((responses || []).map(String))).sort();
  const expectedCodes = expectedListingCodes(provider);
  const advisoryOnly = isAdvisoryOnlyProvider(provider);
  const confirmedListingCodes = advisoryOnly ? [] : uniqueResponses.filter((code) => expectedCodes ? expectedCodes.has(code) : (!isPolicyOrBlockedCode(code) && code.startsWith("127.")));
  const warningCodes = uniqueResponses.filter((code) => !confirmedListingCodes.includes(code));

  if (confirmedListingCodes.length) {
    return {
      providerId: provider.id,
      provider: provider.name,
      zone: provider.zone,
      query,
      status: "listed" as const,
      responses: uniqueResponses,
      matchedCodes: confirmedListingCodes,
      warningCodes,
      detail: `Confirmed listing on ${providerLabel(provider)}. Matched code(s): ${confirmedListingCodes.join(", ")}${warningCodes.length ? `. Ignored warning/policy code(s): ${warningCodes.join(", ")}` : ""}`,
      countedAsListed: true,
    };
  }

  if (uniqueResponses.length) {
    return {
      providerId: provider.id,
      provider: provider.name,
      zone: provider.zone,
      query,
      status: "blocked" as const,
      responses: uniqueResponses,
      matchedCodes: [],
      warningCodes: uniqueResponses,
      detail: advisoryOnly
        ? `${providerLabel(provider)} returned ${uniqueResponses.join(", ")}, but this provider is treated as advisory-only in ColdMailPro to avoid false positives. It is not counted as a blacklist hit.`
        : uniqueResponses.map((code) => explainPolicyBlockedCode(provider, code)).join(" "),
      countedAsListed: false,
    };
  }

  return {
    providerId: provider.id,
    provider: provider.name,
    zone: provider.zone,
    query,
    status: "clear" as const,
    responses: uniqueResponses,
    matchedCodes: [],
    warningCodes: [],
    detail: `Clear on ${providerLabel(provider)}`,
    countedAsListed: false,
  };
}

export async function checkBlacklistAsset(asset: BlacklistAsset, opts?: { timeoutMs?: number; resolvers?: string[] }) {
  const timeoutMs = Number(opts?.timeoutMs || 4500);
  const resolvers = parseBlacklistResolvers((opts?.resolvers || []).join(","));
  const providers = asset.type === "ip" ? IP_BLACKLIST_PROVIDERS : DOMAIN_BLACKLIST_PROVIDERS;
  const checks = [] as Array<{
    providerId: string;
    provider: string;
    zone: string;
    query: string;
    status: "clear" | "listed" | "error" | "blocked";
    responses: string[];
    detail: string;
    countedAsListed?: boolean;
  }>;

  for (const provider of providers) {
    const query = asset.type === "ip" ? `${reverseIp(asset.value)}.${provider.zone}` : `${asset.value}.${provider.zone}`;
    try {
      const responses = await resolve4WithTimeout(query, timeoutMs, resolvers);
      checks.push(interpretProviderResponse(provider, query, responses));
    } catch (err: any) {
      if (isDnsNotListedError(err)) {
        checks.push({
          providerId: provider.id,
          provider: provider.name,
          zone: provider.zone,
          query,
          status: "clear",
          responses: [],
          detail: `Clear on ${providerLabel(provider)}; no DNSBL record returned.`,
          countedAsListed: false,
        });
      } else {
        checks.push({
          providerId: provider.id,
          provider: provider.name,
          zone: provider.zone,
          query,
          status: "error",
          responses: [],
          detail: `${providerLabel(provider)} lookup error: ${String(err?.message || err)}`,
          countedAsListed: false,
        });
      }
    }
  }

  const listed = checks.filter((c) => c.status === "listed" && c.countedAsListed !== false);
  const blocked = checks.filter((c) => c.status === "blocked");
  const errors = checks.filter((c) => c.status === "error");
  return {
    ...asset,
    checkedAt: new Date().toISOString(),
    status: listed.length ? "listed" : (blocked.length || errors.length) ? "warning" : "clear",
    listedCount: listed.length,
    warningCount: blocked.length + errors.length,
    blockedCount: blocked.length,
    errorCount: errors.length,
    providerCount: checks.length,
    checks,
  };
}

export async function runBlacklistCheck(assets: BlacklistAsset[], opts?: { timeoutMs?: number; concurrency?: number; resolvers?: string[]; onProgress?: (line: string) => Promise<void> | void }) {
  const timeoutMs = Number(opts?.timeoutMs || 4500);
  const concurrency = Math.max(1, Math.min(10, Number(opts?.concurrency || 5)));
  const resolvers = parseBlacklistResolvers((opts?.resolvers || []).join(","));
  const queue = [...assets];
  const results: any[] = [];

  if (resolvers.length) {
    await opts?.onProgress?.(`Using blacklist DNS resolver(s): ${resolvers.join(", ")}.`);
  } else {
    await opts?.onProgress?.("Using system DNS resolver configuration for blacklist checks.");
  }

  async function worker() {
    while (queue.length) {
      const asset = queue.shift();
      if (!asset) return;
      const providers = asset.type === "ip" ? IP_BLACKLIST_PROVIDERS : DOMAIN_BLACKLIST_PROVIDERS;
      await opts?.onProgress?.(`Checking ${asset.type.toUpperCase()} ${asset.value} against ${providers.length} providers: ${providers.map(providerLabel).join(", ")}.`);
      const result = await checkBlacklistAsset(asset, { timeoutMs, resolvers });
      results.push(result);

      const listed = (result.checks || []).filter((c: any) => c.status === "listed" && c.countedAsListed !== false);
      const blocked = (result.checks || []).filter((c: any) => c.status === "blocked");
      const errors = (result.checks || []).filter((c: any) => c.status === "error");
      if (listed.length) {
        await opts?.onProgress?.(`⚠ ${asset.value}: listed on ${listed.length} provider(s): ${listed.map((c: any) => `${c.provider} [${c.zone}] => ${Array.isArray(c.responses) && c.responses.length ? c.responses.join("/") : "match"}`).join("; ")}`);
      } else if (blocked.length || errors.length) {
        const parts = [
          ...blocked.map((c: any) => `${c.provider} [${c.zone}] returned ${Array.isArray(c.responses) && c.responses.length ? c.responses.join("/") : "blocked"} — not counted as listed`),
          ...errors.map((c: any) => `${c.provider} [${c.zone}] error`),
        ];
        await opts?.onProgress?.(`⚠ ${asset.value}: provider warning(s): ${parts.join("; ")}`);
      } else {
        await opts?.onProgress?.(`✅ ${asset.value}: clear across ${providers.length} provider(s).`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, () => worker()));
  results.sort((a, b) => String(a.type).localeCompare(String(b.type)) || String(a.value).localeCompare(String(b.value)));
  const listedAssets = results.filter((r) => r.status === "listed").length;
  const warningAssets = results.filter((r) => r.status === "warning").length;
  const totalListedProviders = results.reduce((sum, r) => sum + Number(r.listedCount || 0), 0);
  const totalProviderWarnings = results.reduce((sum, r) => sum + Number(r.warningCount || 0), 0);
  return {
    kind: "blacklist_check",
    checkedAt: new Date().toISOString(),
    summary: {
      status: listedAssets ? "listed" : warningAssets ? "warning" : "clear",
      totalAssets: results.length,
      listedAssets,
      warningAssets,
      clearAssets: results.filter((r) => r.status === "clear").length,
      totalListedProviders,
      totalProviderWarnings,
      ipAssets: results.filter((r) => r.type === "ip").length,
      domainAssets: results.filter((r) => r.type === "domain").length,
    },
    providers: {
      ip: IP_BLACKLIST_PROVIDERS,
      domain: DOMAIN_BLACKLIST_PROVIDERS,
    },
    results,
  };
}
