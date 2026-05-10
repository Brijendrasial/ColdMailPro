import Link from "next/link";
import { Container, Card, Button, Kpi } from "@/components/ui";
import { CampaignInnerHero } from "@/components/campaigns/campaign-inner-shell";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function CampaignDetail({ params }: { params: { id: string } }) {
  const s = await requireSession();
  const id = params.id;

  const campaign = await prisma.campaign.findFirst({
    where: { id, workspaceId: s.wid },
    include: { steps: { orderBy: { stepNumber: "asc" } } },
  });
  if (!campaign) {
    return (
      <Container>
        <Card title="Not found">Campaign not found.</Card>
      </Container>
    );
  }

  const enrollCount = await prisma.enrollment.count({ where: { campaignId: id } });

  return (
    <Container>
      <CampaignInnerHero
        campaignId={campaign.id}
        campaignName={campaign.name}
        status={campaign.status}
        active="overview"
        title={campaign.name}
        subtitle="A beautiful command view for sequence, routing, pacing, and campaign health."
        primaryHref={`/app/campaigns/${campaign.id}/analytics`}
        primaryLabel="View analytics"
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4 mb-4">
        <Kpi label="Status" value={campaign.status} tone={campaign.status === "running" ? "success" : campaign.status === "paused" ? "warning" : "neutral"} />
        <Kpi label="Enrolled" value={enrollCount} />
        <Kpi label="Strategy" value={campaign.mailboxStrategy} />
        <Kpi label="Daily cap" value={campaign.dailySendLimit} />
        <Kpi label="Timezone" value={campaign.timezone} />
        <Kpi label="Window" value={campaign.sendingWindow} />
      </div>

      <div className="grid gap-4">
        <Card title="Sequence">
          <div className="grid gap-3">
            {campaign.steps.map((s) => (
              <div key={s.id} className="rounded-xl border border-black/10 dark:border-white/10 p-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="font-semibold">
                    Step {s.stepNumber} {s.isReply ? "(reply)" : ""}
                  </div>
                  <div className="text-sm opacity-70">Delay: {s.delayDays} day(s)</div>
                </div>
                <div className="mt-2 text-sm opacity-80">
                  <div><span className="opacity-70">Subject:</span> {s.subjectTpl}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Container>
  );
}
