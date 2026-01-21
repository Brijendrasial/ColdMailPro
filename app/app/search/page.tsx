import Link from "next/link";
import { Container, PageHeader, Card, EmptyState } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { searchWorkspace } from "@/lib/search";

export default async function SearchPage({
  searchParams,
}: {
  searchParams?: { q?: string };
}) {
  const s = await requireSession();
  const q = String(searchParams?.q || "").trim();

  const { items } = q ? await searchWorkspace({ workspaceId: s.wid, q, limit: 10 }) : { items: [] };

  const groups = {
    campaign: items.filter((i) => i.type === "campaign"),
    lead: items.filter((i) => i.type === "lead"),
    domain: items.filter((i) => i.type === "domain"),
    mailbox: items.filter((i) => i.type === "mailbox"),
    tenant: items.filter((i) => i.type === "tenant"),
  };

  return (
    <Container>
      <div className="grid gap-4">
        <PageHeader title="Search" subtitle={q ? `Results for “${q}”` : "Type in the search bar above."} />

        {!q ? (
          <EmptyState title="Start typing to search" subtitle="Use the top search bar (or press /) to find campaigns, leads, domains, mailboxes and Mailstack tenants." />
        ) : items.length === 0 ? (
          <EmptyState title="No results" subtitle="Try a different keyword." />
        ) : (
          <div className="grid gap-4">
            {(
              [
                ["campaign", "📣 Campaigns"],
                ["lead", "👥 Leads"],
                ["domain", "🌐 Domains"],
                ["mailbox", "📮 Mailboxes"],
                ["tenant", "🛠️ Mailstack"],
              ] as const
            ).map(([k, label]) => {
              const arr = (groups as any)[k] as any[];
              if (!arr?.length) return null;
              return (
                <Card key={k} title={label}>
                  <div className="grid gap-2">
                    {arr.map((it) => (
                      <Link
                        key={`${it.type}:${it.id}`}
                        href={it.href}
                        className="flex items-center gap-3 p-3 rounded-2xl border border-slate-200 bg-white/70 hover:bg-white transition"
                      >
                        <div className="h-10 w-10 rounded-2xl border border-slate-200 bg-white grid place-items-center">
                          {it.icon}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 truncate">{it.title}</div>
                          {it.subtitle ? <div className="text-xs text-slate-600 truncate">{it.subtitle}</div> : null}
                        </div>
                      </Link>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </Container>
  );
}
