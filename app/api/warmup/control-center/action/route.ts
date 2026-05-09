import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { ImapFlow } from "imapflow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ActionName =
  | "pause_mailbox"
  | "resume_mailbox"
  | "force_warmup_tick"
  | "force_seed_check"
  | "force_mailbox_check"
  | "test_imap";

export async function POST(req: Request) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({} as any));
  const action = String(body?.action || "").trim() as ActionName;
  const mailboxId = body?.mailboxId ? String(body.mailboxId) : null;

  if (!action) return NextResponse.json({ error: "action required" }, { status: 400 });

  // Actions that require a mailbox
  if (["pause_mailbox", "resume_mailbox", "force_warmup_tick", "test_imap"].includes(action) && !mailboxId) {
    return NextResponse.json({ error: "mailboxId required" }, { status: 400 });
  }

  const mailbox = mailboxId
    ? await prisma.mailbox.findFirst({
        where: { id: mailboxId, workspaceId: s.wid },
        select: {
          id: true,
          name: true,
          fromEmail: true,
          warmupEnabled: true,
          isActive: true,
          imapHost: true,
          imapPort: true,
          imapSecure: true,
          imapTlsSkipVerify: true,
          imapUser: true,
          imapPassEnc: true,
        },
      })
    : null;

  if (mailboxId && !mailbox) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // -------------------
  // Toggle warmup
  // -------------------
  if (action === "pause_mailbox") {
    await prisma.mailbox.update({ where: { id: mailbox!.id }, data: { warmupEnabled: false } }).catch(() => {});
    await prisma.warmupProfile.updateMany({ where: { mailboxId: mailbox!.id, workspaceId: s.wid }, data: { isActive: false } }).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (action === "resume_mailbox") {
    await prisma.mailbox.update({ where: { id: mailbox!.id }, data: { warmupEnabled: true } }).catch(() => {});
    await prisma.warmupProfile.upsert({
      where: { mailboxId: mailbox!.id },
      create: {
        workspaceId: s.wid,
        mailboxId: mailbox!.id,
        isActive: true,
      },
      update: { isActive: true },
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  // -------------------
  // Enqueue jobs
  // -------------------
  if (action === "force_warmup_tick") {
    await prisma.job.create({
      data: {
        type: "warmup_tick",
        payload: JSON.stringify({ workspaceId: s.wid, mailboxId: mailbox!.id, source: "control_center", force: true }),
        runAt: new Date(),
        status: "queued",
      },
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (action === "force_seed_check") {
    await prisma.job
      .create({
        data: { type: "warmup_seed_check", payload: JSON.stringify({ workspaceId: s.wid, source: "control_center" }), runAt: new Date(), status: "queued" },
      })
      .catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (action === "force_mailbox_check") {
    await prisma.job
      .create({
        data: { type: "warmup_mailbox_check", payload: JSON.stringify({ workspaceId: s.wid, source: "control_center" }), runAt: new Date(), status: "queued" },
      })
      .catch(() => {});
    return NextResponse.json({ ok: true });
  }

  // -------------------
  // IMAP test
  // -------------------
  if (action === "test_imap") {
    const configured = Boolean(mailbox!.imapHost && mailbox!.imapUser && mailbox!.imapPassEnc);
    if (!configured) {
      return NextResponse.json({ ok: false, configured: false, error: "IMAP_NOT_CONFIGURED" });
    }

    let ok = false;
    let error: string | null = null;
    let folders: any[] = [];
    let probed: Array<{ path: string; ok: boolean; error?: string }> = [];

    let client: ImapFlow | null = null;
    try {
      client = new ImapFlow({
        host: mailbox!.imapHost!,
        port: mailbox!.imapPort,
        secure: mailbox!.imapSecure,
        auth: { user: mailbox!.imapUser!, pass: decrypt(mailbox!.imapPassEnc!) },
        logger: false,
        tls: { rejectUnauthorized: !mailbox!.imapTlsSkipVerify },
      });
      await client.connect();

      // Basic permission check
      await client.mailboxOpen("INBOX");

      // Folder list (limited)
      try {
        const list = await client.list();
        folders = (list || []).slice(0, 250).map((f: any) => ({
          path: f.path,
          flags: f.flags,
          specialUse: f.specialUse,
          listed: f.listed,
        }));
      } catch {
        folders = [];
      }

      // Probe common Gmail/IMAP special folders even if the server does not list them (eg, not subscribed / hidden).
      const probeCandidates = [
        "[Gmail]/All Mail",
        "[Google Mail]/All Mail",
        "Archive",
        "Archives",
        "INBOX.Archive",
        "INBOX/Archive",
        "[Gmail]/Spam",
        "[Google Mail]/Spam",
        "Spam",
        "Junk",
        "Junk Email",
        "Junk E-mail",
        "INBOX.Spam",
        "INBOX.Junk",
        "INBOX/Spam",
        "INBOX/Junk",
      ];
      for (const p of probeCandidates) {
        try {
          const lock = await client.getMailboxLock(p, { readOnly: true });
          lock.release();
          probed.push({ path: p, ok: true });
        } catch (e: any) {
          probed.push({ path: p, ok: false, error: String(e?.message || e) });
        }
      }

      await client.logout();
      ok = true;
    } catch (e: any) {
      error = String(e?.message || e);
      // Best-effort logout if we connected.
      try {
        if (client) await client.logout();
      } catch {
        // ignore
      }
    }

    return NextResponse.json({ ok, configured: true, error, folders, probed });
  }

  return NextResponse.json({ error: "UNKNOWN_ACTION" }, { status: 400 });
}