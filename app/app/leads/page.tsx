import { Container, Card } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { LeadsClient } from "@/components/leads/leads-client";

export default async function Leads() {
  await requireSession();

  return (
    <Container>
      <div className="grid gap-4">
        <Card title="Leads" subtitle="Search, segment, bulk-edit, save shared views, and manage suppressions/duplicates.">
          <div className="text-xs opacity-70">
            CSV headers supported: <span className="font-mono">email, firstName, lastName, company, website, tags</span>
          </div>
        </Card>

        <LeadsClient />
      </div>
    </Container>
  );
}
