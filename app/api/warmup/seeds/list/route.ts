import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  let s: any;
  try { s = await requireSession(); } catch { return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }); }
  const seeds = await prisma.warmupSeedInbox.findMany({
    where: { workspaceId: s.wid },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      source: true,
      imapHost: true,
      imapPort: true,
      imapSecure: true,
      imapUser: true,
      isActive: true,
      lastCheckedAt: true,
      smtpHost: true,
      smtpPort: true,
      smtpSecure: true,
      smtpUser: true,
      smtpPassEnc: true,
    },
  });
  const out = seeds.map((s: any) => ({
    ...s,
    smtpConfigured: !!(s.smtpHost && s.smtpUser && s.smtpPassEnc),
    smtpPassEnc: undefined,
  }));
  return NextResponse.json({ seeds: out });
}
