import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { absoluteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const f = await req.formData();

  const name = String(f.get("name") || "").trim();
  const fromEmail = String(f.get("fromEmail") || "").trim();
  const smtpHost = String(f.get("smtpHost") || "").trim();
  const smtpPort = Number(f.get("smtpPort") || 587);
  const smtpUser = String(f.get("smtpUser") || "").trim();
  const smtpPass = String(f.get("smtpPass") || "");
  const smtpSecure = f.get("smtpSecure") === "on";

  const imapHost = String(f.get("imapHost") || "").trim() || null;
  const imapPort = Number(f.get("imapPort") || 993);
  const imapUser = String(f.get("imapUser") || "").trim() || null;
  const imapPass = String(f.get("imapPass") || "");
  const imapSecure = f.get("imapSecure") !== null ? (f.get("imapSecure") === "on") : true;
  const imapTlsSkipVerify = f.get("imapTlsSkipVerify") === "on";
  const dailyLimit = Number(f.get("dailyLimit") || 50);
  const localAddress = String(f.get("localAddress") || "").trim() || null;

  if (!name || !fromEmail || !smtpHost || !smtpUser || !smtpPass) {
    return NextResponse.redirect(absoluteUrl(req, "/app/mailboxes?err=1"));
  }

  await prisma.mailbox.create({
    data: {
      workspaceId: s.wid,
      name,
      fromEmail,
      smtpHost,
      smtpPort,
      smtpUser,
      smtpPassEnc: encrypt(smtpPass),
      smtpSecure,
      dailyLimit,
      localAddress,
      imapHost,
      imapPort,
      imapUser,
      imapPassEnc: imapHost && imapUser && imapPass ? encrypt(imapPass) : null,
      imapSecure,
      imapTlsSkipVerify,
    },
  });

  return NextResponse.redirect(absoluteUrl(req, "/app/mailboxes?ok=1"));
}