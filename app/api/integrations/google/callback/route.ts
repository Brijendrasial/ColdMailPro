import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/auth";
import { googleOAuthClient, upsertGoogleCalendarAccount } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { google } from "googleapis";

const STATE_COOKIE = "cm_google_oauth_state";
const NEXT_COOKIE = "cm_google_oauth_next";

export async function GET(req: NextRequest) {
  try {
    const s = await requireSession();
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    const expectedState = cookies().get(STATE_COOKIE)?.value;
    const next = cookies().get(NEXT_COOKIE)?.value || "/app/replies";

    // Clear ephemeral cookies either way.
    cookies().set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    cookies().set(NEXT_COOKIE, "", { path: "/", maxAge: 0 });

    if (!code) {
      return NextResponse.redirect(`${next}?google=error&reason=missing_code`);
    }
    if (!state || !expectedState || state !== expectedState) {
      return NextResponse.redirect(`${next}?google=error&reason=bad_state`);
    }

    const oauth2 = googleOAuthClient();
    const { tokens } = await oauth2.getToken(code);

    // Fetch account email (best-effort)
    let googleEmail: string | null = null;
    try {
      oauth2.setCredentials(tokens);
      const oauth2api = google.oauth2({ version: "v2", auth: oauth2 });
      const me = await oauth2api.userinfo.get();
      const em = (me.data as any)?.email;
      if (typeof em === "string" && em.includes("@")) googleEmail = em;
    } catch {}

    // Ensure we always have a refresh token.
    let refreshToken = tokens.refresh_token ? String(tokens.refresh_token) : "";
    if (!refreshToken) {
      const existing = await prisma.googleCalendarAccount.findUnique({ where: { workspaceId: s.wid }, select: { refreshTokenEnc: true } }).catch(() => null as any);
      if (existing?.refreshTokenEnc) {
        try {
          refreshToken = decrypt(existing.refreshTokenEnc);
        } catch {}
      }
    }

    if (!refreshToken) {
      // This can happen if the user granted access earlier but Google didn't return refresh_token.
      return NextResponse.redirect(`${next}?google=error&reason=missing_refresh_token`);
    }

    await upsertGoogleCalendarAccount({
      workspaceId: s.wid,
      connectedByUserId: s.uid,
      googleEmail,
      refreshToken,
      scope: tokens.scope ? String(tokens.scope) : null,
    });

    return NextResponse.redirect(`${next}?google=connected`);
  } catch {
    return NextResponse.redirect(`/app/replies?google=error`);
  }
}
