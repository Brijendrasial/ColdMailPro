import nodemailer from "nodemailer";
import { prisma } from "./prisma";
import { decrypt } from "./crypto";
import { env } from "./env";
import { appLogAsync } from "@/lib/app-log";

export type SendEmailInput = {
  mailboxId: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
  inReplyTo?: string;
  references?: string;
  messageId?: string;
};

function cleanMsgId(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/<[^>]+>/);
  return (m ? m[0] : s) || null;
}

export async function sendEmail(input: SendEmailInput) {
  const started = Date.now();
  void appLogAsync({
    level: "info",
    category: "mail",
    event: "send_start",
    message: `send to ${input.to}`,
    entityType: "mailbox",
    entityId: input.mailboxId,
    data: { to: input.to, subject: input.subject?.slice(0, 200) },
  });

  const mb = await prisma.mailbox.findUnique({ where: { id: input.mailboxId } });
  if (!mb) throw new Error("MAILBOX_NOT_FOUND");
  if (!mb.isActive) throw new Error("MAILBOX_INACTIVE");

  const pass = decrypt(mb.smtpPassEnc);

  // TEMP workaround for misconfigured certificates (eg. cert issued for srv1.* but using mail.domain)
  // Prefer fixing the certificate on the mail server. This is a fallback.
  // We reuse the existing IMAP skip-verify checkbox to avoid a DB migration.
  const smtpTlsSkipVerify = Boolean(env.SMTP_TLS_SKIP_VERIFY || mb.imapTlsSkipVerify);

  const localAddress = mb.localAddress || env.DEFAULT_SMTP_LOCAL_ADDRESS || undefined;

  const transporter = nodemailer.createTransport({
    host: mb.smtpHost,
    port: mb.smtpPort,
    secure: mb.smtpSecure,
    auth: { user: mb.smtpUser, pass },
    tls: {
      // SNI + hostname verification control
      servername: mb.smtpHost,
      rejectUnauthorized: !smtpTlsSkipVerify,
    },
    // NodeMailer supports `localAddress` for SMTP connections
    localAddress,
    // timeouts
    connectionTimeout: 30_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  });

  const from = `${mb.name} <${mb.fromEmail}>`;
  const headers: Record<string, string> = {
    ...(input.headers || {}),
    "X-ColdMailPro": "1",
  };

  // One-click unsubscribe endpoint (List-Unsubscribe)
  const unsubUrl = `${env.PUBLIC_APP_URL}/t/unsub?email=${encodeURIComponent(input.to)}&mb=${mb.id}`;
  headers["List-Unsubscribe"] = `<${unsubUrl}>`;
  headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";

  try {
    const info = await transporter.sendMail({
      from,
      to: input.to,
      replyTo: mb.replyTo || undefined,
      subject: input.subject,
      text: input.text,
      html: input.html,
      headers,
      messageId: input.messageId,
      inReplyTo: input.inReplyTo,
      references: input.references,
    });

    const canonicalMessageId = cleanMsgId((info as any).messageId || input.messageId);

    void appLogAsync({
      level: "info",
      category: "mail",
      event: "send_ok",
      message: `sent to ${input.to} (${Date.now() - started}ms)`,
      entityType: "mailbox",
      entityId: input.mailboxId,
      data: {
        to: input.to,
        subject: input.subject?.slice(0, 200),
        messageId: canonicalMessageId,
        response: (info as any).response || null,
        accepted: (info as any).accepted || [],
        rejected: (info as any).rejected || [],
        ms: Date.now() - started,
      },
    });

    return {
      messageId: canonicalMessageId,
      response: (info as any).response || null,
      accepted: (info as any).accepted || [],
      rejected: (info as any).rejected || [],
    };
  } catch (e: any) {
    void appLogAsync({
      level: "error",
      category: "mail",
      event: "send_fail",
      message: String(e?.message || e),
      entityType: "mailbox",
      entityId: input.mailboxId,
      data: {
        to: input.to,
        subject: input.subject?.slice(0, 200),
        ms: Date.now() - started,
        stack: e?.stack,
      },
    });
    throw e;
  }
}
