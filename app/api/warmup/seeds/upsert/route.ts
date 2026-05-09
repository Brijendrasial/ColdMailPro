import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let s: any;
  try { s = await requireSession(); } catch { return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }); }

  const b = await req.json().catch(() => ({} as any));
  const id = b.id ? String(b.id) : null;

  const name = String(b.name || "").trim();
  const email = String(b.email || "").trim().toLowerCase();

  const imapHost = String(b.imapHost || "").trim();
  const imapPort = Number(b.imapPort ?? 993);
  const imapSecure = b.imapSecure === undefined ? true : Boolean(b.imapSecure);
  const imapUser = String(b.imapUser || "").trim();
  const password = String(b.password || "");

  const isActive = b.isActive === undefined ? true : Boolean(b.isActive);

  const hasSmtpPatch = ("smtpHost" in b) || ("smtpPort" in b) || ("smtpSecure" in b) || ("smtpUser" in b) || ("smtpPassword" in b);

  if (!name || !email || !imapHost || !imapUser) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  if (!password && !id) return NextResponse.json({ error: "Password required for new seed" }, { status: 400 });

  const data: any = {
    workspaceId: s.wid,
    name,
    email,
    imapHost,
    imapPort,
    imapSecure,
    imapUser,
    isActive,
  };
  if (password) data.imapPassEnc = encrypt(password);

  // SMTP patching:
  // - If smtpHost is explicitly "" => clear all SMTP fields
  // - Otherwise only set smtp fields that are explicitly present
  if (hasSmtpPatch) {
    const smtpHostRaw = ("smtpHost" in b) ? (b.smtpHost === null ? "" : String(b.smtpHost)) : undefined;
    const smtpHost = smtpHostRaw === undefined ? undefined : smtpHostRaw.trim();

    if (smtpHost !== undefined && smtpHost === "") {
      data.smtpHost = null;
      data.smtpPort = null;
      data.smtpSecure = false;
      data.smtpUser = null;
      data.smtpPassEnc = null;
    } else {
      if (smtpHost !== undefined) data.smtpHost = smtpHost;

      if ("smtpPort" in b) {
        const smtpPort = b.smtpPort === undefined || b.smtpPort === null || b.smtpPort === "" ? null : Number(b.smtpPort);
        data.smtpPort = (smtpPort !== null && !Number.isNaN(smtpPort)) ? smtpPort : null;
      }

      if ("smtpSecure" in b) {
        data.smtpSecure = Boolean(b.smtpSecure);
      }

      if ("smtpUser" in b) {
        const smtpUser = b.smtpUser === undefined || b.smtpUser === null ? null : String(b.smtpUser).trim();
        data.smtpUser = smtpUser || null;
      }

      const smtpPassword = String(b.smtpPassword || "");
      if (smtpPassword) data.smtpPassEnc = encrypt(smtpPassword);

      // Normalize common SMTP TLS settings for known ports to prevent TLS mismatch errors.
      if (data.smtpPort === 587) data.smtpSecure = false;
      if (data.smtpPort === 465) data.smtpSecure = true;
    }
  }

  if (id) {
    const existing = await prisma.warmupSeedInbox.findFirst({ where: { id, workspaceId: s.wid }, select: { id: true, source: true } });
    if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    data.source = existing.source;
    await prisma.warmupSeedInbox.update({ where: { id }, data });
  } else {
    await prisma.warmupSeedInbox.create({ data: { ...data, source: "manual" } });
  }

  return NextResponse.json({ ok: true });
}
