import * as dns from "node:dns/promises";
import { Resolver } from "node:dns/promises";
import net from "node:net";

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

type ReputationSeverity = "critical" | "high" | "medium" | "advisory" | "clear";

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

export const BLACKLIST_PROVIDER_GUIDE: Record<string, { severity: ReputationSeverity; impact: string; delistUrl?: string; helpUrl?: string; meaning: string }> = {
  spamhaus_zen: {
    severity: "critical",
    impact: "High impact. Many mailbox providers and filters use Spamhaus ZEN as a blocking signal for sending IPs.",
    delistUrl: "https://check.spamhaus.org/",
    helpUrl: "https://www.spamhaus.org/resource-hub/dnsbl/",
    meaning: "Checks whether the sending IP is associated with spam, botnets, malware, or poor sender reputation.",
  },
  spamhaus_dbl: {
    severity: "critical",
    impact: "High impact. Domain listings can affect links, sender domains, and campaign trust.",
    delistUrl: "https://check.spamhaus.org/",
    helpUrl: "https://www.spamhaus.org/resource-hub/dnsbl/",
    meaning: "Checks whether the domain appears in Spamhaus DBL domain reputation data.",
  },
  spamcop: {
    severity: "high",
    impact: "High impact for receiving systems that use spam complaint driven blocklists.",
    delistUrl: "https://www.spamcop.net/bl.shtml",
    meaning: "Complaint-driven IP blocklist based on recent spam reports.",
  },
  barracuda: {
    severity: "high",
    impact: "High impact for organizations using Barracuda filtering appliances.",
    delistUrl: "https://www.barracudacentral.org/rbl/removal-request",
    meaning: "IP reputation list used by Barracuda email security systems.",
  },
  sorbs: {
    severity: "medium",
    impact: "Medium impact. Can affect some business mail filters.",
    delistUrl: "https://www.sorbs.net/lookup.shtml",
    meaning: "IP reputation/blocklist provider with multiple list types.",
  },
  psbl: {
    severity: "medium",
    impact: "Medium impact. Useful as an additional sender reputation signal.",
    delistUrl: "https://psbl.org/remove",
    meaning: "Passive Spam Block List signal for IP-based abuse reports.",
  },
  spamrats: {
    severity: "medium",
    impact: "Medium impact. Usually points to dynamic, no-PTR, or suspicious mail server traits.",
    delistUrl: "https://www.spamrats.com/lookup.php",
    meaning: "IP reputation list focused on suspicious sending hosts and configuration patterns.",
  },
  uceprotect_l1: {
    severity: "medium",
    impact: "Medium impact. Treat with context because some broad listings can be noisy.",
    delistUrl: "https://www.uceprotect.net/en/rblcheck.php",
    meaning: "IP reputation list that can include direct and network-level abuse signals.",
  },
  cbl: {
    severity: "advisory",
    impact: "Advisory in ColdMailPro to avoid false positives from shared resolver behavior. Use Spamhaus ZEN for high-confidence CBL-style signals.",
    delistUrl: "https://www.abuseat.org/lookup.cgi",
    meaning: "Composite Blocking List style IP signal. Shown as advisory-only here.",
  },
  surbl_multi: {
    severity: "medium",
    impact: "Medium impact for URL/link reputation in outbound emails.",
    delistUrl: "https://www.surbl.org/surbl-analysis",
    meaning: "Checks domain/URI reputation used by content filters.",
  },
  uribl_black: {
    severity: "high",
    impact: "High impact if confirmed. Can affect campaigns containing this domain in links or sender identity.",
    delistUrl: "https://admin.uribl.com/",
    meaning: "URI/domain reputation list. Provider policy blocks are not counted as listings.",
  },
  uribl_grey: {
    severity: "advisory",
    impact: "Advisory only. Grey-list style signals should not pause sending by themselves.",
    delistUrl: "https://admin.uribl.com/",
    meaning: "Grey URI/domain reputation signal; shown as advisory in ColdMailPro.",
  },
  hostkarma: {
    severity: "medium",
    impact: "Medium impact. Use as supporting signal, not as the only decision point.",
    helpUrl: "https://www.junkemailfilter.com/",
    meaning: "Hostkarma domain reputation result.",
  },
  sem_uri: {
    severity: "medium",
    impact: "Medium impact for URI reputation checks.",
    helpUrl: "https://spameatingmonkey.com/",
    meaning: "SpamEatingMonkey URI/domain reputation signal.",
  },
};

function providerGuide(provider: BlacklistProvider) {
  return BLACKLIST_PROVIDER_GUIDE[provider.id] || {
    severity: "medium" as ReputationSeverity,
    impact: "Reputation signal used by some mail filters. Review with context.",
    meaning: "DNSBL/URIBL reputation check.",
  };
}

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
  return ["ENOTFOUND", "ENODATA"].includes(code);
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

async function resolve4WithTimeout(query: string, timeoutMs: number, resolvers?: string[]): Promise<{ responses: string[]; durationMs: number }> {
  let timer: NodeJS.Timeout | null = null;
  const resolver = makeResolver(resolvers);
  const startedAt = Date.now();
  try {
    const responses = await Promise.race([
      resolver.resolve4(query),
      new Promise<string[]>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("DNS lookup timed out"), { code: "ETIMEOUT" })), timeoutMs);
      }),
    ]);
    return { responses, durationMs: Date.now() - startedAt };
  } catch (err: any) {
    err.durationMs = Date.now() - startedAt;
    throw err;
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


async function resolveAnyWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<{ value: T; durationMs: number }> {
  let timer: NodeJS.Timeout | null = null;
  const startedAt = Date.now();
  try {
    const value = await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("DNS lookup timed out"), { code: "ETIMEOUT" })), timeoutMs);
      }),
    ]);
    return { value, durationMs: Date.now() - startedAt };
  } catch (err: any) {
    err.durationMs = Date.now() - startedAt;
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function resolverLabel(resolvers?: string[]) {
  const clean = parseBlacklistResolvers((resolvers || []).join(","));
  return clean.length ? clean.join(", ") : "system";
}

function makeDnsClient(resolvers?: string[]): any {
  return makeResolver(resolvers);
}

async function runResolverDiagnostics(opts?: { timeoutMs?: number; resolvers?: string[] }) {
  const timeoutMs = Number(opts?.timeoutMs || 4500);
  const resolvers = parseBlacklistResolvers((opts?.resolvers || []).join(","));
  const client = makeDnsClient(resolvers);
  const tests = [
    { id: "normal_dns", label: "Normal DNS recursion", query: "example.com", expected: "A record" },
    { id: "spamhaus_zen_test", label: "Spamhaus ZEN test query", query: "2.0.0.127.zen.spamhaus.org", expected: "127.0.0.2 test/listing response" },
  ];
  const results: any[] = [];
  for (const t of tests) {
    try {
      const out = await resolveAnyWithTimeout(() => client.resolve4(t.query), timeoutMs);
      const responses = Array.isArray(out.value) ? out.value.map(String) : [];
      const blocked = responses.some((x) => isPolicyOrBlockedCode(x));
      results.push({
        ...t,
        resolver: resolverLabel(resolvers),
        timeoutMs,
        durationMs: out.durationMs,
        status: blocked ? "warning" : "pass",
        rawOutput: responses.length ? responses.join(", ") : "NO A RECORD",
        detail: blocked ? "Resolver reached provider but provider returned a policy/query-block response." : "Resolver returned a normal response.",
      });
    } catch (err: any) {
      const code = String(err?.code || "ERROR");
      const status = isDnsNotListedError(err) ? "warning" : "error";
      results.push({
        ...t,
        resolver: resolverLabel(resolvers),
        timeoutMs,
        durationMs: Number(err?.durationMs || 0),
        status,
        rawOutput: code,
        detail: isDnsNotListedError(err) ? "Provider returned NXDOMAIN/no data for the diagnostic query. Normal DNS may still work, but provider diagnostics should be reviewed." : `Diagnostic lookup failed: ${String(err?.message || err)}`,
      });
    }
  }
  return {
    status: results.some((r) => r.status === "error") ? "error" : results.some((r) => r.status === "warning") ? "warning" : "pass",
    resolver: resolverLabel(resolvers),
    tests: results,
  };
}

function tcpProbe(host: string, port: number, timeoutMs: number): Promise<{ ok: boolean; banner?: string; error?: string; durationMs: number }> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = new net.Socket();
    let settled = false;
    let banner = "";
    const done = (out: { ok: boolean; banner?: string; error?: string }) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve({ ...out, durationMs: Date.now() - startedAt });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      // SMTP servers normally send a 220 banner first. Wait briefly, then close.
      setTimeout(() => done({ ok: true, banner: banner.trim() || "connected/no banner yet" }), Math.min(900, timeoutMs));
    });
    socket.on("data", (buf) => {
      banner += buf.toString("utf8").replace(/[\r\n]+/g, " ").slice(0, 300);
      if (banner.trim()) done({ ok: true, banner: banner.trim() });
    });
    socket.once("timeout", () => done({ ok: false, error: "timeout" }));
    socket.once("error", (err: any) => done({ ok: false, error: String(err?.code || err?.message || err) }));
    socket.connect(port, host);
  });
}

async function runAssetDiagnostics(asset: BlacklistAsset, opts?: { timeoutMs?: number; resolvers?: string[] }) {
  const timeoutMs = Number(opts?.timeoutMs || 4500);
  const resolvers = parseBlacklistResolvers((opts?.resolvers || []).join(","));
  const client = makeDnsClient(resolvers);
  const checks: any[] = [];

  if (asset.type === "domain") {
    for (const test of [
      { id: "domain_a", label: "Domain A record", run: () => client.resolve4(asset.value) },
      { id: "domain_mx", label: "MX records", run: () => client.resolveMx(asset.value) },
      { id: "domain_spf", label: "SPF TXT record", run: async () => (await client.resolveTxt(asset.value)).map((x: string[]) => x.join("")) },
      { id: "domain_dmarc", label: "DMARC TXT record", run: async () => (await client.resolveTxt(`_dmarc.${asset.value}`)).map((x: string[]) => x.join("")) },
    ]) {
      try {
        const out = await resolveAnyWithTimeout(test.run, timeoutMs);
        let value: any = out.value;
        if (test.id === "domain_spf") value = (value as string[]).filter((x) => /^v=spf1/i.test(x));
        if (test.id === "domain_dmarc") value = (value as string[]).filter((x) => /^v=DMARC1/i.test(x));
        const ok = Array.isArray(value) ? value.length > 0 : Boolean(value);
        checks.push({ id: test.id, label: test.label, status: ok ? "pass" : "warning", output: ok ? JSON.stringify(value).slice(0, 700) : "No matching record", durationMs: out.durationMs, resolver: resolverLabel(resolvers) });
      } catch (err: any) {
        checks.push({ id: test.id, label: test.label, status: isDnsNotListedError(err) ? "warning" : "error", output: String(err?.code || err?.message || err), durationMs: Number(err?.durationMs || 0), resolver: resolverLabel(resolvers) });
      }
    }
  } else {
    let ptrHosts: string[] = [];
    try {
      const ptr = await resolveAnyWithTimeout(() => client.reverse(asset.value), timeoutMs);
      ptrHosts = Array.isArray(ptr.value) ? ptr.value.map(String) : [];
      checks.push({ id: "ptr", label: "PTR / reverse DNS", status: ptrHosts.length ? "pass" : "warning", output: ptrHosts.join(", ") || "No PTR hostnames", durationMs: ptr.durationMs, resolver: resolverLabel(resolvers) });
    } catch (err: any) {
      checks.push({ id: "ptr", label: "PTR / reverse DNS", status: "warning", output: String(err?.code || err?.message || err), durationMs: Number(err?.durationMs || 0), resolver: resolverLabel(resolvers) });
    }

    let forwardOk = false;
    const forwardOutputs: string[] = [];
    for (const host of ptrHosts.slice(0, 3)) {
      try {
        const out = await resolveAnyWithTimeout(() => client.resolve4(host), timeoutMs);
        const ips = Array.isArray(out.value) ? out.value.map(String) : [];
        forwardOutputs.push(`${host} => ${ips.join(", ") || "NO A"}`);
        if (ips.includes(asset.value)) forwardOk = true;
      } catch (err: any) {
        forwardOutputs.push(`${host} => ${String(err?.code || err?.message || err)}`);
      }
    }
    checks.push({ id: "fcrdns", label: "Forward-confirmed rDNS", status: ptrHosts.length && forwardOk ? "pass" : "warning", output: forwardOutputs.join(" | ") || "No PTR hostname to forward-confirm", durationMs: 0, resolver: resolverLabel(resolvers) });

    const smtp = await tcpProbe(asset.value, 25, Math.min(Math.max(timeoutMs, 2500), 6000));
    checks.push({ id: "smtp25", label: "SMTP port 25 banner", status: smtp.ok ? "pass" : "warning", output: smtp.ok ? (smtp.banner || "connected") : (smtp.error || "connection failed"), durationMs: smtp.durationMs, resolver: "tcp" });
  }

  return {
    status: checks.some((c) => c.status === "error") ? "error" : checks.some((c) => c.status === "warning") ? "warning" : "pass",
    checks,
  };
}

function scoreAsset(result: any) {
  let score = 100;
  const checks = Array.isArray(result?.checks) ? result.checks : [];
  const diagnostics = Array.isArray(result?.diagnostics?.checks) ? result.diagnostics.checks : [];
  const criticalHits = checks.filter((c: any) => c.status === "listed" && c.countedAsListed !== false && providerGuide({ id: c.providerId, name: c.provider, zone: c.zone, type: result.type }).severity === "critical").length;
  const highHits = checks.filter((c: any) => c.status === "listed" && c.countedAsListed !== false && providerGuide({ id: c.providerId, name: c.provider, zone: c.zone, type: result.type }).severity === "high").length;
  const otherHits = checks.filter((c: any) => c.status === "listed" && c.countedAsListed !== false).length - criticalHits - highHits;
  const warnings = checks.filter((c: any) => c.status === "blocked" || c.status === "error").length;
  const diagWarnings = diagnostics.filter((c: any) => c.status === "warning" || c.status === "error").length;
  score -= criticalHits * 45;
  score -= highHits * 35;
  score -= otherHits * 25;
  score -= warnings * 4;
  score -= diagWarnings * 5;
  return Math.max(0, Math.min(100, score));
}

function severityFromScore(score: number, listedCount: number) {
  if (listedCount > 0 || score < 50) return "critical";
  if (score < 70) return "high";
  if (score < 85) return "medium";
  if (score < 95) return "advisory";
  return "clear";
}

function buildRecommendations(result: any) {
  const recs: string[] = [];
  const checks = Array.isArray(result?.checks) ? result.checks : [];
  const listed = checks.filter((c: any) => c.status === "listed" && c.countedAsListed !== false);
  if (listed.length) {
    recs.push("Pause campaigns and mailboxes using this asset until the listing is reviewed.");
    recs.push("Check recent bounces, complaints, sending spikes, and imported lead quality.");
    recs.push("Open the listed provider delisting/help link and follow its remediation process.");
  }
  if (checks.some((c: any) => c.status === "blocked" || c.status === "error")) recs.push("Review resolver/provider warnings. Use BLACKLIST_DNS_RESOLVERS=127.0.0.1 with a private Unbound resolver for the most reliable checks.");
  const diag = Array.isArray(result?.diagnostics?.checks) ? result.diagnostics.checks : [];
  if (diag.some((c: any) => c.id === "ptr" && c.status !== "pass")) recs.push("Add or repair PTR/rDNS for this sending IP.");
  if (diag.some((c: any) => c.id === "fcrdns" && c.status !== "pass")) recs.push("Make PTR hostname resolve back to the same sending IP for forward-confirmed rDNS.");
  if (diag.some((c: any) => c.id === "smtp25" && c.status !== "pass")) recs.push("Verify SMTP port 25 is reachable and the mail server banner is healthy.");
  if (diag.some((c: any) => c.id === "domain_spf" && c.status !== "pass")) recs.push("Publish a valid SPF record for this sender domain.");
  if (diag.some((c: any) => c.id === "domain_dmarc" && c.status !== "pass")) recs.push("Publish a DMARC record. Start with p=none for monitoring, then move to quarantine/reject when ready.");
  if (!recs.length) recs.push("No urgent remediation required. Keep monitoring and watch bounce/complaint trends.");
  return Array.from(new Set(recs));
}

function providerGuidanceForCheck(c: any) {
  const guide = providerGuide({ id: c.providerId, name: c.provider, zone: c.zone, type: "ip" as BlacklistAssetType });
  return {
    severity: guide.severity,
    impact: guide.impact,
    meaning: guide.meaning,
    delistUrl: guide.delistUrl || null,
    helpUrl: guide.helpUrl || null,
  };
}

function interpretProviderResponse(provider: BlacklistProvider, query: string, responses: string[], meta?: { resolverLabel?: string; timeoutMs?: number; durationMs?: number }) {
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
      resolver: meta?.resolverLabel || "system",
      timeoutMs: meta?.timeoutMs,
      durationMs: meta?.durationMs,
      rawOutput: uniqueResponses.join(", "),
      interpretation: "confirmed listing",
      guidance: providerGuidanceForCheck({ providerId: provider.id, provider: provider.name, zone: provider.zone }),
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
      resolver: meta?.resolverLabel || "system",
      timeoutMs: meta?.timeoutMs,
      durationMs: meta?.durationMs,
      rawOutput: uniqueResponses.join(", "),
      interpretation: advisoryOnly ? "advisory-only response" : "provider warning / query blocked",
      guidance: providerGuidanceForCheck({ providerId: provider.id, provider: provider.name, zone: provider.zone }),
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
    resolver: meta?.resolverLabel || "system",
    timeoutMs: meta?.timeoutMs,
    durationMs: meta?.durationMs,
    rawOutput: "NXDOMAIN / no A record",
    interpretation: "clear",
    guidance: providerGuidanceForCheck({ providerId: provider.id, provider: provider.name, zone: provider.zone }),
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
    matchedCodes?: string[];
    warningCodes?: string[];
    resolver?: string;
    timeoutMs?: number;
    durationMs?: number;
    rawOutput?: string;
    interpretation?: string;
    guidance?: any;
  }>;

  for (const provider of providers) {
    const query = asset.type === "ip" ? `${reverseIp(asset.value)}.${provider.zone}` : `${asset.value}.${provider.zone}`;
    try {
      const resolved = await resolve4WithTimeout(query, timeoutMs, resolvers);
      checks.push(interpretProviderResponse(provider, query, resolved.responses, { resolverLabel: resolvers.length ? resolvers.join(", ") : "system", timeoutMs, durationMs: resolved.durationMs }));
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
          resolver: resolvers.length ? resolvers.join(", ") : "system",
          timeoutMs,
          durationMs: Number(err?.durationMs || 0),
          rawOutput: String(err?.code || "NXDOMAIN"),
          interpretation: "clear",
          guidance: providerGuidanceForCheck({ providerId: provider.id, provider: provider.name, zone: provider.zone }),
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
          resolver: resolvers.length ? resolvers.join(", ") : "system",
          timeoutMs,
          durationMs: Number(err?.durationMs || 0),
          rawOutput: String(err?.code || err?.message || "lookup error"),
          interpretation: "lookup error",
          guidance: providerGuidanceForCheck({ providerId: provider.id, provider: provider.name, zone: provider.zone }),
        });
      }
    }
  }

  const diagnostics = await runAssetDiagnostics(asset, { timeoutMs, resolvers });
  const listed = checks.filter((c) => c.status === "listed" && c.countedAsListed !== false);
  const blocked = checks.filter((c) => c.status === "blocked");
  const errors = checks.filter((c) => c.status === "error");
  const baseResult: any = {
    ...asset,
    checkedAt: new Date().toISOString(),
    status: listed.length ? "listed" : (blocked.length || errors.length || diagnostics.status !== "pass") ? "warning" : "clear",
    listedCount: listed.length,
    warningCount: blocked.length + errors.length + (diagnostics.status !== "pass" ? 1 : 0),
    blockedCount: blocked.length,
    errorCount: errors.length,
    providerCount: checks.length,
    checks,
    diagnostics,
    impact: {
      sources: asset.sources || [],
      sourceIds: asset.sourceIds || [],
      relatedCount: (asset.sourceIds || []).length || (asset.sources || []).length,
      note: "ColdMailPro maps this asset to its configured Domains, Mailboxes, MailStack tenants, outbound IP pool, and bound sender IPs when available.",
    },
  };
  const score = scoreAsset(baseResult);
  baseResult.reputationScore = score;
  baseResult.severity = severityFromScore(score, listed.length);
  baseResult.recommendations = buildRecommendations(baseResult);
  baseResult.delistingLinks = checks
    .filter((c: any) => c.status === "listed" && c.countedAsListed !== false && c.guidance?.delistUrl)
    .map((c: any) => ({ provider: c.provider, zone: c.zone, url: c.guidance.delistUrl, severity: c.guidance.severity }));
  baseResult.aiDiagnosis = listed.length
    ? `Confirmed listing detected on ${listed.length} high-confidence provider(s). Pause affected sending paths, investigate recent complaints/bounces, then request delisting after remediation.`
    : (blocked.length || errors.length || diagnostics.status !== "pass")
      ? "No confirmed blacklist hit was found, but provider/resolver or infrastructure warnings need review before relying on the result."
      : "Clean result across enabled providers and supporting infrastructure checks. Continue normal monitoring.";
  return baseResult;
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

  const resolverDiagnostics = await runResolverDiagnostics({ timeoutMs, resolvers });
  await opts?.onProgress?.(`Resolver diagnostics: ${resolverDiagnostics.status} via ${resolverDiagnostics.resolver}.`);
  for (const t of resolverDiagnostics.tests || []) {
    await opts?.onProgress?.(`↳ resolver-test :: ${t.label}`);
    await opts?.onProgress?.(`   query=${t.query}`);
    await opts?.onProgress?.(`   resolver=${t.resolver} timeout=${t.timeoutMs}ms duration=${t.durationMs}ms`);
    await opts?.onProgress?.(`   output=${t.rawOutput}`);
    await opts?.onProgress?.(`   interpreted=${t.status} detail=${t.detail}`);
  }

  async function worker() {
    while (queue.length) {
      const asset = queue.shift();
      if (!asset) return;
      const providers = asset.type === "ip" ? IP_BLACKLIST_PROVIDERS : DOMAIN_BLACKLIST_PROVIDERS;
      await opts?.onProgress?.(`Checking ${asset.type.toUpperCase()} ${asset.value} against ${providers.length} providers: ${providers.map(providerLabel).join(", ")}.`);
      const result = await checkBlacklistAsset(asset, { timeoutMs, resolvers });
      results.push(result);

      for (const check of (result.checks || []) as any[]) {
        const response = Array.isArray(check.responses) && check.responses.length ? check.responses.join(", ") : (check.rawOutput || "NXDOMAIN / no listing");
        const counted = check.status === "listed" && check.countedAsListed !== false ? "yes" : "no";
        await opts?.onProgress?.(`↳ ${asset.value} :: ${check.provider} (${check.zone})`);
        await opts?.onProgress?.(`   query=${check.query}`);
        await opts?.onProgress?.(`   resolver=${check.resolver || (resolvers.length ? resolvers.join(", ") : "system")} timeout=${check.timeoutMs || timeoutMs}ms duration=${Number(check.durationMs || 0)}ms`);
        await opts?.onProgress?.(`   output=${response}`);
        await opts?.onProgress?.(`   interpreted=${check.interpretation || check.status} counted_as_blacklist_hit=${counted}`);
        await opts?.onProgress?.(`   detail=${check.detail}`);
      }

      const listed = (result.checks || []).filter((c: any) => c.status === "listed" && c.countedAsListed !== false);
      const blocked = (result.checks || []).filter((c: any) => c.status === "blocked");
      const errors = (result.checks || []).filter((c: any) => c.status === "error");
      for (const diag of (result.diagnostics?.checks || []) as any[]) {
        await opts?.onProgress?.(`↳ ${asset.value} :: infrastructure ${diag.label}`);
        await opts?.onProgress?.(`   resolver=${diag.resolver || "system"} duration=${Number(diag.durationMs || 0)}ms`);
        await opts?.onProgress?.(`   output=${diag.output}`);
        await opts?.onProgress?.(`   interpreted=${diag.status}`);
      }
      await opts?.onProgress?.(`Reputation score for ${asset.value}: ${result.reputationScore}/100 (${result.severity}).`);
      await opts?.onProgress?.(`AI diagnosis for ${asset.value}: ${result.aiDiagnosis}`);
      for (const rec of (result.recommendations || []).slice(0, 4)) await opts?.onProgress?.(`Recommended action for ${asset.value}: ${rec}`);

      if (listed.length) {
        await opts?.onProgress?.(`⚠ ${asset.value}: listed on ${listed.length} provider(s): ${listed.map((c: any) => `${c.provider} [${c.zone}] => ${Array.isArray(c.responses) && c.responses.length ? c.responses.join("/") : "match"}`).join("; ")}`);
      } else if (blocked.length || errors.length || result.diagnostics?.status !== "pass") {
        const parts = [
          ...blocked.map((c: any) => `${c.provider} [${c.zone}] returned ${Array.isArray(c.responses) && c.responses.length ? c.responses.join("/") : "blocked"} — not counted as listed`),
          ...errors.map((c: any) => `${c.provider} [${c.zone}] error`),
        ];
        await opts?.onProgress?.(`⚠ ${asset.value}: warning(s): ${parts.length ? parts.join("; ") : "infrastructure diagnostics need review"}`);
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
    diagnostics: {
      resolver: resolverDiagnostics,
      fleetScore: results.length ? Math.round(results.reduce((sum, r) => sum + Number(r.reputationScore || 0), 0) / results.length) : 100,
      criticalAssets: results.filter((r) => r.severity === "critical").length,
      highRiskAssets: results.filter((r) => r.severity === "high").length,
    },
    results,
  };
}
