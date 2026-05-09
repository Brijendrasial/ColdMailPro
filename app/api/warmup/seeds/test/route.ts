import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let s: any;
  try { s = await requireSession(); } catch { return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }); }

  const b = await req.json().catch(() => ({} as any));
  const id = String(b?.id || "").trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const seed = await prisma.warmupSeedInbox.findFirst({
    where: { id, workspaceId: s.wid },
    select: {
      id: true,
      name: true,
      email: true,
      imapHost: true,
      imapPort: true,
      imapSecure: true,
      imapUser: true,
      imapPassEnc: true,
      smtpHost: true,
      smtpPort: true,
      smtpSecure: true,
      smtpUser: true,
      smtpPassEnc: true,
    },
  });
  if (!seed) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  let imapOk = false;
  let smtpOk = false;
  let imapError: string | null = null;
  let smtpError: string | null = null;

  // IMAP test
  try {
    const client = new ImapFlow({
      host: seed.imapHost,
      port: seed.imapPort,
      secure: seed.imapSecure,
      auth: { user: seed.imapUser, pass: decrypt(seed.imapPassEnc) },
      logger: false,
      tls: { rejectUnauthorized: true },
    });
    await client.connect();
    // Open inbox to validate permissions
    await client.mailboxOpen("INBOX");
    await client.logout();
    imapOk = true;
  } catch (e: any) {
    imapError = String(e?.message || e);
  }

  // SMTP test (only if configured)
const smtpConfigured = !!(seed.smtpHost && seed.smtpPort && seed.smtpUser && seed.smtpPassEnc);
if (smtpConfigured) {
  const host = String(seed.smtpHost || "").trim();

  // Normalize common SMTP TLS settings (prevents "wrong version number" from TLS mismatch):
  // - 465 => implicit TLS => secure=true
  // - 587 => STARTTLS => secure=false
  let port = Number(seed.smtpPort || (seed.smtpSecure ? 465 : 587));
  let secure = Boolean(seed.smtpSecure);
  if (port === 587) secure = false;
  if (port === 465) secure = true;

  const mkTransport = (s: boolean, p: number) =>
    nodemailer.createTransport({
      host,
      port: p,
      secure: s,
      requireTLS: !s, // ensure STARTTLS upgrade on 587 so creds aren't sent in cleartext
      auth: { user: seed.smtpUser!, pass: decrypt(seed.smtpPassEnc!) },
      tls: {
        rejectUnauthorized: !env.SMTP_TLS_SKIP_VERIFY,
        servername: host || undefined,
      },
    } as any);

  try {
    let transport = mkTransport(secure, port);
    try {
      await transport.verify();
      smtpOk = true;
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      const looksLikeTlsMismatch =
        msg.includes("wrong version number") ||
        msg.includes("ssl3_get_record") ||
        msg.includes("SSL routines");
      if (!looksLikeTlsMismatch) throw e;

      // Retry once with flipped secure/port pairing.
      const altSecure = !secure;
      const altPort = altSecure ? 465 : 587;
      transport = mkTransport(altSecure, altPort);
      await transport.verify();
      smtpOk = true;
    }
  } catch (e: any) {
    smtpError = String(e?.message || e);
  }
} else {
  smtpError = "SMTP_NOT_CONFIGURED";
}

await prisma.warmupSeedInbox.update({
    where: { id: seed.id },
    data: { lastCheckedAt: new Date() },
  }).catch(() => {});

  return NextResponse.json({
    ok: imapOk && (smtpOk || !smtpConfigured),
    imapOk,
    smtpOk: smtpConfigured ? smtpOk : null,
    smtpConfigured,
    imapError,
    smtpError,
  });
}
