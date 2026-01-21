import { Container } from "@/components/ui";
import CampaignCreateWizard from "@/components/campaigns/campaign-create-wizard";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function NewCampaign({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const s = await requireSession();

  const resume = typeof searchParams?.resume === "string" ? searchParams?.resume : Array.isArray(searchParams?.resume) ? searchParams?.resume[0] : undefined;

  const mailboxes = await prisma.mailbox.findMany({
    where: { workspaceId: s.wid },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, fromEmail: true, dailyLimit: true, isActive: true },
  });

  const pools = await prisma.mailboxPool.findMany({
    where: { workspaceId: s.wid },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { members: true } } },
  });

  const leads = await prisma.lead.findMany({
    where: {
      workspaceId: s.wid,
      NOT: { status: { in: ["unsubscribed", "suppressed", "bounced"] } },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, firstName: true, lastName: true, company: true, status: true },
    take: 800,
  });

  return (
    <Container>
      <CampaignCreateWizard
        mailboxes={mailboxes as any}
        pools={(pools as any[]).map((p: any) => ({ id: p.id, name: p.name, membersCount: Number(p._count?.members || 0) })) as any}
        leads={leads as any}
        resumeCampaignId={resume || null}
      />
    </Container>
  );
}
