import { Container } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { LeadsClient } from "@/components/leads/leads-client";

export default async function Leads() {
  await requireSession();

  return (
    <Container wide className="max-w-[1600px]">
      <LeadsClient />
    </Container>
  );
}
