import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function safeJsonParse(v: any) {
  try {
    return JSON.parse(String(v || "{}"));
  } catch {
    return null;
  }
}

type Health = {
  pending: boolean;
  checkedAt: string | null;
  status: "unknown" | "healthy" | "warning" | "fail";
  score: number;
  issues: string[];
  spf: { ok: boolean; detail?: string } | null;
  dkim: { ok: boolean; selector?: string; detail?: string } | null;
  dmarc: { ok: boolean; policy?: string; detail?: string } | null;
  mx: { ok: boolean; detail?: string } | null;
};

export async function GET() {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const domains = await prisma.domain.findMany({
    where: { workspaceId: s.wid },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, dkimSelector: true, trackingSubdomain: true, createdAt: true },
  });

  // Optional: attach Mailstack tenant info if those models exist
  const p: any = prisma as any;
  const mailstackByDomain = new Map<string, { tenantId: string; tenantName: string; ipCount: number }>();
  if (p?.mailstackTenantDomain) {
    try {
      const links = await p.mailstackTenantDomain.findMany({
        where: { domainName: { in: domains.map((d: any) => d.name) }, tenant: { workspaceId: s.wid } },
        include: { tenant: { include: { ips: { select: { id: true } } } } },
      });
      for (const l of links as any[]) {
        const dn = String(l.domainName || "").toLowerCase();
        const t = l.tenant;
        if (!dn || !t?.id) continue;
        mailstackByDomain.set(dn, { tenantId: String(t.id), tenantName: String(t.name || ""), ipCount: Array.isArray(t.ips) ? t.ips.length : 0 });
      }
    } catch {
      // ignore
    }
  }

  if (!domains.length) {
    return NextResponse.json({ domains: [] });
  }

  // Latest checks are stored in Job.lastError as structured JSON.
  // Job has no workspaceId column, so we filter by parsing payload.
  const recent = await prisma.job.findMany({
    where: {
      type: "domain_dns_check",
      status: { in: ["queued", "running", "done", "failed"] },
    },
    orderBy: { createdAt: "desc" },
    take: 1200,
    select: { id: true, status: true, payload: true, lastError: true, createdAt: true },
  });

  const domainIds = new Set(domains.map((d) => d.id));
  const pending = new Set<string>();
  const latest = new Map<string, { status: string; createdAt: Date; result: any }>();

  for (const j of recent as any[]) {
    const p = safeJsonParse(j.payload);
    if (!p) continue;
    if (String(p.workspaceId || "") !== String(s.wid)) continue;
    const did = String(p.domainId || "");
    if (!did || !domainIds.has(did)) continue;
    if (j.status === "queued" || j.status === "running") pending.add(did);
    if (!latest.has(did) && (j.status === "done" || j.status === "failed")) {
      const r = safeJsonParse(j.lastError);
      latest.set(did, { status: j.status, createdAt: j.createdAt, result: r });
    }
  }

  const out = domains.map((d) => {
    const r = latest.get(d.id)?.result;
    const health: Health = {
      pending: pending.has(d.id),
      checkedAt: r?.checkedAt || (latest.get(d.id)?.createdAt ? latest.get(d.id)!.createdAt.toISOString() : null),
      status: (r?.summary?.status as any) || "unknown",
      score: Number(r?.summary?.score ?? 0) || 0,
      issues: Array.isArray(r?.summary?.issues) ? r.summary.issues : [],
      spf: r?.records?.spf ? { ok: !!r.records.spf.ok, detail: r.records.spf.detail } : null,
      dkim: r?.records?.dkim ? { ok: !!r.records.dkim.ok, selector: r.records.dkim.selector, detail: r.records.dkim.detail } : null,
      dmarc: r?.records?.dmarc ? { ok: !!r.records.dmarc.ok, policy: r.records.dmarc.policy, detail: r.records.dmarc.detail } : null,
      mx: r?.records?.mx ? { ok: !!r.records.mx.ok, detail: r.records.mx.detail } : null,
    };
    return {
      id: d.id,
      name: d.name,
      dkimSelector: d.dkimSelector,
      trackingSubdomain: d.trackingSubdomain,
      createdAt: d.createdAt.toISOString(),
      health,
      mailstack: mailstackByDomain.get(String(d.name || "").toLowerCase()) || null,
    };
  });

  return NextResponse.json({ domains: out });
}
