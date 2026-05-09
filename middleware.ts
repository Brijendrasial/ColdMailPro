import { NextRequest, NextResponse } from "next/server";

export const config = {
  // Do not run middleware on /t/* tracking endpoints to avoid logging query-string PII.
  matcher: ["/api/:path*", "/app/:path*"],
};

function isSafeMethod(method: string) {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function isAllowedOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return true; // Non-browser clients typically omit Origin.
  const host = req.headers.get("host");
  if (!host) return false;

  try {
    const o = new URL(origin);
    if (o.host === host) return true;

    // Optional allowlist: comma-separated origins in ALLOWED_ORIGINS
    const allow = String(process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    return allow.includes(o.origin);
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest, event: any) {
  const { pathname } = req.nextUrl;

  // Backward-compatible 2FA API aliases without creating virtual build routes.
  if (pathname.startsWith("/api/auth/2fa/")) {
    const url = req.nextUrl.clone();
    url.pathname = pathname.replace("/api/auth/2fa/", "/api/auth/twofa/");
    return NextResponse.rewrite(url);
  }
  if (pathname.startsWith("/api/settings/2fa/")) {
    const url = req.nextUrl.clone();
    url.pathname = pathname.replace("/api/settings/2fa/", "/api/settings/twofa/");
    return NextResponse.rewrite(url);
  }

  // Basic CSRF mitigation for cookie-authenticated API routes:
  // block cross-origin unsafe requests (POST/PUT/PATCH/DELETE) when Origin is present.
  if (pathname.startsWith("/api/") && !isSafeMethod(req.method)) {
    if (!isAllowedOrigin(req)) {
      return NextResponse.json({ error: "CSRF blocked: invalid origin" }, { status: 403 });
    }
  }

  // Avoid recursive logging
  if (pathname.startsWith("/api/logs/ingest")) return NextResponse.next();

  const token = process.env.INTERNAL_LOG_TOKEN;
  if (!token) return NextResponse.next();

  const requestId = (globalThis.crypto as any)?.randomUUID
    ? (globalThis.crypto as any).randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const res = NextResponse.next({
    request: {
      headers: new Headers(req.headers),
    },
  });
  res.headers.set("x-request-id", requestId);

  // Fire-and-forget: record request event in AppLog
  // IMPORTANT: do not log query values (may contain tokens/PII).
  event.waitUntil(
    fetch(new URL("/api/logs/ingest", req.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-log-token": token,
      },
      body: JSON.stringify({
        level: "info",
        category: "http",
        event: "request",
        requestId,
        message: `${req.method} ${pathname}`,
        data: {
          method: req.method,
          pathname,
          // record only param names, not values
          searchParams: Array.from(req.nextUrl.searchParams.keys()),
          userAgent: req.headers.get("user-agent"),
        },
      }),
    }).catch(() => null)
  );

  return res;
}
