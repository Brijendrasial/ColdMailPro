import { Container, Card, Button } from "@/components/ui";
import { CampaignInnerHero } from "@/components/campaigns/campaign-inner-shell";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function Enroll({ params }: { params: { id: string } }) {
  const s = await requireSession();
  const camp = await prisma.campaign.findFirst({ where: { id: params.id, workspaceId: s.wid } });
  if (!camp) return <Container><Card title="Not found">Campaign not found.</Card></Container>;

  // Show enrollable leads (align with Leads tab behavior).
  // - Exclude obvious non-enrollable statuses.
  // - Exclude leads already enrolled in this campaign.
  const leads = await prisma.lead.findMany({
    where: {
      workspaceId: s.wid,
      NOT: { status: { in: ["unsubscribed", "suppressed", "bounced"] } },
      enrollments: { none: { campaignId: camp.id } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <Container>
      <CampaignInnerHero
        campaignId={camp.id}
        campaignName={camp.name}
        status={camp.status}
        active="enroll"
        title="Enroll leads"
        subtitle="Pick eligible leads and push them into the campaign without leaving the campaign workspace."
        primaryHref="/app/leads"
        primaryLabel="Open leads"
      />
      <div className="grid gap-4 max-w-5xl mx-auto">
        <Card title={`Enroll leads: ${camp.name}`}>
          <form action="/api/campaigns/enroll" method="post" className="grid gap-3">
            <input type="hidden" name="campaignId" value={camp.id} />
            <div className="text-sm opacity-80">
              Select leads to enroll (latest 200 shown). Already-enrolled leads are hidden.
            </div>
            <div className="max-h-[420px] overflow-auto rounded-xl border border-black/10 dark:border-white/10 p-3 grid gap-2">
              {leads.map((l) => (
                <label key={l.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="leadIds" value={l.id} />
                  <span className="opacity-90">{l.email}</span>
                  <span className="opacity-60">{l.firstName || ""} {l.lastName || ""}</span>
                </label>
              ))}
              {leads.length === 0 ? (
                <div className="text-sm opacity-70">
                  No enrollable leads found. Import leads, or check that they aren’t already enrolled / unsubscribed / suppressed.
                </div>
              ) : null}
            </div>
            <Button type="submit">Enroll selected</Button>
          </form>
        </Card>
      </div>
    </Container>
  );
}
