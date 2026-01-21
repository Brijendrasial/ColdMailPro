import { promises as dns } from "dns";

export type EmailRiskFlags = {
  noMx?: boolean;
  catchAll?: boolean;
  freeProvider?: boolean;
  roleBased?: boolean;
  disposable?: boolean;
  suppressed?: boolean;
  notVerified?: boolean;
};

const FREE_PROVIDERS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "yahoo.in",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

const ROLE_BASED_LOCAL_PREFIXES = [
  "info",
  "sales",
  "support",
  "help",
  "hello",
  "contact",
  "admin",
  "team",
  "hr",
  "careers",
  "billing",
  "accounts",
  "office",
  "inquiries",
  "marketing",
  "press",
  "media",
  "security",
];

// Keep this small and safe; users can extend later.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "10minutemail.com",
  "10minutemail.net",
  "guerrillamail.com",
  "temp-mail.org",
  "tempmail.com",
  "yopmail.com",
  "getnada.com",
]);

export function normalizeEmail(raw: string): string {
  const e = String(raw || "").trim().toLowerCase();
  if (!e || !e.includes("@")) return e;
  const [localRaw, domainRaw] = e.split("@");
  const domain = (domainRaw || "").trim();
  let local = (localRaw || "").trim();

  // Gmail variants: ignore dots + plus tags.
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.split("+")[0].replace(/\./g, "");
  } else {
    // For other providers, removing plus tags is generally safe for dedupe,
    // but keep dots intact.
    local = local.split("+")[0];
  }

  return `${local}@${domain}`;
}

export function emailDomain(email: string): string {
  const e = String(email || "").toLowerCase();
  const idx = e.lastIndexOf("@");
  return idx >= 0 ? e.slice(idx + 1).trim() : "";
}

export function isFreeProvider(domain: string): boolean {
  return FREE_PROVIDERS.has(String(domain || "").toLowerCase());
}

export function isDisposable(domain: string): boolean {
  return DISPOSABLE_DOMAINS.has(String(domain || "").toLowerCase());
}

export function isRoleBased(email: string): boolean {
  const e = String(email || "").toLowerCase();
  const local = e.split("@")[0] || "";
  const base = local.split("+")[0];
  return ROLE_BASED_LOCAL_PREFIXES.some((p) => base === p || base.startsWith(`${p}.`) || base.startsWith(`${p}-`));
}

export async function hasMxRecord(domain: string): Promise<boolean> {
  const d = String(domain || "").trim().toLowerCase();
  if (!d) return false;
  try {
    const mx = await dns.resolveMx(d);
    return Array.isArray(mx) && mx.length > 0;
  } catch {
    return false;
  }
}

export function riskScore(flags: EmailRiskFlags, verifiedValid?: boolean): number {
  let score = 0;
  if (flags.suppressed) score += 100;
  if (flags.noMx) score += 50;
  if (flags.disposable) score += 40;
  if (flags.roleBased) score += 20;
  if (flags.catchAll) score += 25;
  if (flags.freeProvider) score += 10;
  if (verifiedValid === false) score += 60;
  if (flags.notVerified) score += 10;
  return Math.max(0, Math.min(100, score));
}

export function generateEmailPatterns(firstName: string, lastName: string, domain: string): string[] {
  const fn = String(firstName || "").trim().toLowerCase();
  const ln = String(lastName || "").trim().toLowerCase();
  const d = String(domain || "").trim().toLowerCase();
  if (!d) return [];

  const f = fn[0] || "";
  const l = ln[0] || "";

  const locals: string[] = [];

  // First + last variants (when both are available)
  if (fn && ln) {
    locals.push(
      `${fn}.${ln}`,
      `${fn}_${ln}`,
      `${fn}-${ln}`,
      `${fn}${ln}`,
      `${f}${ln}`,
      `${fn}${l}`,
      `${f}.${ln}`,
      `${fn}.${l}`,
      `${ln}.${fn}`,
      `${ln}_${fn}`,
      `${ln}${fn}`,
    );
  }

  // Single-name fallbacks (useful when the target uses short locals like `sarah@...`)
  if (fn) locals.push(`${fn}`, `${f}`);
  if (ln) locals.push(`${ln}`, `${l}`);

  // Deduplicate while preserving order.
  const out: string[] = [];
  const seen = new Set<string>();
  for (const local of locals) {
    const e = `${local}@${d}`;
    const norm = normalizeEmail(e);
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(e);
    }
  }
  return out;
}
