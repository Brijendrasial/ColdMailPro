import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function norm(s: any) {
  return String(s || "").trim().toLowerCase();
}

function splitTags(tags: string | null | undefined) {
  return String(tags || "")
    .split(",")
    .map((t) => norm(t))
    .filter(Boolean);
}

function mergeTags(...arrays: (string | null | undefined)[]) {
  const set = new Set<string>();
  for (const a of arrays) {
    for (const t of splitTags(a)) set.add(t);
  }
  return Array.from(set).join(",") || null;
}

function statusPrecedence(s: any) {
  const v = norm(s);
  if (v === "suppressed") return 5;
  if (v === "unsubscribed") return 4;
  if (v === "replied") return 3;
  if (v === "bounced") return 2;
  return 1; // active/other
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({} as any));
  const primaryId = String(body.primaryId || "");
  const duplicateIds: string[] = Array.isArray(body.duplicateIds) ? body.duplicateIds.map(String) : [];

  if (!primaryId || !duplicateIds.length) {
    return NextResponse.json({ ok: false, error: "Missing primaryId or duplicateIds" }, { status: 400 });
  }

  // Ensure all leads belong to workspace
  const leads = await prisma.lead.findMany({
    where: { workspaceId: s.wid, id: { in: [primaryId, ...duplicateIds] } },
    select: { id: true, status: true, tags: true },
  });

  const primary = leads.find((l) => l.id === primaryId);
  if (!primary) return NextResponse.json({ ok: false, error: "Primary not found" }, { status: 404 });
  const dupes = leads.filter((l) => l.id !== primaryId);
  if (!dupes.length) return NextResponse.json({ ok: false, error: "No duplicates found" }, { status: 404 });

  const mergedTags = mergeTags(primary.tags, ...dupes.map((d) => d.tags));
  const mergedStatus = [primary, ...dupes].sort((a, b) => statusPrecedence(b.status) - statusPrecedence(a.status))[0].status;

  await prisma.$transaction(async (tx) => {
    // Merge enrollments: avoid @@unique(campaignId,leadId) collisions
    const dupeEnrollments = await tx.enrollment.findMany({
      where: { leadId: { in: dupes.map((d) => d.id) } },
      select: { id: true, campaignId: true, leadId: true },
    });

    if (dupeEnrollments.length) {
      const primaryEnrolls = await tx.enrollment.findMany({
        where: { leadId: primaryId, campaignId: { in: dupeEnrollments.map((e) => e.campaignId) } },
        select: { id: true, campaignId: true },
      });
      const existingCampaigns = new Set(primaryEnrolls.map((e) => e.campaignId));

      // For each dupe enrollment, either delete (if primary already has that campaign) or move to primary
      for (const e of dupeEnrollments) {
        if (existingCampaigns.has(e.campaignId)) {
          await tx.enrollment.delete({ where: { id: e.id } });
        } else {
          await tx.enrollment.update({ where: { id: e.id }, data: { leadId: primaryId } });
          existingCampaigns.add(e.campaignId);
        }
      }
    }

    // Move messages to primary
    await tx.message.updateMany({
      where: { leadId: { in: dupes.map((d) => d.id) } },
      data: { leadId: primaryId },
    });

    // Keep suppression rules: if any dupe is suppressed, ensure suppression exists for primary email
    // (suppression is keyed by email, not leadId; we keep lead status mergedStatus)

    // Update primary tags/status
    await tx.lead.update({ where: { id: primaryId }, data: { tags: mergedTags, status: mergedStatus } });

    // Delete dupe leads
    await tx.lead.deleteMany({ where: { id: { in: dupes.map((d) => d.id) }, workspaceId: s.wid } });
  });

  return NextResponse.json({ ok: true });
}
