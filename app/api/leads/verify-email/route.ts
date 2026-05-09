import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { PingEmail } from "ping-email";
import {
  emailDomain,
  hasMxRecord,
  isDisposable,
  isFreeProvider,
  isRoleBased,
  riskScore,
} from "@/lib/email-quality";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


const Body = z.object({
  email: z.string().email(),
  verifyMode: z.enum(["smtp", "no_smtp"]).optional().default("no_smtp"),
  // When true, SMTP verification must run and the mailbox must be explicitly confirmed.
  // Note: some providers (e.g. Gmail) may not reliably disclose mailbox existence.
  requireMailbox: z.boolean().optional().default(false),
  senderMailboxId: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  let raw: any = null;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const body = parsed.data;
  const email = body.email.trim().toLowerCase();

  // Global DNC / suppression safety: do not treat suppressed emails as valid.
  const suppressed = await prisma.suppression.findUnique({
    where: { workspaceId_email: { workspaceId: s.wid, email } },
    select: { id: true, reason: true },
  });

  const dom = emailDomain(email);
  const mxOk = dom ? await hasMxRecord(dom) : false;
  const baseFlags = {
    suppressed: !!suppressed,
    noMx: !mxOk,
    freeProvider: isFreeProvider(dom),
    roleBased: isRoleBased(email),
    disposable: isDisposable(dom),
  } as any;

  if (suppressed) {
    return NextResponse.json({
      ok: true,
      email,
      valid: false,
      success: true,
      message: `Suppressed (DNC) - ${suppressed.reason}`,
      mailboxConfirmed: false,
      risk: {
        score: riskScore({ ...baseFlags, notVerified: false }, false),
        flags: baseFlags,
        domain: dom,
        mx: mxOk,
      },
    });
  }

  if (!env.PING_EMAIL_ENABLED) {
    return NextResponse.json(
      { ok: false, error: "Email verification is not enabled on the server (PING_EMAIL_ENABLED=1)." },
      { status: 400 }
    );
  }

  const fqdn = env.PING_EMAIL_FQDN || undefined;
  if (!fqdn) {
    return NextResponse.json({ ok: false, error: "PING_EMAIL_FQDN is required for verification." }, { status: 400 });
  }

  const ignoreSMTPVerify = body.verifyMode === "no_smtp";
  if (body.requireMailbox && ignoreSMTPVerify) {
    return NextResponse.json(
      {
        ok: false,
        error: "Mailbox verification requires SMTP mode",
        message: "Switch verification mode to Full (MX + SMTP) to verify the mailbox.",
      },
      { status: 400 }
    );
  }

  let sender = env.PING_EMAIL_SENDER || undefined;
  if (body.senderMailboxId) {
    const mb = await prisma.mailbox.findFirst({
      where: { id: body.senderMailboxId, workspaceId: s.wid },
      select: { fromEmail: true },
    });
    if (mb?.fromEmail) sender = mb.fromEmail;
  }

  if (!sender) {
    return NextResponse.json(
      { ok: false, error: "PING_EMAIL_SENDER (or a senderMailboxId) is required for verification." },
      { status: 400 }
    );
  }

  const pingEmail = new PingEmail({
    port: env.PING_EMAIL_PORT,
    fqdn,
    sender,
    timeout: env.PING_EMAIL_TIMEOUT_MS,
    attempts: env.PING_EMAIL_ATTEMPTS,
    ignoreSMTPVerify,
    debug: env.PING_EMAIL_DEBUG,
  } as any);

  try {
    const res = await pingEmail.ping(email);

    const valid = !!res?.valid;
    const message = String(res?.message || "").trim() || (valid ? "OK" : "Invalid email");
    const mailboxConfirmed = message === "Valid email";

    // Best-effort catch-all signal from ping-email output.
    const catchAll =
      !!(res as any)?.catchAll ||
      !!(res as any)?.isCatchAll ||
      /catch[ -]?all/i.test(String((res as any)?.message || "")) ||
      /catch[ -]?all/i.test(String((res as any)?.details || ""));

    const flags = {
      ...baseFlags,
      catchAll: !!catchAll,
      notVerified: !valid,
    } as any;
    const score = riskScore(flags, valid);

    // If caller requires mailbox confirmation, treat anything other than "Valid email" as invalid.
    if (body.requireMailbox && !mailboxConfirmed) {
      return NextResponse.json({
        ok: true,
        email,
        valid: false,
        success: !!res?.success,
        message,
        mailboxConfirmed,
        risk: { score, flags, domain: dom, mx: mxOk },
      });
    }

    return NextResponse.json({
      ok: true,
      email,
      valid,
      success: !!res?.success,
      message,
      mailboxConfirmed,
      risk: { score, flags, domain: dom, mx: mxOk },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Verification error", message: String(e?.message || e || "Unknown error") },
      { status: 502 }
    );
  }
}
