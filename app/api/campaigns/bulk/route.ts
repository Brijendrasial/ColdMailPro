import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueueJob } from "@/worker/queue";

type Action = "pause" | "run" | "stop" | "read" | "unread" | "archive" | "unarchive" | "duplicate";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({} as any));
  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : [];
  const action: Action = String(body.action || "") as Action;

  if (!ids.length) return NextResponse.json({ ok: false, error: "Missing ids" }, { status: 400 });

  const campaigns = await prisma.campaign.findMany({
    where: { id: { in: ids }, workspaceId: s.wid },
    select: { id: true, status: true, archivedAt: true },
  });
  const foundIds = campaigns.map((c) => c.id);

  if (!foundIds.length) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  if (action === "pause") {
    await prisma.campaign.updateMany({ where: { id: { in: foundIds } }, data: { status: "paused" } });
    return NextResponse.json({ ok: true });
  }

  if (action === "run") {
    await prisma.campaign.updateMany({ where: { id: { in: foundIds } }, data: { status: "running" } });
    // schedule all
    await Promise.all(foundIds.map((id) => enqueueJob("schedule_campaign", { campaignId: id, workspaceId: s.wid }, new Date())));
    return NextResponse.json({ ok: true });
  }

  if (action === "stop") {
    await prisma.campaign.updateMany({ where: { id: { in: foundIds } }, data: { status: "stopped" } });
    return NextResponse.json({ ok: true });
  }

  if (action === "archive") {
    const now = new Date();
    await prisma.campaign.updateMany({
      where: { id: { in: foundIds } },
      data: { archivedAt: now as any, status: "paused" } as any,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "unarchive") {
    await prisma.campaign.updateMany({
      where: { id: { in: foundIds } },
      data: { archivedAt: null } as any,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "duplicate") {
    const src = await prisma.campaign.findMany({
      where: { id: { in: foundIds }, workspaceId: s.wid },
      include: { steps: { orderBy: { stepNumber: "asc" } }, mailboxes: true },
    });

    const copies: Array<{ from: string; to: string }> = [];

    for (const camp of src as any[]) {
      const copy = await prisma.campaign.create({
        data: {
          workspaceId: camp.workspaceId,
          name: `${camp.name} (Copy)`,
          status: "draft",
          timezone: camp.timezone,
          sendingWindow: camp.sendingWindow,
          daysOfWeek: camp.daysOfWeek ?? null,
          dailySendLimit: camp.dailySendLimit,
          rampEnabled: camp.rampEnabled ?? false,
          rampStartLimit: camp.rampStartLimit ?? 20,
          rampDailyIncrease: camp.rampDailyIncrease ?? 20,
          rampMaxLimit: camp.rampMaxLimit ?? camp.dailySendLimit,
          mailboxStrategy: camp.mailboxStrategy,
          stopOnReply: camp.stopOnReply,
          stopOnBounce: camp.stopOnBounce,
          stopOnUnsubscribe: camp.stopOnUnsubscribe ?? true,
          stopOnOOO: camp.stopOnOOO ?? true,
          stopKeywords: camp.stopKeywords ?? null,
          notInterestedKeywords: camp.notInterestedKeywords ?? null,
          oooKeywords: camp.oooKeywords ?? null,
        } as any,
      });

      copies.push({ from: camp.id, to: copy.id });

      if (Array.isArray(camp.steps) && camp.steps.length) {
        await prisma.sequenceStep.createMany({
          data: camp.steps.map((st: any) => ({
            campaignId: copy.id,
            stepNumber: st.stepNumber,
            delayDays: st.delayDays,
            subjectTpl: st.subjectTpl,
            bodyTpl: st.bodyTpl,
            isReply: st.isReply,
          })),
        }).catch(() => {});
      }

      if (Array.isArray(camp.mailboxes) && camp.mailboxes.length) {
        await prisma.campaignMailbox
          .createMany({
            data: camp.mailboxes.map((m: any) => ({
              campaignId: copy.id,
              mailboxId: m.mailboxId,
              isActive: m.isActive,
            })),
            skipDuplicates: true,
          })
          .catch(() => {});
      }
    }

    return NextResponse.json({ ok: true, copies });
  }

  // read/unread not implemented for campaigns (reserved for future "campaign notifications")
  if (action === "read" || action === "unread") {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
