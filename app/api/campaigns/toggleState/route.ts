import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueueJob } from "@/worker/queue";
import { buildCampaignQaReport } from "@/lib/campaign-qa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({} as any));
  const id = String(body.id || "");
  const requestedTo = body?.to ? String(body.to) : null;

  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

  const camp = await prisma.campaign.findFirst({ where: { id, workspaceId: s.wid } });
  if (!camp) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  if ((camp as any).archivedAt) {
    return NextResponse.json({ ok: false, error: "Campaign is archived" }, { status: 400 });
  }

  // Allow explicit target status (UI can request restart for derived "completed").
  // If not provided, default toggle behavior is: running -> paused, otherwise -> running.
  const allowed = new Set(["running", "paused", "stopped"]);
  const nextStatus = requestedTo && allowed.has(requestedTo)
    ? (requestedTo as any)
    : (camp.status === "running" ? "paused" : "running");

  // Pre-send QA gate: block starting if there are hard errors.
  if (nextStatus === "running") {
    const report = await buildCampaignQaReport(s.wid, id);
    if (!report.ok) {
      return NextResponse.json({ ok: false, error: "VALIDATION_FAILED", report }, { status: 400 });
    }
  }

  await prisma.campaign.update({ where: { id }, data: { status: nextStatus } });

  // When starting (or restarting), always enqueue a schedule tick even if status didn't change.
  if (nextStatus === "running") {
    await enqueueJob("schedule_campaign", { campaignId: id, workspaceId: s.wid }, new Date());
  }

  return NextResponse.json({ ok: true, status: nextStatus });
}
