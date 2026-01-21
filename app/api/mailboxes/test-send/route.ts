import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/url";
import { sendEmail } from "@/lib/mailer";

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n) : s;
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const f = await req.formData();

  const mailboxId = String(f.get("mailboxId") || "");
  const to = String(f.get("to") || "").trim();
  const subject = clip(String(f.get("subject") || "Test email").trim() || "Test email", 200);
  const text = clip(String(f.get("text") || "This is a test email from ColdMailPro.").trim() || "This is a test email from ColdMailPro.", 20_000);

  const back = "/app/mailboxes";

  try {
    if (!mailboxId) throw new Error("MISSING_MAILBOX");
    if (!to || !to.includes("@")) throw new Error("INVALID_TO");

    const mb = await prisma.mailbox.findFirst({ where: { id: mailboxId, workspaceId: s.wid } });
    if (!mb) throw new Error("MAILBOX_NOT_FOUND");

    // Track test sends as Messages so inbound IMAP replies can be matched.
    // Also link to a Lead (upsert) so we can fallback-match replies even if clients omit In-Reply-To/References.
    const normTo = to.toLowerCase();
    const lead = await prisma.lead.upsert({
      where: { workspaceId_email: { workspaceId: s.wid, email: normTo } },
      update: {},
      create: { workspaceId: s.wid, email: normTo },
    });

    const msg = await prisma.message.create({
      data: {
        workspaceId: s.wid,
        mailboxId,
        campaignId: null,
        leadId: lead.id,
        subject,
        bodyText: text,
        status: "queued",
      },
    });

    try {
      const res = await sendEmail({
        mailboxId,
        to,
        subject,
        text,
        headers: {
          // helpful for debugging; replies can still match on Message-ID
          "X-ColdMailPro-Test": "1",
          "X-ColdMailPro-Message": msg.id,
        },
      });

      await prisma.message.update({
        where: { id: msg.id },
        data: {
          status: "sent",
          sentAt: new Date(),
          messageId: res.messageId || null,
        },
      }).catch(() => {});
      await prisma.event
        .create({ data: { messageId: msg.id, type: "sent", meta: JSON.stringify({ to, kind: "test" }) } })
        .catch(() => {});

      const qs = `?sent=1&to=${encodeURIComponent(to)}&mid=${encodeURIComponent(res.messageId || "")}`;
      return NextResponse.redirect(absoluteUrl(req, back + qs));
    } catch (e: any) {
      const err = String(e?.message || e);
      await prisma.message
        .update({ where: { id: msg.id }, data: { status: "failed", error: err } })
        .catch(() => {});
      throw e;
    }
  } catch (e: any) {
    const msg = clip(String(e?.message || "SEND_FAILED"), 120);
    return NextResponse.redirect(absoluteUrl(req, `${back}?err=${encodeURIComponent(msg)}`));
  }
}
