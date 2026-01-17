import crypto from "crypto";
import { env } from "./env";

export function sha256Base64Url(input: string) {
  return crypto.createHash("sha256").update(input).digest("base64url");
}

// --- Encryption key handling ---
// Prefer ENCRYPTION_KEY (independent of JWT_SECRET). For backward compatibility,
// decrypt() will also try the legacy JWT_SECRET-derived key.
function deriveKeyFromSecret(secret: string): Buffer {
  // Support either:
  // 1) a raw string secret (hashed to 32 bytes), OR
  // 2) a base64/base64url 32-byte key.
  try {
    const b64 = secret.replace(/-/g, "+").replace(/_/g, "/");
    const buf = Buffer.from(b64, "base64");
    if (buf.length === 32) return buf;
  } catch {
    // ignore
  }
  return crypto.createHash("sha256").update(secret).digest(); // 32 bytes
}

function activeKey(): Buffer {
  return deriveKeyFromSecret(env.ENCRYPTION_KEY || env.JWT_SECRET);
}

function legacyKey(): Buffer {
  return deriveKeyFromSecret(env.JWT_SECRET);
}

export function encrypt(plain: string): string {
  // AES-256-GCM encryption (for mailbox passwords and other secrets).
  const key = activeKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(encB64: string): string {
  const raw = Buffer.from(encB64, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);

  const tryKey = (key: Buffer) => {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    return plain.toString("utf8");
  };

  // Try primary key first
  try {
    return tryKey(activeKey());
  } catch (e) {
    // Backward compatibility: if ENCRYPTION_KEY is set and differs from JWT_SECRET,
    // older rows may still be encrypted with the legacy key.
    if (env.ENCRYPTION_KEY) {
      return tryKey(legacyKey());
    }
    throw e;
  }
}

export function randomToken(len = 32) {
  return crypto.randomBytes(len).toString("base64url");
}
