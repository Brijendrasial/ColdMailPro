import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  decryptTotpSecret,
  generateRecoveryCodes,
  hashRecoveryCodes,
  verifyTotp,
} from "@/lib/twofa";

import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function reqMeta(req: NextRequest) {
  return {
    ip:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null,
    userAgent: req.headers.get("user-agent") || null,
  };
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({}));
  const token = String(body?.token || "").trim();
  if (!token) return NextResponse.json({ ok: false, error: "Token required" }, { status: 400 });

  const me = await prisma.user.findUnique({
    where: { id: s.uid },
    select: {
      id: true,
      twoFactorEnabled: true,
      twoFactorTempSecretEnc: true,
    },
  });

  if (!me) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  if (me.twoFactorEnabled) return NextResponse.json({ ok: false, error: "2FA already enabled" }, { status: 400 });
  if (!me.twoFactorTempSecretEnc) return NextResponse.json({ ok: false, error: "Start setup first" }, { status: 400 });

  const secret = decryptTotpSecret(me.twoFactorTempSecretEnc);
  const ok = verifyTotp(token, secret);
  if (!ok) return NextResponse.json({ ok: false, error: "Invalid code" }, { status: 400 });

  const recoveryCodes = generateRecoveryCodes(10);
  const hashes = await hashRecoveryCodes(recoveryCodes);

  await prisma.user.update({
    where: { id: me.id },
    data: {
      twoFactorEnabled: true,
      twoFactorSecretEnc: me.twoFactorTempSecretEnc,
      twoFactorTempSecretEnc: null,
      twoFactorRecoveryCodesHash: JSON.stringify(hashes),
      twoFactorEnabledAt: new Date(),
    },
  });

  const meta = reqMeta(req);
  await logAudit({
    workspaceId: s.wid,
    actorUserId: s.uid,
    action: "security.2fa.enable",
    targetType: "user",
    targetId: s.uid,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return NextResponse.json({ ok: true, recoveryCodes });
}
