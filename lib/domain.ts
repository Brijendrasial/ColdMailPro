// Domain/URL helpers (no external deps)

const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
]);

function cleanHost(host: string): string {
  let h = String(host || "").trim().toLowerCase();
  if (h.startsWith("www.")) h = h.slice(4);
  return h;
}

export function normalizeWebsiteInput(input: string): { ok: true; url: string; host: string } | { ok: false; error: string } {
  const raw = String(input || "").trim();
  if (!raw) return { ok: false, error: "Missing website URL" };

  // Allow users to paste example.com (no scheme)
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`;

  try {
    const u = new URL(withScheme);
    const host = cleanHost(u.hostname);
    if (!host || !host.includes(".")) return { ok: false, error: "Invalid website hostname" };
    // Keep origin only (no path/query)
    const url = `https://${host}`;
    return { ok: true, url, host };
  } catch {
    return { ok: false, error: "Invalid website URL" };
  }
}

export function rootDomainCandidate(host: string): string | null {
  const h = cleanHost(host);
  const parts = h.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  // Best-effort (no PSL): take last 2 labels.
  return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
}

export function domainMatchers(host: string): string[] {
  const h = cleanHost(host);
  const root = rootDomainCandidate(h);
  const out = [h];
  if (root && root !== h) out.push(root);
  return Array.from(new Set(out)).filter(Boolean);
}

export function isGenericEmailDomain(domain: string): boolean {
  return GENERIC_EMAIL_DOMAINS.has(String(domain || "").trim().toLowerCase());
}

export function guessCompanyFromHost(host: string): string | null {
  const root = rootDomainCandidate(host) || cleanHost(host);
  const parts = String(root || "").split(".").filter(Boolean);
  if (!parts.length) return null;
  const sld = parts[0];
  if (!sld || sld.length < 2) return null;
  // avoid generic providers
  if (isGenericEmailDomain(root)) return null;

  // Title-case with simple separators
  const name = sld
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return name || null;
}
