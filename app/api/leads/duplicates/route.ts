import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

  // group by (website host + name) OR (company domain-ish + name)
  const groups = new Map<string, any[]>();
  for (const l of leads) {
    const nk = nameKey(l);
    const hk = hostKey(l.website);
    if (!hk || nk === "(blank)") continue;
    const key = `${hk}|${nk}`;
    const arr = groups.get(key) || [];
    arr.push(l);
    groups.set(key, arr);
  }

  const dups = Array.from(groups.entries())
    .filter(([, arr]) => arr.length > 1)
    .slice(0, 50)
    .map(([key, arr]) => ({
      key,
      host: key.split("|")[0],
      name: key.split("|")[1],
      leads: arr,
    }));

  return NextResponse.json({ ok: true, groups: dups, scanned: leads.length });
}
