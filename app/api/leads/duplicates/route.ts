import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { emailDomain, normalizeEmail } from "@/lib/email-quality";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function norm(s: any) {
  return String(s || "").trim().toLowerCase();
}

function nameKey(l: any) {
  const n = `${norm(l.firstName)} ${norm(l.lastName)}`.trim();
  return n || "(blank)";
}

function hostKey(url: any) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return (u.hostname || "").replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function GET(req: NextRequest) {
  const s = await requireSession();
  const url = new URL(req.url);
  const limit = Math.min(5000, Math.max(200, Number(url.searchParams.get("limit") || 2000) || 2000));

  const leads = await prisma.lead.findMany({
    where: { workspaceId: s.wid },
    take: limit,
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, firstName: true, lastName: true, company: true, website: true, status: true, tags: true, createdAt: true },
  });

  // Detect duplicates across multiple signals:
  // 1) normalized email (gmail dots/+ variants)
  // 2) website host + name
  // 3) domain (website host OR email domain) + name
  type Group = { key: string; type: string; title: string; subtitle: string; leads: any[] };

  const out: Group[] = [];

  // 1) normalized email duplicates
  {
    const byEmail = new Map<string, any[]>();
    for (const l of leads) {
      const ne = normalizeEmail(String(l.email || ""));
      if (!ne || !ne.includes("@")) continue;
      const arr = byEmail.get(ne) || [];
      arr.push(l);
      byEmail.set(ne, arr);
    }
    for (const [ne, arr] of byEmail.entries()) {
      if (arr.length < 2) continue;
      out.push({
        key: `email|${ne}`,
        type: "email",
        title: ne,
        subtitle: "Same person: email variants",
        leads: arr,
      });
    }
  }

  // 2) website host + name duplicates
  {
    const byHostName = new Map<string, any[]>();
    for (const l of leads) {
      const nk = nameKey(l);
      const hk = hostKey(l.website);
      if (!hk || nk === "(blank)") continue;
      const key = `${hk}|${nk}`;
      const arr = byHostName.get(key) || [];
      arr.push(l);
      byHostName.set(key, arr);
    }
    for (const [key, arr] of byHostName.entries()) {
      if (arr.length < 2) continue;
      const [host, name] = key.split("|");
      out.push({
        key: `host|${key}`,
        type: "website+name",
        title: host,
        subtitle: `Name: ${name}`,
        leads: arr,
      });
    }
  }

  // 3) domain + name duplicates (fallback when website missing)
  {
    const byDomainName = new Map<string, any[]>();
    for (const l of leads) {
      const nk = nameKey(l);
      if (nk === "(blank)") continue;
      const hk = hostKey(l.website);
      const dom = hk || emailDomain(String(l.email || ""));
      if (!dom) continue;
      const key = `${dom}|${nk}`;
      const arr = byDomainName.get(key) || [];
      arr.push(l);
      byDomainName.set(key, arr);
    }
    for (const [key, arr] of byDomainName.entries()) {
      if (arr.length < 2) continue;
      // Avoid duplicating groups already covered by website+name (same key)
      if (out.some((g) => g.key === `host|${key}`)) continue;
      const [domain, name] = key.split("|");
      out.push({
        key: `domain|${key}`,
        type: "domain+name",
        title: domain,
        subtitle: `Name: ${name}`,
        leads: arr,
      });
    }
  }

  // Limit + stable ordering: biggest groups first
  out.sort((a, b) => (b.leads?.length || 0) - (a.leads?.length || 0));
  const groups = out.slice(0, 50);

  return NextResponse.json({ ok: true, groups, scanned: leads.length });
}
