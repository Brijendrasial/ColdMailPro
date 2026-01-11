import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { buildCampaignQaReport } from "@/lib/campaign-qa";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || "");

  if (!id) {
    return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });
  }

  const report = await buildCampaignQaReport(s.wid, id);
  return NextResponse.json({ ok: report.ok, report });
}
