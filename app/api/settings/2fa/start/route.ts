import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptTotpSecret, startTotpSetup } from "@/lib/twofa";

export async function POST(req: NextRequest) {
  const s = await requireSession();

  const me = await prisma.user.findUnique({
    where: { id: s.uid },
    select: { id: true, email: true, twoFactorEnabled: true },
  });

  if (!me) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  if (me.twoFactorEnabled) return NextResponse.json({ ok: false, error: "2FA already enabled" }, { status: 400 });

  const r = await startTotpSetup({ email: me.email, issuer: "ColdMail Pro" });
  await prisma.user.update({
    where: { id: me.id },
    data: { twoFactorTempSecretEnc: encryptTotpSecret(r.secretBase32) },
  });

  return NextResponse.json({ ok: true, qrDataUrl: r.qrDataUrl, manualSecret: r.secretBase32, otpauthUrl: r.otpauthUrl });
}
