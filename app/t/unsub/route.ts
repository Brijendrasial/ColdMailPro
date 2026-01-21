import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { maybeAutoPauseCampaign } from "@/lib/deliverability";

/**
 * Unsubscribe endpoint used in outbound emails:
 * /t/unsub?mb=<mailboxId>&email=<recipient_email>&m=<messageId>
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const email = (url.searchParams.get("email") || "").toLowerCase().trim();
  const mb = url.searchParams.get("mb") || "";
  const messageId = url.searchParams.get("m") || "";

  // If a message id is present, create an unsubscribe event for analytics + guardrails.
  if (messageId) {
    const msg = await prisma.message.findUnique({ where: { id: messageId } }).catch(() => null);
    if (msg) {
      await prisma.event.create({ data: { messageId: msg.id, type: "unsubscribe" } }).catch(() => {});
      await prisma.message.update({ where: { id: msg.id }, data: { status: "unsubscribed" } }).catch(() => {});
      await maybeAutoPauseCampaign(msg.campaignId).catch(() => {});

      // If campaign rule is enabled, stop the enrollment too
      const camp: any = await prisma.campaign.findUnique({ where: { id: msg.campaignId } }).catch(() => null);
      if (camp && Boolean(camp.stopOnUnsubscribe ?? true)) {
        await prisma.enrollment.updateMany({ where: { campaignId: msg.campaignId, leadId: msg.leadId, status: { in: ["queued", "active"] } }, data: { status: "stopped", stopReason: "unsubscribe" } }).catch(() => {});
      }
    }
  }

  if (email && mb) {
    const mailbox = await prisma.mailbox.findUnique({ where: { id: mb } }).catch(() => null);
    if (mailbox) {
      await prisma.suppression.upsert({
        where: { workspaceId_email: { workspaceId: mailbox.workspaceId, email } },
        update: { reason: "unsubscribe" },
        create: { workspaceId: mailbox.workspaceId, email, reason: "unsubscribe" },
      }).catch(() => {});
      await prisma.lead.updateMany({
        where: { workspaceId: mailbox.workspaceId, email },
        data: { status: "unsubscribed" },
      }).catch(() => {});

      const lead = await prisma.lead.findUnique({ where: { workspaceId_email: { workspaceId: mailbox.workspaceId, email } } }).catch(() => null);
      if (lead) {
        // Stop enrollments only if campaign stop rule says so (default ON)
        const cids = await prisma.enrollment.findMany({ where: { leadId: lead.id, status: { in: ["queued", "active"] } }, select: { id: true, campaignId: true } }).catch(() => []);
        for (const e of cids as any[]) {
          const camp: any = await prisma.campaign.findUnique({ where: { id: e.campaignId } }).catch(() => null);
          if (camp && Boolean(camp.stopOnUnsubscribe ?? true)) {
            await prisma.enrollment.update({ where: { id: e.id }, data: { status: "stopped", stopReason: "unsubscribe" } }).catch(() => {});
          }
        }
      }

    }
  }

  const body = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed</title></head>
<body style="font-family:system-ui;padding:40px;max-width:720px;margin:auto">
  <h2>You're unsubscribed</h2>
  <p>${email ? `${email} has been unsubscribed.` : "You have been unsubscribed."}</p>
</body></html>`;

  return new NextResponse(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}
