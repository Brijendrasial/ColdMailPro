import crypto from "crypto";
import { env } from "./env";

export function sha256Base64Url(input: string) {
  return crypto.createHash("sha256").update(input).digest("base64url");
}

export function encrypt(plain: string): string {
  // Simple AES-256-GCM encryption (for mailbox passwords).
  // In production, rotate keys and re-encrypt.
  const key = crypto.createHash("sha256").update(env.JWT_SECRET).digest(); // 32 bytes
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
  const key = crypto.createHash("sha256").update(env.JWT_SECRET).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return plain.toString("utf8");
}

export function randomToken(len = 32) {
  return crypto.randomBytes(len).toString("base64url");
}
