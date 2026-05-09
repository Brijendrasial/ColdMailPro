import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parse } from "csv-parse/sync";
import { env } from "@/lib/env";
import { PingEmail } from "ping-email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


function norm(s: any) {
  const v = String(s ?? "").trim();
  return v.length ? v : null;
}

function normEmail(s: any) {
  const v = String(s ?? "").toLowerCase().trim();
  return v.length ? v : null;
}

function mergeTags(existing: string | null | undefined, add: string | null) {
  const set = new Set<string>();
  for (const t of String(existing || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)) {
    set.add(t);
  }
  for (const t of String(add || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)) {
    set.add(t);
  }
  return Array.from(set).join(",") || null;
}

// Multipart form-data:
// - file: CSV (required)
// - upsert: "1" to update existing leads
// - batchTag: optional tag applied to every imported row
// - verify: "1" to verify emails before importing
// - verifyMode: "smtp" (default) | "no_smtp" (safe mode)
// - requireMailbox: "1" to require explicit mailbox confirmation (SMTP only)
// - onInvalid: "skip" (default) | "fail"
// - senderMailboxId: optional workspace mailbox id to use as SMTP sender
export async function POST(req: NextRequest) {
  const s = await requireSession();
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

  const upsert = String(form.get("upsert") || "") === "1";
  const batchTag = String(form.get("batchTag") || "").trim();

  const verify = String(form.get("verify") || "") === "1";
  const verifyModeRaw = String(form.get("verifyMode") || "smtp").trim();
  const verifyMode: "smtp" | "no_smtp" = verifyModeRaw === "no_smtp" ? "no_smtp" : "smtp";
  const requireMailbox = String(form.get("requireMailbox") || "") === "1";
  const onInvalid = String(form.get("onInvalid") || "skip").trim() === "fail" ? "fail" : "skip";
  const senderMailboxId = String(form.get("senderMailboxId") || "").trim() || null;

  const text = await file.text();
  const records: any[] = parse(text, { columns: true, skip_empty_lines: true, trim: true });

  // Preload suppressions for faster checks during import.
  const emailList: string[] = [];
  const emailSeen = new Set<string>();
  for (const r of records) {
    const e = normEmail(r.email || r.Email);
    if (!e) continue;
    if (emailSeen.has(e)) continue;
    emailSeen.add(e);
    emailList.push(e);
  }
  const suppressedRows = emailList.length
    ? await prisma.suppression.findMany({ where: { workspaceId: s.wid, email: { in: emailList } }, select: { email: true, reason: true } })
    : [];
  const suppressedMap = new Map(suppressedRows.map((x) => [String(x.email).toLowerCase(), String(x.reason || "")]));

  // Email verification setup (optional)
  let pingEmail: any = null;
  if (verify) {
    if (!env.PING_EMAIL_ENABLED) {
      return NextResponse.json(
        { ok: false, error: "Email verification is not enabled on the server (PING_EMAIL_ENABLED=1)." },
        { status: 400 }
      );
    }
    if (!env.PING_EMAIL_FQDN) {
      return NextResponse.json({ ok: false, error: "PING_EMAIL_FQDN is required for verification." }, { status: 400 });
    }
    if (requireMailbox && verifyMode === "no_smtp") {
      return NextResponse.json(
        { ok: false, error: "Mailbox verification requires SMTP mode", message: "Switch verification mode to Full (MX + SMTP)." },
        { status: 400 }
      );
    }

    // sender selection
    let sender = env.PING_EMAIL_SENDER || undefined;
    if (senderMailboxId) {
      const mb = await prisma.mailbox.findFirst({ where: { id: senderMailboxId, workspaceId: s.wid }, select: { fromEmail: true } });
      if (mb?.fromEmail) sender = mb.fromEmail;
    }
    if (!sender) {
      return NextResponse.json(
        { ok: false, error: "PING_EMAIL_SENDER (or a senderMailboxId) is required for verification." },
        { status: 400 }
      );
    }

    const ignoreSMTPVerify = verifyMode === "no_smtp";
    pingEmail = new PingEmail({
      port: env.PING_EMAIL_PORT,
      fqdn: env.PING_EMAIL_FQDN,
      sender,
      timeout: env.PING_EMAIL_TIMEOUT_MS,
      attempts: env.PING_EMAIL_ATTEMPTS,
      ignoreSMTPVerify,
      debug: env.PING_EMAIL_DEBUG,
    } as any);
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let invalid = 0;

  let verified = 0;
  const invalidRows: Array<{ row: number; email: string; message: string }> = [];

  for (let i = 0; i < records.length; i++) {
    const r: any = records[i];
    const rowNo = i + 2; // header is row 1
    const email = normEmail(r.email || r.Email);
    if (!email) {
      invalid++;
      invalidRows.push({ row: rowNo, email: "", message: "Missing email" });
      if (onInvalid === "fail") {
        return NextResponse.json({ ok: false, error: "Invalid rows in CSV", inserted, updated, skipped, invalid, verified, invalidRows }, { status: 422 });
      }
      continue;
    }

    // Block suppressed emails from import (global DNC list)
    const supReason = suppressedMap.get(email);
    if (supReason) {
      invalid++;
      invalidRows.push({ row: rowNo, email, message: `Suppressed (DNC) - ${supReason}` });
      if (onInvalid === "fail") {
        return NextResponse.json({ ok: false, error: "Suppressed emails found", inserted, updated, skipped, invalid, verified, invalidRows }, { status: 422 });
      }
      continue;
    }

    // Optional ping-email verification
    if (pingEmail) {
      try {
        const res = await pingEmail.ping(email);
        const valid = !!res?.valid;
        const msg = String(res?.message || "").trim() || (valid ? "OK" : "Invalid email");

        if (!valid) {
          invalid++;
          invalidRows.push({ row: rowNo, email, message: msg });
          if (onInvalid === "fail") {
            return NextResponse.json({ ok: false, error: "Email verification failed", inserted, updated, skipped, invalid, verified, invalidRows }, { status: 422 });
          }
          continue;
        }

        // Require explicit mailbox confirmation if requested
        const mailboxConfirmed = msg === "Valid email";
        if (requireMailbox && !mailboxConfirmed) {
          invalid++;
          invalidRows.push({ row: rowNo, email, message: msg || "Mailbox could not be confirmed" });
          if (onInvalid === "fail") {
            return NextResponse.json({ ok: false, error: "Mailbox not confirmed", inserted, updated, skipped, invalid, verified, invalidRows }, { status: 422 });
          }
          continue;
        }

        verified++;
      } catch (e: any) {
        invalid++;
        invalidRows.push({ row: rowNo, email, message: String(e?.message || e || "Verification error") });
        if (onInvalid === "fail") {
          return NextResponse.json({ ok: false, error: "Verification error", inserted, updated, skipped, invalid, verified, invalidRows }, { status: 502 });
        }
        continue;
      }
    }

    const firstName = norm(r.firstName || r.FirstName || r.firstname);
    const lastName = norm(r.lastName || r.LastName || r.lastname);
    const company = norm(r.company || r.Company);
    const website = norm(r.website || r.Website);
    const rowTags = norm(r.tags || r.Tags);
    const finalTags = mergeTags(rowTags, batchTag || null);

    if (upsert) {
      // Update existing lead or create new
      const existing = await prisma.lead.findUnique({ where: { workspaceId_email: { workspaceId: s.wid, email } }, select: { id: true, tags: true } });
      if (existing) {
        await prisma.lead.update({
          where: { id: existing.id },
          data: {
            firstName: firstName ?? undefined,
            lastName: lastName ?? undefined,
            company: company ?? undefined,
            website: website ?? undefined,
            tags: mergeTags(existing.tags, finalTags),
          },
        });
        updated++;
      } else {
        await prisma.lead.create({
          data: {
            workspaceId: s.wid,
            email,
            firstName,
            lastName,
            company,
            website,
            tags: finalTags,
            status: "active",
          },
        });
        inserted++;
      }
      continue;
    }

    try {
      await prisma.lead.create({
        data: {
          workspaceId: s.wid,
          email,
          firstName,
          lastName,
          company,
          website,
          tags: finalTags,
          status: "active",
        },
      });
      inserted++;
    } catch {
      skipped++;
    }
  }

  return NextResponse.json({ ok: true, inserted, updated, skipped, invalid, verified, invalidRows: invalidRows.slice(0, 200) });
}
