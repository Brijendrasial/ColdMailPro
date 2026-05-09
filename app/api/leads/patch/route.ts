import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Update = z.object({
  id: z.string().min(1),
  firstName: z.string().max(80).nullable().optional(),
  lastName: z.string().max(80).nullable().optional(),
  company: z.string().max(120).nullable().optional(),
  website: z.string().max(200).nullable().optional(),
});

const Body = z.object({
  overwrite: z.boolean().optional().default(false),
  updates: z.array(Update).min(1),
});

function clean(s: any): string | null {
  if (s === undefined) return null;
  if (s === null) return null;
  const t = String(s).trim();
  return t ? t : null;
}

export async function POST(req: NextRequest) {
  const s = await requireSession();

  let raw: any = null;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const { overwrite, updates } = parsed.data;
  const ids = updates.map((u) => u.id);

  const existing = await prisma.lead.findMany({
    where: { id: { in: ids }, workspaceId: s.wid },
    select: { id: true, firstName: true, lastName: true, company: true, website: true },
  });

  const byId = new Map(existing.map((l) => [l.id, l] as const));
  const ops: Promise<any>[] = [];

  for (const u of updates) {
    const cur = byId.get(u.id);
    if (!cur) continue;

    const data: any = {};

    const nextFirst = u.firstName === undefined ? undefined : clean(u.firstName);
    const nextLast = u.lastName === undefined ? undefined : clean(u.lastName);
    const nextCompany = u.company === undefined ? undefined : clean(u.company);
    const nextWebsite = u.website === undefined ? undefined : clean(u.website);

    if (nextFirst !== undefined) {
      if (overwrite || !cur.firstName) data.firstName = nextFirst;
    }
    if (nextLast !== undefined) {
      if (overwrite || !cur.lastName) data.lastName = nextLast;
    }
    if (nextCompany !== undefined) {
      if (overwrite || !cur.company) data.company = nextCompany;
    }
    if (nextWebsite !== undefined) {
      if (overwrite || !cur.website) data.website = nextWebsite;
    }

    if (Object.keys(data).length) {
      ops.push(prisma.lead.update({ where: { id: u.id }, data }));
    }
  }

  await Promise.all(ops);
  return NextResponse.json({ ok: true, updated: ops.length });
}
