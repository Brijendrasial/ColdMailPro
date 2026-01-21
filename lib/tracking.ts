import crypto from "crypto";
import { env } from "./env";

function hmacKey(): Buffer {
  // Separate secret for tracking signatures, with safe fallback.
  // IMPORTANT: Set TRACKING_LINK_SECRET in production.
  const secret = env.TRACKING_LINK_SECRET || env.JWT_SECRET;
  return crypto.createHash("sha256").update(secret).digest();
}

export function signTrackingClick(to: string, messageId: string) {
  return crypto.createHmac("sha256", hmacKey()).update(`${messageId}|${to}`).digest("base64url");
}

export function verifyTrackingClick(to: string, messageId: string, sig: string) {
  try {
    const expected = signTrackingClick(to, messageId);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function parseSafeHttpUrl(to: string): URL | null {
  try {
    const u = new URL(to);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}
