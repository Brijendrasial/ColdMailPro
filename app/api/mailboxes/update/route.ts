import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isEmailish(x: string) {
  const s = x.trim();
  return s.includes("@") && !s.includes(" ");
}

function clampInt(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function clampPort(n: number) {
  return clampInt(n, 1, 65535);
}

function nonEmptyStr(v: any) {
  if (typeof v !== "string") return "";
  return v.trim();
}

export async function POST(req: NextRequest) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const id = String(body?.id || "");
  const data = body?.data || {};
  if (!id) return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });

  const mb = await prisma.mailbox.findFirst({ where: { id, workspaceId: s.wid } });
  if (!mb) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const patch: any = {};

  if (typeof data.name === "string") patch.name = data.name.trim().slice(0, 120) || mb.name;
  if (typeof data.fromEmail === "string") {
    const v = data.fromEmail.trim();
    if (!isEmailish(v)) return NextResponse.json({ error: "INVALID_FROM" }, { status: 400 });
    patch.fromEmail = v;
  }

  if ("replyTo" in data) {
    const v = data.replyTo === null ? null : String(data.replyTo || "").trim();
    if (v && !isEmailish(v)) return NextResponse.json({ error: "INVALID_REPLY_TO" }, { status: 400 });
    patch.replyTo = v || null;
  }

  if ("isActive" in data) patch.isActive = !!data.isActive;
  if ("warmupEnabled" in data) patch.warmupEnabled = !!data.warmupEnabled;

  if ("dailyLimit" in data) {
    patch.dailyLimit = clampInt(Number(data.dailyLimit), 1, 100000);
  }

  if ("localAddress" in data) {
    const v = data.localAddress === null ? null : String(data.localAddress || "").trim();
    patch.localAddress = v || null;
  }

  // SMTP (advanced)
  if (typeof data.smtpHost === "string") {
    const v = nonEmptyStr(data.smtpHost);
    if (!v) return NextResponse.json({ error: "INVALID_SMTP_HOST" }, { status: 400 });
    patch.smtpHost = v.slice(0, 255);
  }
  if ("smtpPort" in data) {
    patch.smtpPort = clampPort(Number(data.smtpPort));
  }
  if ("smtpSecure" in data) {
    patch.smtpSecure = !!data.smtpSecure;
  }
  if (typeof data.smtpUser === "string") {
    const v = nonEmptyStr(data.smtpUser);
    if (!v) return NextResponse.json({ error: "INVALID_SMTP_USER" }, { status: 400 });
    patch.smtpUser = v.slice(0, 255);
  }
  if (typeof data.smtpPass === "string") {
    // Only overwrite if user provided a non-empty password (leave blank to keep existing).
    const v = String(data.smtpPass || "");
    if (v.trim()) patch.smtpPassEnc = encrypt(v);
  }

  // IMAP (advanced)
  if ("imapHost" in data || "imapUser" in data || "imapPass" in data || "imapPort" in data || "imapSecure" in data || "imapTlsSkipVerify" in data) {
    const imapHostRaw = ("imapHost" in data) ? data.imapHost : mb.imapHost;
    const imapHost = imapHostRaw === null ? null : nonEmptyStr(imapHostRaw);

    // Clear IMAP config if host is explicitly emptied/null.
    if ("imapHost" in data && !imapHost) {
      patch.imapHost = null;
      patch.imapUser = null;
      patch.imapPassEnc = null;
      patch.imapLastUid = 0;
    } else {
      // When enabling/updating IMAP host, we require an IMAP user. Password can be kept if already set.
      if (typeof data.imapHost === "string" && imapHost) patch.imapHost = imapHost.slice(0, 255);
      if ("imapPort" in data) patch.imapPort = clampPort(Number(data.imapPort));
      if ("imapSecure" in data) patch.imapSecure = !!data.imapSecure;
      if ("imapTlsSkipVerify" in data) patch.imapTlsSkipVerify = !!data.imapTlsSkipVerify;

      if ("imapUser" in data) {
        const u = data.imapUser === null ? null : nonEmptyStr(data.imapUser);
        patch.imapUser = u || null;
      }

      if ("imapPass" in data) {
        // null explicitly clears password; non-empty string overwrites.
        if (data.imapPass === null) {
          patch.imapPassEnc = null;
          patch.imapLastUid = 0;
        } else if (typeof data.imapPass === "string") {
          const p = String(data.imapPass || "");
          if (p.trim()) {
            patch.imapPassEnc = encrypt(p);
            patch.imapLastUid = 0;
          }
        }
      }

      // Validate: if host is set (either existing or being set), imapUser must be set.
      const finalHost = ("imapHost" in patch) ? patch.imapHost : mb.imapHost;
      const finalUser = ("imapUser" in patch) ? patch.imapUser : mb.imapUser;
      if (finalHost && !finalUser) {
        return NextResponse.json({ error: "IMAP_USER_REQUIRED" }, { status: 400 });
      }
    }
  }

  await prisma.mailbox.update({ where: { id }, data: patch });
  return NextResponse.json({ ok: true });
}
