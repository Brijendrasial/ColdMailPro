import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const now = Date.now();
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const since2d = new Date(now - 2 * 24 * 60 * 60 * 1000);

  const [mailboxes, lastOutbound, lastInbound, placementByMailbox] = await Promise.all([
    prisma.mailbox.findMany({
      where: { workspaceId: s.wid },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        fromEmail: true,
        isActive: true,
        warmupEnabled: true,
        imapHost: true,
        imapUser: true,
        imapPassEnc: true,
        updatedAt: true,
        warmupProfile: {
          select: {
            isActive: true,
            mode: true,
            startPerDay: true,
            increasePerDay: true,
            maxPerDay: true,
            timezone: true,
            windowStartMin: true,
            windowEndMin: true,
            weekdaysOnly: true,
            updatedAt: true,
          },
        },
      },
    }).catch(() => [] as any[]),
    prisma.warmupMessage.groupBy({
      by: ["mailboxId"],
      where: { workspaceId: s.wid, direction: "outbound", sentAt: { not: null } },
      _max: { sentAt: true },
    }).catch(() => [] as any[]),
    prisma.warmupMessage.groupBy({
      by: ["mailboxId"],
      where: { workspaceId: s.wid, direction: "inbound", receivedAt: { not: null } },
      _max: { receivedAt: true },
    }).catch(() => [] as any[]),
    prisma.warmupMessage.groupBy({
      by: ["mailboxId", "placement"],
      where: { workspaceId: s.wid, receivedAt: { gte: since7d } },
      _count: { _all: true },
    }).catch(() => [] as any[]),
  ]);

  const mailboxIds = (mailboxes as any[]).map((m) => m.id);
  const recentWarmupLogs = mailboxIds.length
    ? await prisma.appLog
        .findMany({
          where: {
            workspaceId: s.wid,
            category: "warmup",
            event: { in: ["mailbox_check_done", "mailbox_check_failed", "mailbox_check_folders"] },
            entityId: { in: mailboxIds },
            createdAt: { gte: since2d },
          },
          orderBy: { createdAt: "desc" },
          take: 5000,
          select: { entityId: true, event: true, level: true, createdAt: true, message: true, data: true },
        })
        .catch(() => [] as any[])
    : ([] as any[]);

  const lastCheckByMailbox = new Map<string, any>();
  const lastFoldersByMailbox = new Map<string, any>();
  for (const l of recentWarmupLogs as any[]) {
    const mid = String(l.entityId || "");
    if (!mid) continue;
    if (l.event === "mailbox_check_folders" && !lastFoldersByMailbox.has(mid)) lastFoldersByMailbox.set(mid, l);
    if ((l.event === "mailbox_check_done" || l.event === "mailbox_check_failed") && !lastCheckByMailbox.has(mid)) lastCheckByMailbox.set(mid, l);
  }

  const lastOutMap = new Map<string, any>();
  for (const r of lastOutbound as any[]) lastOutMap.set(r.mailboxId, r._max.sentAt);
  const lastInMap = new Map<string, any>();
  for (const r of lastInbound as any[]) lastInMap.set(r.mailboxId, r._max.receivedAt);

  const placeMap = new Map<string, { inbox: number; spam: number; unknown: number }>();
  for (const r of placementByMailbox as any[]) {
    const cur = placeMap.get(r.mailboxId) || { inbox: 0, spam: 0, unknown: 0 };
    const k = r.placement === "inbox" ? "inbox" : r.placement === "spam" ? "spam" : "unknown";
    cur[k] += r._count._all;
    placeMap.set(r.mailboxId, cur);
  }

  const rows = (mailboxes as any[]).map((mb) => {
    const hasImap = Boolean(mb.imapHost && mb.imapUser && mb.imapPassEnc);
    const p = placeMap.get(mb.id) || { inbox: 0, spam: 0, unknown: 0 };

    const lastCheck = lastCheckByMailbox.get(mb.id) || null;
    const lastFolders = lastFoldersByMailbox.get(mb.id) || null;

    let unknownReason: string | null = null;
    if (!mb.isActive) unknownReason = "Mailbox is inactive";
    else if (!mb.warmupEnabled) unknownReason = "Warmup is paused";
    else if (!hasImap) unknownReason = "IMAP is not configured (placement/star requires IMAP)";
    else if ((p.unknown || 0) > 0) {
      if (!lastCheck) {
        unknownReason = "No recent placement check found (worker may be down or APPLOG_DB disabled)";
      } else if (lastCheck.event === "mailbox_check_failed") {
        const err = String((lastCheck.data as any)?.error || lastCheck.message || "failed");
        unknownReason = `Last placement check failed: ${err.slice(0, 160)}`;
      } else if (lastCheck.event === "mailbox_check_done") {
        const foundTotal = Number((lastCheck.data as any)?.foundTotal ?? NaN);
        const updatedTotal = Number((lastCheck.data as any)?.updatedTotal ?? NaN);
        if (Number.isFinite(foundTotal) && foundTotal === 0) {
          const folders = (lastFolders?.data as any)?.folders;
          unknownReason = `Placement check ran but found 0 warmup messages in scanned folders${Array.isArray(folders) ? ` (${folders.join(", ")})` : ""}`;
        } else if (Number.isFinite(foundTotal) && foundTotal > 0 && Number.isFinite(updatedTotal) && updatedTotal === 0) {
          unknownReason = "Warmup messages were found, but none matched DB ids (warmup header/id mismatch)";
        } else {
          unknownReason = "Some messages are still unknown (often older than scan window or stored outside scanned folders)";
        }
      }
    }
    return {
      id: mb.id,
      name: mb.name,
      fromEmail: mb.fromEmail,
      isActive: mb.isActive,
      warmupEnabled: mb.warmupEnabled,
      hasImap,
      profile: mb.warmupProfile || null,
      lastOutboundAt: lastOutMap.get(mb.id) || null,
      lastInboundAt: lastInMap.get(mb.id) || null,
      placement7d: p,
      lastPlacementCheckAt: lastCheck?.createdAt || null,
      lastPlacementCheckStatus: lastCheck?.event === "mailbox_check_failed" ? "failed" : lastCheck?.event === "mailbox_check_done" ? "done" : null,
      unknownReason,
      updatedAt: mb.updatedAt,
    };
  });

  return NextResponse.json({ ok: true, mailboxes: rows });
}
