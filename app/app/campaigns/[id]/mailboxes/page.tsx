import Link from "next/link";
import { Container, Card, Button, PageHeader, SegmentedNav, Pill } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { getCampaignMailboxDashboard } from "@/lib/campaign-mailboxes-dashboard";
import { MailboxesDashboardClient } from "@/components/campaigns/mailboxes-dashboard-client";

export default async function CampaignMailboxesPage({ params }: { params: { id: string } }) {
  const s = await requireSession();
  const id = params.id;

  const data = await getCampaignMailboxDashboard(s.wid, id);
  if (!data) {
    return (
      <Container>
        <Card title="Not found">Campaign not found.</Card>
      </Container>
    );
  }

  return (
    <Container wide>
      <PageHeader
        title={`Mailboxes · ${data.campaign.name}`}
        subtitle="Visual sender health + load for this campaign. Quickly see which mailboxes are safest to route next."
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/app/campaigns/${data.campaign.id}`}><Button variant="ghost">Back</Button></Link>
            <Link href={`/app/campaigns/${data.campaign.id}/settings`}><Button variant="ghost">Settings</Button></Link>
            <Link href={`/app/campaigns/${data.campaign.id}/deliverability`}><Button>Deliverability</Button></Link>
          </div>
        }
      />

      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Pill tone={data.campaign.status === "running" ? "success" : data.campaign.status === "paused" ? "warning" : "neutral"}>{data.campaign.status}</Pill>
          <Pill tone="info">strategy: {data.campaign.mailboxStrategy}</Pill>
          {data.campaign.mailboxStrategy === "score_idle" ? <Pill tone="neutral">min idle: {data.campaign.mailboxMinIdleMinutes}m</Pill> : null}
          <Pill tone="neutral">senders: {data.campaign.senderMode}{data.campaign.mailboxPoolName ? ` (${data.campaign.mailboxPoolName})` : ""}</Pill>
        </div>

        <SegmentedNav
          active="mailboxes"
          items={[
            { value: "overview", label: "Overview", href: `/app/campaigns/${data.campaign.id}` },
            { value: "mailboxes", label: "Mailboxes", href: `/app/campaigns/${data.campaign.id}/mailboxes` },
            { value: "settings", label: "Settings", href: `/app/campaigns/${data.campaign.id}/settings` },
            { value: "deliverability", label: "Deliverability", href: `/app/campaigns/${data.campaign.id}/deliverability` },
            { value: "analytics", label: "Analytics", href: `/app/campaigns/${data.campaign.id}/analytics` },
          ]}
          className="shrink-0"
        />
      </div>

      <div className="mt-4">
        <Card title="Campaign mailbox dashboard" subtitle="Health score is a heuristic (bounces/unsubs/failures + cooldown penalty). Use it to make routing explainable and safe.">
          {/* Client component for refresh + clear cooldown actions */}
          <MailboxesDashboardClient initial={data as any} />
        </Card>
      </div>
    </Container>
  );
}
