import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { PingEmail } from "ping-email";

export const runtime = "nodejs";

const Body = z.object({
  email: z.string().email(),
  firstName: z.string().max(80).optional().nullable(),
  lastName: z.string().max(80).optional().nullable(),
  company: z.string().max(120).optional().nullable(),
  website: z.string().max(200).optional().nullable(),
  tags: z.string().max(500).optional().nullable(), // comma-separated
  status: z.string().max(40).optional().nullable(),
  verify: z.boolean().optional().default(false),
  verifyMode: z.enum(["smtp", "no_smtp"]).optional().default("smtp"),
  // When true, SMTP verification must run and the mailbox must be explicitly confirmed.
  // Note: some providers (e.g. Gmail) may not reliably disclose mailbox existence.
  requireMailbox: z.boolean().optional().default(false),
  senderMailboxId: z.string().optional().nullable(),
});

function normalizeTags(tags: string | null | undefined) {
  if (!tags) return null;
  const out = String(tags)
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return out.length ? Array.from(new Set(out)).slice(0, 200).join(",") : null;
}

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

  // Global suppression (DNC) safety: never create leads for suppressed emails.
  const suppressed = await prisma.suppression.findUnique({
    where: { workspaceId_email: { workspaceId: s.wid, email } },
    select: { reason: true },
  });
  if (suppressed) {
    return NextResponse.json(
      { ok: false, error: `Suppressed (DNC): ${suppressed.reason}` },
      { status: 422 }
    );
  }

  const allowedStatuses = new Set(["active", "replied", "unsubscribed", "bounced", "suppressed"]);
  const status = body.status ? String(body.status).trim().toLowerCase() : "active";
  const finalStatus = allowedStatuses.has(status) ? status : "active";

  // Optional verification via ping-email
  if (body.verify) {
    if (!env.PING_EMAIL_ENABLED) {
      return NextResponse.json(
        {
          ok: false,
          error: "Email verification is not enabled on the server (PING_EMAIL_ENABLED=1).",
        },
        { status: 400 }
      );
    }

    const fqdn = env.PING_EMAIL_FQDN || undefined;
    const fallbackSender = env.PING_EMAIL_SENDER || undefined;

    if (!fqdn) {
      return NextResponse.json(
        { ok: false, error: "PING_EMAIL_FQDN is required for verification." },
        { status: 400 }
      );
    }

    let sender = fallbackSender;

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

    // IMPORTANT: If the user chose SMTP mode (or requireMailbox), we must NOT ignore SMTP verification.
    // Previous builds allowed PING_EMAIL_IGNORE_SMTP_VERIFY to override SMTP mode and caused confusion.
    const ignoreSMTPVerify = body.verifyMode === "no_smtp";
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

      // If library says invalid → reject
      if (!res?.valid) {
        return NextResponse.json(
          {
            ok: false,
            error: "Verification failed",
            message: res?.message || "Invalid email",
            success: !!res?.success,
          },
          { status: 422 }
        );
      }

      // If caller requires mailbox confirmation, only accept when the library explicitly reports "Valid email".
      // Anything else (e.g. "Valid domain", "Unable to verify email", timeouts, etc.) will be rejected.
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

      const mailboxConfirmed = String(res?.message || "").trim() === "Valid email";
      if (body.requireMailbox && !mailboxConfirmed) {
        return NextResponse.json(
          {
            ok: false,
            error: "Mailbox not confirmed",
            message: res?.message || "Mailbox could not be confirmed",
            success: !!res?.success,
          },
          { status: 422 }
        );
      }
    } catch (e: any) {
      return NextResponse.json(
        { ok: false, error: "Verification error", message: String(e?.message || e || "Unknown error") },
        { status: 502 }
      );
    }
  }

  try {
    const lead = await prisma.lead.create({
      data: {
        workspaceId: s.wid,
        email,
        firstName: body.firstName ? String(body.firstName) : null,
        lastName: body.lastName ? String(body.lastName) : null,
        company: body.company ? String(body.company) : null,
        website: body.website ? String(body.website) : null,
        tags: normalizeTags(body.tags),
        status: finalStatus,
      },
      select: { id: true, email: true },
    });

    return NextResponse.json({ ok: true, lead });
  } catch (e: any) {
    // Prisma unique constraint
    const msg = String(e?.message || "");
    if (msg.includes("Unique constraint") || msg.includes("P2002")) {
      return NextResponse.json({ ok: false, error: "Lead already exists" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: "Failed to create lead" }, { status: 500 });
  }
}
