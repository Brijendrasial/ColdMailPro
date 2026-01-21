import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function asTriBool(v: any): boolean | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "1" || v === 1) return true;
  if (v === "false" || v === "0" || v === 0) return false;
  return undefined;
}

export async function POST(req: Request) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const mailboxIdsRaw = Array.isArray(body.mailboxIds) ? body.mailboxIds : [];
  const mailboxIds = Array.from(new Set(mailboxIdsRaw.map((x: any) => String(x || "").trim()).filter(Boolean)));
  if (!mailboxIds.length) return NextResponse.json({ error: "mailboxIds required" }, { status: 400 });
  if (mailboxIds.length > 200) return NextResponse.json({ error: "Too many mailboxes (max 200)" }, { status: 400 });

  // Validate mailbox ownership
  const mbs = await prisma.mailbox.findMany({ where: { id: { in: mailboxIds }, workspaceId: s.wid }, select: { id: true } });
  const owned = new Set(mbs.map((m) => m.id));
  const missing = mailboxIds.filter((id) => !owned.has(id));
  if (missing.length) return NextResponse.json({ error: "MAILBOX_NOT_FOUND", missing }, { status: 404 });

  const warmupEnabled = asTriBool(body.warmupEnabled);

  const copyFromMailboxId = String(body.copyFromMailboxId || "").trim();
  let copyProfile: any = null;
  if (copyFromMailboxId) {
    const srcMb = await prisma.mailbox.findFirst({ where: { id: copyFromMailboxId, workspaceId: s.wid }, select: { id: true } });
    if (!srcMb) return NextResponse.json({ error: "COPY_SOURCE_NOT_FOUND" }, { status: 404 });
    copyProfile = await prisma.warmupProfile.findFirst({ where: { mailboxId: copyFromMailboxId, workspaceId: s.wid } });
    if (!copyProfile) return NextResponse.json({ error: "COPY_SOURCE_PROFILE_NOT_FOUND" }, { status: 404 });
  }

  const p = body.profilePatch || {};
  const mode = p.mode === "internal" || p.mode === "seeds" || p.mode === "hybrid" ? p.mode : undefined;

  const patch: any = {
    mode,
    startPerDay: p.startPerDay === undefined || p.startPerDay === "" ? undefined : Number(p.startPerDay),
    increasePerDay: p.increasePerDay === undefined || p.increasePerDay === "" ? undefined : Number(p.increasePerDay),
    maxPerDay: p.maxPerDay === undefined || p.maxPerDay === "" ? undefined : Number(p.maxPerDay),
    timezone: p.timezone === undefined || p.timezone === "" ? undefined : String(p.timezone),
    windowStartMin: p.windowStartMin === undefined || p.windowStartMin === "" ? undefined : Number(p.windowStartMin),
    windowEndMin: p.windowEndMin === undefined || p.windowEndMin === "" ? undefined : Number(p.windowEndMin),
    weekdaysOnly: asTriBool(p.weekdaysOnly),
    isActive: asTriBool(p.isActive),
  };

  const shouldTouchProfile = Boolean(copyProfile) || Object.values(patch).some((v) => v !== undefined);

  try {
    await prisma.$transaction(async (tx) => {
      if (warmupEnabled !== undefined) {
        await tx.mailbox.updateMany({ where: { id: { in: mailboxIds }, workspaceId: s.wid }, data: { warmupEnabled } });
      }

      if (!shouldTouchProfile) return;

      const existing = await tx.warmupProfile.findMany({ where: { mailboxId: { in: mailboxIds }, workspaceId: s.wid } });
      const byMailbox = new Map(existing.map((x) => [x.mailboxId, x]));

      await Promise.all(
        mailboxIds.map(async (mailboxId) => {
          const cur = byMailbox.get(mailboxId);
          const base = copyProfile || cur;

          const data: any = {
            workspaceId: s.wid,
            mailboxId,
            mode: patch.mode ?? base?.mode ?? "hybrid",
            startPerDay: patch.startPerDay ?? base?.startPerDay ?? 2,
            increasePerDay: patch.increasePerDay ?? base?.increasePerDay ?? 1,
            maxPerDay: patch.maxPerDay ?? base?.maxPerDay ?? 10,
            timezone: patch.timezone ?? base?.timezone ?? "UTC",
            windowStartMin: patch.windowStartMin ?? base?.windowStartMin ?? 540,
            windowEndMin: patch.windowEndMin ?? base?.windowEndMin ?? 1020,
            weekdaysOnly: patch.weekdaysOnly ?? base?.weekdaysOnly ?? true,
            isActive: patch.isActive ?? base?.isActive ?? true,
          };

          await tx.warmupProfile.upsert({
            where: { mailboxId },
            create: data,
            update: data,
          });
        })
      );
    });

    return NextResponse.json({ ok: true, updated: mailboxIds.length });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
