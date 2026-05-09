import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getCampaignMailboxDashboard } from "@/lib/campaign-mailboxes-dashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const campaignId = String(searchParams.get("campaignId") || "");
  if (!campaignId) return NextResponse.json({ error: "MISSING_CAMPAIGN_ID" }, { status: 400 });

  const data = await getCampaignMailboxDashboard(s.wid, campaignId);
  if (!data) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json({ ok: true, data });
}
