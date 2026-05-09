import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const id = String(new URL(req.url).searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });

  const mb = await prisma.mailbox.findFirst({
    where: { id, workspaceId: s.wid },
    select: {
      id: true,
      name: true,
      fromEmail: true,
      replyTo: true,
      isActive: true,
      warmupEnabled: true,
      dailyLimit: true,
      localAddress: true,

      smtpHost: true,
      smtpPort: true,
      smtpSecure: true,
      smtpUser: true,
      smtpPassEnc: true,

      imapHost: true,
      imapPort: true,
      imapSecure: true,
      imapTlsSkipVerify: true,
      imapUser: true,
      imapPassEnc: true,
      imapLastUid: true,

      createdAt: true,
      updatedAt: true,
    },
  });

  if (!mb) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json({
    mailbox: {
      id: mb.id,
      name: mb.name,
      fromEmail: mb.fromEmail,
      replyTo: mb.replyTo,
      isActive: mb.isActive,
      warmupEnabled: mb.warmupEnabled,
      dailyLimit: mb.dailyLimit,
      localAddress: mb.localAddress,

      smtpHost: mb.smtpHost,
      smtpPort: mb.smtpPort,
      smtpSecure: mb.smtpSecure,
      smtpUser: mb.smtpUser,
      hasSmtpPass: !!mb.smtpPassEnc,

      imapHost: mb.imapHost,
      imapPort: mb.imapPort,
      imapSecure: mb.imapSecure,
      imapTlsSkipVerify: mb.imapTlsSkipVerify,
      imapUser: mb.imapUser,
      hasImapPass: !!mb.imapPassEnc,
      imapLastUid: mb.imapLastUid,

      createdAt: mb.createdAt.toISOString(),
      updatedAt: mb.updatedAt.toISOString(),
    },
  });
}
