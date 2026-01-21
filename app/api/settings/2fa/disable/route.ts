import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptTotpSecret, matchAndConsumeRecoveryCode, verifyTotp } from "@/lib/twofa";
import { logAudit } from "@/lib/audit";

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
  const password = String(body?.password || "");
  const token = String(body?.token || "").trim();
  const recovery = String(body?.recovery || "").trim();

  if (!password) return NextResponse.json({ ok: false, error: "Password required" }, { status: 400 });

  const me = await prisma.user.findUnique({
    where: { id: s.uid },
    select: {
      id: true,
      passwordHash: true,
      twoFactorEnabled: true,
      twoFactorSecretEnc: true,
      twoFactorRecoveryCodesHash: true,
    },
  });

  if (!me) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  if (!me.twoFactorEnabled || !me.twoFactorSecretEnc) return NextResponse.json({ ok: false, error: "2FA not enabled" }, { status: 400 });

  const passOk = await bcrypt.compare(password, me.passwordHash);
  if (!passOk) return NextResponse.json({ ok: false, error: "Wrong password" }, { status: 400 });

  const secret = decryptTotpSecret(me.twoFactorSecretEnc);
  let ok = false;

  if (recovery) {
    const m = await matchAndConsumeRecoveryCode({ input: recovery, hashesJson: me.twoFactorRecoveryCodesHash });
    ok = m.ok;
  } else if (token) {
    ok = verifyTotp(token, secret);
  }

  if (!ok) return NextResponse.json({ ok: false, error: "Invalid 2FA code" }, { status: 400 });

  await prisma.user.update({
    where: { id: me.id },
    data: {
      twoFactorEnabled: false,
      twoFactorSecretEnc: null,
      twoFactorTempSecretEnc: null,
      twoFactorRecoveryCodesHash: null,
      twoFactorEnabledAt: null,
    },
  });

  const meta = reqMeta(req);
  await logAudit({
    workspaceId: s.wid,
    actorUserId: s.uid,
    action: "security.2fa.disable",
    targetType: "user",
    targetId: s.uid,
    ip: meta.ip,
    userAgent: meta.userAgent,
    meta: { via: recovery ? "recovery" : "totp" },
  });

  return NextResponse.json({ ok: true });
}
