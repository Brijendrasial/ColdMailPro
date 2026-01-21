import { NextRequest, NextResponse } from "next/server";
import { absoluteUrl } from "@/lib/url";
import { clearTwoFAPendingCookie, createDbSessionAndCookie, getTwoFAPending } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptTotpSecret, matchAndConsumeRecoveryCode, verifyTotp } from "@/lib/twofa";

export async function POST(req: NextRequest) {
  const pending = await getTwoFAPending();
  if (!pending) return NextResponse.redirect(absoluteUrl(req, "/login?err=1"));

  const form = await req.formData();
  const token = String(form.get("token") || "").trim();
  const recovery = String(form.get("recovery") || "").trim();

  const user = await prisma.user.findUnique({
    where: { id: pending.uid },
    select: {
      id: true,
      twoFactorEnabled: true,
      twoFactorSecretEnc: true,
      twoFactorRecoveryCodesHash: true,
    },
  });

  if (!user || !user.twoFactorEnabled || !user.twoFactorSecretEnc) {
    clearTwoFAPendingCookie();
    return NextResponse.redirect(absoluteUrl(req, "/login?err=1"));
  }

  const secret = decryptTotpSecret(user.twoFactorSecretEnc);

  let ok = false;
  let remainingRecoveryJson: string | null | undefined = user.twoFactorRecoveryCodesHash;

  if (recovery) {
    const m = await matchAndConsumeRecoveryCode({ input: recovery, hashesJson: user.twoFactorRecoveryCodesHash });
    if (m.ok) {
      ok = true;
      remainingRecoveryJson = m.remainingHashesJson;
    }
  } else if (token) {
    ok = verifyTotp(token, secret);
  }

  if (!ok) return NextResponse.redirect(absoluteUrl(req, "/login/2fa?err=1"));

  if (recovery) {
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorRecoveryCodesHash: remainingRecoveryJson || JSON.stringify([]) },
    });
  }

  await createDbSessionAndCookie({ uid: pending.uid, wid: pending.wid }, {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || undefined,
    userAgent: req.headers.get("user-agent") || undefined,
  });
  clearTwoFAPendingCookie();
  return NextResponse.redirect(absoluteUrl(req, "/app"));
}
