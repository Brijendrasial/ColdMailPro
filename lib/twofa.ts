import crypto from "crypto";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { authenticator } from "otplib";

import { encrypt, decrypt } from "./crypto";

// Allow a small window to tolerate minor clock drift
authenticator.options = { window: 1 };

export type TwoFAStartResult = {
  secretBase32: string;
  otpauthUrl: string;
  qrDataUrl: string;
};

export async function startTotpSetup(opts: {
  email: string;
  issuer?: string;
}): Promise<TwoFAStartResult> {
  const issuer = opts.issuer || "ColdMail Pro";
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(opts.email, issuer, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
  return { secretBase32: secret, otpauthUrl, qrDataUrl };
}

export function verifyTotp(code: string, secretBase32: string): boolean {
  const cleaned = String(code || "").trim().replace(/\s+/g, "");
  if (!cleaned) return false;
  return authenticator.check(cleaned, secretBase32);
}

export function encryptTotpSecret(secretBase32: string) {
  return encrypt(secretBase32);
}

export function decryptTotpSecret(enc: string) {
  return decrypt(enc);
}

export function generateRecoveryCodes(count = 10) {
  const out: string[] = [];
  while (out.length < count) {
    // 12 chars of A-Z0-9 formatted as XXXX-XXXX-XXXX
    const raw = crypto
      .randomBytes(12)
      .toString("base64")
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase();
    if (raw.length < 12) continue;
    const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
    out.push(code);
  }
  return out;
}

export async function hashRecoveryCodes(codes: string[]) {
  const hashes: string[] = [];
  for (const c of codes) {
    hashes.push(await bcrypt.hash(c, 10));
  }
  return hashes;
}

export async function matchAndConsumeRecoveryCode(opts: {
  input: string;
  hashesJson: string | null | undefined;
}): Promise<{ ok: true; remainingHashesJson: string } | { ok: false }> {
  const input = String(opts.input || "").trim().toUpperCase();
  if (!input) return { ok: false };
  let hashes: string[] = [];
  try {
    hashes = opts.hashesJson ? JSON.parse(opts.hashesJson) : [];
    if (!Array.isArray(hashes)) hashes = [];
  } catch {
    hashes = [];
  }
  if (hashes.length === 0) return { ok: false };

  for (let i = 0; i < hashes.length; i++) {
    const h = hashes[i];
    if (typeof h !== "string") continue;
    const ok = await bcrypt.compare(input, h);
    if (ok) {
      hashes.splice(i, 1);
      return { ok: true, remainingHashesJson: JSON.stringify(hashes) };
    }
  }
  return { ok: false };
}

export function countRecoveryCodes(hashesJson: string | null | undefined) {
  try {
    const a = hashesJson ? JSON.parse(hashesJson) : [];
    return Array.isArray(a) ? a.length : 0;
  } catch {
    return 0;
  }
}
