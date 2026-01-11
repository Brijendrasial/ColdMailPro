import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Action =
  | "tag_add"
  | "tag_remove"
  | "set_status"
  | "dnc"
  | "unsuppress"
  | "enroll_campaign"
  | "stop_campaigns"
  | "delete";

function norm(s: string) {
  return s.trim().toLowerCase();
}

function parseTags(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => norm(String(x))).filter(Boolean);
  return String(v)
    .split(",")
    .map((t) => norm(t))
    .filter(Boolean);
}

function mergeTags(existing: string | null | undefined, add: string[], remove: string[] = []) {
  const set = new Set<string>();
  for (const t of String(existing || "")
    .split(",")
    .map((x) => norm(x))
    .filter(Boolean)) {
    set.add(t);
  }
  for (const t of add) set.add(t);
  for (const t of remove) set.delete(t);
  return Array.from(set).join(",");
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({} as any));
  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : [];
  const action: Action = String(body.action || "") as Action;

  if (!ids.length) return NextResponse.json({ ok: false, error: "Missing ids" }, { status: 400 });

  const leads = await prisma.lead.findMany({ where: { id: { in: ids }, workspaceId: s.wid }, select: { id: true, email: true, tags: true } });
  const foundIds = leads.map((l) => l.id);
  if (!foundIds.length) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  if (action === "tag_add") {
    const tags = parseTags(body.tags);
    if (!tags.length) return NextResponse.json({ ok: false, error: "Missing tags" }, { status: 400 });
    await Promise.all(
      leads.map((l) =>
        prisma.lead.update({
          where: { id: l.id },
          data: { tags: mergeTags(l.tags, tags) },
        })
      )
    );
    return NextResponse.json({ ok: true });
  }

  if (action === "tag_remove") {
    const tags = parseTags(body.tags);
    if (!tags.length) return NextResponse.json({ ok: false, error: "Missing tags" }, { status: 400 });
    await Promise.all(
      leads.map((l) =>
        prisma.lead.update({
          where: { id: l.id },
          data: { tags: mergeTags(l.tags, [], tags) },
        })
      )
    );
    return NextResponse.json({ ok: true });
  }

  if (action === "set_status") {
    const status = norm(String(body.status || ""));
    if (!status) return NextResponse.json({ ok: false, error: "Missing status" }, { status: 400 });
    await prisma.lead.updateMany({ where: { id: { in: foundIds } }, data: { status } });
    return NextResponse.json({ ok: true });
  }

  if (action === "dnc") {
    // Create suppressions + mark lead status
    const reason = norm(String(body.reason || "manual")) || "manual";
    await Promise.all(
      leads.map((l) =>
        prisma.suppression.upsert({
          where: { workspaceId_email: { workspaceId: s.wid, email: l.email } },
          create: { workspaceId: s.wid, email: l.email, reason },
          update: { reason },
        })
      )
    );
    await prisma.lead.updateMany({ where: { id: { in: foundIds } }, data: { status: "suppressed" } });
    return NextResponse.json({ ok: true });
  }

  if (action === "unsuppress") {
    // Remove suppressions + mark lead active
    const emails = leads.map((l) => l.email);
    await prisma.suppression.deleteMany({ where: { workspaceId: s.wid, email: { in: emails } } });
    await prisma.lead.updateMany({ where: { id: { in: foundIds }, workspaceId: s.wid }, data: { status: "active" } });
    return NextResponse.json({ ok: true });
  }

  if (action === "enroll_campaign") {
    const campaignId = String(body.campaignId || "");
    if (!campaignId) return NextResponse.json({ ok: false, error: "Missing campaignId" }, { status: 400 });
    const camp = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId: s.wid }, select: { id: true } });
    if (!camp) return NextResponse.json({ ok: false, error: "Campaign not found" }, { status: 404 });
    const now = new Date();
    // createMany + skipDuplicates is supported by Prisma for MySQL
    await prisma.enrollment.createMany({
      data: foundIds.map((leadId) => ({ campaignId, leadId, status: "queued", currentStep: 1, nextRunAt: now })),
      skipDuplicates: true,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "stop_campaigns") {
    // Stop all enrollments for these leads in this workspace
    await prisma.enrollment.updateMany({
      where: {
        leadId: { in: foundIds },
        campaign: { workspaceId: s.wid },
        status: { not: "stopped" },
      },
      data: { status: "stopped", stopReason: "manual" },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "delete") {
    await prisma.lead.deleteMany({ where: { id: { in: foundIds }, workspaceId: s.wid } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
