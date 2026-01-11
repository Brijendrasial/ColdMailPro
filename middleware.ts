import { NextRequest, NextResponse } from "next/server";

export const config = {
  matcher: ["/api/:path*", "/app/:path*", "/t/:path*"],
};

export function middleware(req: NextRequest, event: any) {
  const { pathname } = req.nextUrl;

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
          search: req.nextUrl.search,
          userAgent: req.headers.get("user-agent"),
        },
      }),
    }).catch(() => null)
  );

  return res;
}
