import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parse } from "csv-parse/sync";

function norm(s: any) {
  const v = String(s ?? "").trim();
  return v.length ? v : null;
}

function normEmail(s: any) {
  const v = String(s ?? "").toLowerCase().trim();
  return v.length ? v : null;
}

function mergeTags(existing: string | null | undefined, add: string | null) {
  const set = new Set<string>();
  for (const t of String(existing || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)) {
    set.add(t);
  }
  for (const t of String(add || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)) {
    set.add(t);
  }
  return Array.from(set).join(",") || null;
}

// Multipart form-data:
// - file: CSV (required)
// - upsert: "1" to update existing leads
// - batchTag: optional tag applied to every imported row
export async function POST(req: NextRequest) {
  const s = await requireSession();
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

  const upsert = String(form.get("upsert") || "") === "1";
  const batchTag = String(form.get("batchTag") || "").trim();

  const text = await file.text();
  const records: any[] = parse(text, { columns: true, skip_empty_lines: true, trim: true });

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let invalid = 0;

  for (const r of records) {
    const email = normEmail(r.email || r.Email);
    if (!email) {
      invalid++;
      continue;
    }

    const firstName = norm(r.firstName || r.FirstName || r.firstname);
    const lastName = norm(r.lastName || r.LastName || r.lastname);
    const company = norm(r.company || r.Company);
    const website = norm(r.website || r.Website);
    const rowTags = norm(r.tags || r.Tags);
    const finalTags = mergeTags(rowTags, batchTag || null);

    if (upsert) {
      // Update existing lead or create new
      const existing = await prisma.lead.findUnique({ where: { workspaceId_email: { workspaceId: s.wid, email } }, select: { id: true, tags: true } });
      if (existing) {
        await prisma.lead.update({
          where: { id: existing.id },
          data: {
            firstName: firstName ?? undefined,
            lastName: lastName ?? undefined,
            company: company ?? undefined,
            website: website ?? undefined,
            tags: mergeTags(existing.tags, finalTags),
          },
        });
        updated++;
      } else {
        await prisma.lead.create({
          data: {
            workspaceId: s.wid,
            email,
            firstName,
            lastName,
            company,
            website,
            tags: finalTags,
            status: "active",
          },
        });
        inserted++;
      }
      continue;
    }

    try {
      await prisma.lead.create({
        data: {
          workspaceId: s.wid,
          email,
          firstName,
          lastName,
          company,
          website,
          tags: finalTags,
          status: "active",
        },
      });
      inserted++;
    } catch {
      skipped++;
    }
  }

  return NextResponse.json({ ok: true, inserted, updated, skipped, invalid });
}
