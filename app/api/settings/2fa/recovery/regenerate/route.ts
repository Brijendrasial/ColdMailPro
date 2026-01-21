import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  decryptTotpSecret,
  generateRecoveryCodes,
  hashRecoveryCodes,
  verifyTotp,
} from "@/lib/twofa";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({}));
  const password = String(body?.password || "");
  const token = String(body?.token || "").trim();

  if (!password || !token) return NextResponse.json({ ok: false, error: "Password and 2FA code required" }, { status: 400 });

  const me = await prisma.user.findUnique({
    where: { id: s.uid },
    select: { id: true, passwordHash: true, twoFactorEnabled: true, twoFactorSecretEnc: true },
  });

  if (!me) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  if (!me.twoFactorEnabled || !me.twoFactorSecretEnc) return NextResponse.json({ ok: false, error: "2FA not enabled" }, { status: 400 });

  const passOk = await bcrypt.compare(password, me.passwordHash);
  if (!passOk) return NextResponse.json({ ok: false, error: "Wrong password" }, { status: 400 });

  const secret = decryptTotpSecret(me.twoFactorSecretEnc);
  const ok = verifyTotp(token, secret);
  if (!ok) return NextResponse.json({ ok: false, error: "Invalid 2FA code" }, { status: 400 });

  const recoveryCodes = generateRecoveryCodes(10);
  const hashes = await hashRecoveryCodes(recoveryCodes);

  await prisma.user.update({
    where: { id: me.id },
    data: { twoFactorRecoveryCodesHash: JSON.stringify(hashes) },
  });

  return NextResponse.json({ ok: true, recoveryCodes });
}
