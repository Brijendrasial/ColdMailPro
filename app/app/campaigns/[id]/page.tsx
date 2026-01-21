import Link from "next/link";
import { Container, Card, Badge, Button, PageHeader, SegmentedNav, Kpi } from "@/components/ui";
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
      <PageHeader
        title={campaign.name}
        subtitle="Overview, steps, settings, and performance for this campaign."
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <form action="/api/campaigns/toggle" method="post">
              <input type="hidden" name="id" value={campaign.id} />
              <Button type="submit">{campaign.status === "running" ? "Pause" : "Start"}</Button>
            </form>
            <SegmentedNav
              active="overview"
              items={[
                { value: "overview", label: "Overview", href: `/app/campaigns/${campaign.id}` },
                { value: "mailboxes", label: "Mailboxes", href: `/app/campaigns/${campaign.id}/mailboxes` },
                { value: "settings", label: "Settings", href: `/app/campaigns/${campaign.id}/settings` },
                { value: "funnel", label: "Funnel", href: `/app/campaigns/${campaign.id}/funnel` },
                { value: "deliverability", label: "Deliverability", href: `/app/campaigns/${campaign.id}/deliverability` },
                { value: "analytics", label: "Analytics", href: `/app/campaigns/${campaign.id}/analytics` },
                { value: "steps", label: "Edit steps", href: `/app/campaigns/${campaign.id}/edit` },
                { value: "enroll", label: "Enroll leads", href: `/app/campaigns/${campaign.id}/enroll` },
              ]}
            />
          </div>
        }
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
