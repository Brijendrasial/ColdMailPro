import { Container, PageHeader, Pill } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import AnalyticsClient from "@/components/analytics/analytics-client";

function pickStr(v: string | string[] | undefined) {
  return typeof v === "string" ? v : "";
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireSession();

  const tab = pickStr(searchParams?.tab);
  const range = pickStr(searchParams?.range);
  const from = pickStr(searchParams?.from);
  const to = pickStr(searchParams?.to);
  const campaignId = pickStr(searchParams?.campaignId);
  const mailboxId = pickStr(searchParams?.mailboxId);
  const bounceType = pickStr(searchParams?.bounceType);

  return (
    <Container wide>
      <PageHeader
        title="Analytics"
        subtitle="Track sending performance, replies, deliverability signals and trends. Use filters to drill down by campaign/mailbox."
        right={<Pill tone="info">Live</Pill>}
      />
      <div className="mt-6">
        <AnalyticsClient
          initial={{
            tab,
            range,
            from,
            to,
            campaignId,
            mailboxId,
            bounceType,
          }}
        />
      </div>
    </Container>
  );
}
