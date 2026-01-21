import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getGoogleCalendarAccount, googleOauthEnabled } from "@/lib/google-calendar";

export async function GET() {
  const s = await requireSession();
  const acct = await getGoogleCalendarAccount(s.wid);
  return NextResponse.json({
    ok: true,
    oauthConfigured: googleOauthEnabled(),
    connected: Boolean(acct),
    googleEmail: acct?.googleEmail || null,
    scope: acct?.scope || null,
    updatedAt: acct?.updatedAt ? acct.updatedAt.toISOString() : null,
  });
}
