import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n) : s;
}

export async function POST(req: NextRequest) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as any;
  const mailboxId = String(body?.mailboxId || "").trim();
  const to = String(body?.to || "").trim();
  const subject = clip(String(body?.subject || "Test email").trim() || "Test email", 200);
  const text = clip(String(body?.text || "This is a test email from ColdMailPro.").trim() || "This is a test email from ColdMailPro.", 20_000);

  if (!mailboxId) return NextResponse.json({ error: "MISSING_MAILBOX" }, { status: 400 });
  if (!to || !to.includes("@")) return NextResponse.json({ error: "INVALID_TO" }, { status: 400 });

  const mb = await prisma.mailbox.findFirst({ where: { id: mailboxId, workspaceId: s.wid } });
  if (!mb) return NextResponse.json({ error: "MAILBOX_NOT_FOUND" }, { status: 404 });

  // Track test sends as Messages so inbound IMAP replies can be matched.
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
    select: { id: true },
  });

  const job = await prisma.job.create({
    data: {
      type: "mailbox_test_send",
      payload: JSON.stringify({
        workspaceId: s.wid,
        mailboxId,
        to,
        subject,
        text,
        messageRowId: msg.id,
      }),
      runAt: new Date(),
      status: "queued",
    },
    select: { id: true },
  });

  try {
    await prisma.jobLog.create({ data: { jobId: job.id, line: `Queued test send to ${to}` } });
  } catch {}

  return NextResponse.json({ queued: true, jobId: job.id, messageRowId: msg.id });
}
