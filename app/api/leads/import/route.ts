import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parse } from "csv-parse/sync";
import { absoluteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.redirect(absoluteUrl(req, "/app/leads?err=1"));

  const text = await file.text();
  const records = parse(text, { columns: true, skip_empty_lines: true, trim: true });

  let inserted = 0;
  for (const r of records) {
    const email = String(r.email || r.Email || "").toLowerCase().trim();
    if (!email) continue;

    try {
      await prisma.lead.create({
        data: {
          workspaceId: s.wid,
          email,
          firstName: r.firstName || r.FirstName || r.firstname || null,
          lastName: r.lastName || r.LastName || r.lastname || null,
          company: r.company || r.Company || null,
          website: r.website || r.Website || null,
          tags: r.tags || r.Tags || null,
        },
      });
      inserted++;
    } catch {
      // duplicate -> ignore
    }
  }

  return NextResponse.redirect(absoluteUrl(req, `/app/leads?ok=${inserted}`));
}