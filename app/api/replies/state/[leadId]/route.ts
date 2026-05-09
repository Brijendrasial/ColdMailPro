import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normalizeLabels(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 25);
  if (typeof v === "string") {
    return v
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 25);
  }
  return [];
}

function parseMaybeDate(v: any): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d;
}

export async function PATCH(req: NextRequest, ctx: { params: { leadId: string } }) {
  try {
    const s = await requireSession();
    const leadId = String(ctx.params.leadId || "");

    const lead = await prisma.lead.findFirst({ where: { id: leadId, workspaceId: s.wid }, select: { id: true } });
    if (!lead) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

    const body = (await req.json().catch(() => ({}))) as any;

    const patch: any = {};
    if (typeof body.status === "string") patch.status = body.status.slice(0, 32);
    if (typeof body.isPinned === "boolean") patch.isPinned = body.isPinned;
    if (typeof body.isStarred === "boolean") patch.isStarred = body.isStarred;
    if ("snoozeUntil" in body) patch.snoozeUntil = parseMaybeDate(body.snoozeUntil);
    if ("labels" in body) patch.labels = normalizeLabels(body.labels);

    if ("assignedToUserId" in body) {
      const uid = body.assignedToUserId ? String(body.assignedToUserId) : "";
      patch.assignedToUserId = uid || null;
    }

    // Read tracking is shared at the workspace level.
    if (body.markRead) patch.lastReadAt = new Date();
    if (body.markUnread) patch.lastReadAt = null;

    const row = await prisma.replyLeadState.upsert({
      where: { workspaceId_leadId: { workspaceId: s.wid, leadId } },
      create: { workspaceId: s.wid, leadId, ...patch },
      update: { ...patch },
    });

    return NextResponse.json({ ok: true, state: row });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: "FAILED" }, { status: 500 });
  }
}
