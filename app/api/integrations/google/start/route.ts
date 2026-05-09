import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/auth";
import { randomToken } from "@/lib/crypto";
import { googleOAuthClient, googleOauthEnabled, googleOauthScopes } from "@/lib/google-calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_COOKIE = "cm_google_oauth_state";
const NEXT_COOKIE = "cm_google_oauth_next";

export async function GET(req: NextRequest) {
  const s = await requireSession();
  if (!googleOauthEnabled()) {
    return NextResponse.json({ ok: false, error: "GOOGLE_OAUTH_NOT_CONFIGURED" }, { status: 400 });
  }

  const url = new URL(req.url);
  const next = url.searchParams.get("next") || "/app/replies";

  const state = randomToken(16);
  cookies().set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });
  cookies().set(NEXT_COOKIE, next, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });

  // Note: we rely on the existing session cookie to identify workspace/user in the callback.
  void s;

  const oauth2 = googleOAuthClient();
  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: googleOauthScopes(),
    state,
  });

  return NextResponse.redirect(authUrl);
}
