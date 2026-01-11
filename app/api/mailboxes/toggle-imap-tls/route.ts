import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/url";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const f = await req.formData();
  const id = String(f.get("id") || "");

  const mb = await prisma.mailbox.findFirst({ where: { id, workspaceId: s.wid } });
  if (!mb) return NextResponse.redirect(absoluteUrl(req, "/app/mailboxes"));

  await prisma.mailbox.update({
    where: { id },
    data: { imapTlsSkipVerify: !mb.imapTlsSkipVerify },
  });

  return NextResponse.redirect(absoluteUrl(req, "/app/mailboxes"));
}
