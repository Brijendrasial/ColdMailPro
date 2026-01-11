import { Container, PageHeader, Pill } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import AnalyticsClient from "@/components/analytics/analytics-client";

export default async function AnalyticsPage() {
  await requireSession();

  return (
    <Container wide>
      <PageHeader
        title="Analytics"
        subtitle="Track sending performance, replies, deliverability signals and trends. Use filters to drill down by campaign/mailbox."
        right={<Pill tone="info">Live</Pill>}
      />
      <div className="mt-6">
        <AnalyticsClient />
      </div>
    </Container>
  );
}
