import { NextRequest, NextResponse } from "next/server";
import { login } from "@/lib/auth";
import { absoluteUrl } from "@/lib/url";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = String(form.get("email") || "");
  const password = String(form.get("password") || "");
  const u = await login(email, password, {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || undefined,
    userAgent: req.headers.get("user-agent") || undefined,
  });
  if (!u) return NextResponse.redirect(absoluteUrl(req, "/login?err=1"));
  if ((u as any).requires2fa) return NextResponse.redirect(absoluteUrl(req, "/login/2fa"));
  return NextResponse.redirect(absoluteUrl(req, "/app"));
}
