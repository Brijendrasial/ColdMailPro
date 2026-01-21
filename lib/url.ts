import type { NextRequest } from "next/server";

import { env } from "./env";

/**
 * Build an absolute URL that always uses PUBLIC_APP_URL (server IP/domain),
 * never 0.0.0.0/localhost.
 */
export function absoluteUrl(req: NextRequest, path: string) {
  // env.PUBLIC_APP_URL is required by lib/env.ts
  const base = env.PUBLIC_APP_URL.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return new URL(p, base);
}
