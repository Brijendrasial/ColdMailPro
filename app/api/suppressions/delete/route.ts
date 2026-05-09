import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({} as any));
  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : [];
  const emails: string[] = Array.isArray(body.emails) ? body.emails.map(String) : [];

  if (!ids.length && !emails.length) {
    return NextResponse.json({ ok: false, error: "Missing ids or emails" }, { status: 400 });
  }

  if (ids.length) {
    const toDel = await prisma.suppression.findMany({ where: { id: { in: ids }, workspaceId: s.wid }, select: { email: true } });
    const delEmails = toDel.map((x) => x.email);
    await prisma.suppression.deleteMany({ where: { id: { in: ids }, workspaceId: s.wid } });
    if (delEmails.length) {
      await prisma.lead.updateMany({ where: { workspaceId: s.wid, email: { in: delEmails } }, data: { status: "active" } });
    }
    return NextResponse.json({ ok: true });
  }

  await prisma.suppression.deleteMany({ where: { workspaceId: s.wid, email: { in: emails } } });
  await prisma.lead.updateMany({ where: { workspaceId: s.wid, email: { in: emails } }, data: { status: "active" } });
  return NextResponse.json({ ok: true });
}
