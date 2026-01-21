import { prisma } from "@/lib/prisma";

export type SearchItem = {
  type: "campaign" | "lead" | "domain" | "mailbox" | "tenant";
  id: string;
  title: string;
  subtitle?: string | null;
  href: string;
  icon: string;
};

function norm(s: string) {
  return String(s || "").trim().toLowerCase();
}

function clip(s: string, n: number) {
  const t = String(s || "");
  return t.length > n ? t.slice(0, n) + "…" : t;
}

export async function searchWorkspace(opts: { workspaceId: string; q: string; limit?: number }) {
  const workspaceId = opts.workspaceId;
  const q = norm(opts.q);
  const limit = Math.max(1, Math.min(12, Math.floor(opts.limit || 5)));
  if (!q) return { q: "", items: [] as SearchItem[] };

  const [campaigns, leads, domains, mailboxes, tenants] = await Promise.all([
    prisma.campaign.findMany({
      where: { workspaceId, archivedAt: null, name: { contains: q } },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { id: true, name: true, status: true },
    }),
    prisma.lead.findMany({
      where: {
        workspaceId,
        OR: [
          { email: { contains: q } },
          { firstName: { contains: q } },
          { lastName: { contains: q } },
          { company: { contains: q } },
          { website: { contains: q } },
          { tags: { contains: q } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, email: true, firstName: true, lastName: true, company: true },
    }),
    prisma.domain.findMany({
      where: { workspaceId, name: { contains: q } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, name: true },
    }),
    prisma.mailbox.findMany({
      where: {
        workspaceId,
        OR: [{ name: { contains: q } }, { fromEmail: { contains: q } }, { smtpHost: { contains: q } }],
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { id: true, name: true, fromEmail: true },
    }),
    prisma.mailstackTenant.findMany({
      where: {
        workspaceId,
        OR: [{ name: { contains: q } }, { serverIp: { contains: q } }],
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { id: true, name: true, serverIp: true, status: true },
    }),
  ]);

  const items: SearchItem[] = [];

  for (const c of campaigns) {
    items.push({
      type: "campaign",
      id: c.id,
      title: c.name,
      subtitle: c.status,
      href: `/app/campaigns/${c.id}`,
      icon: "📣",
    });
  }

  for (const l of leads) {
    const name = [l.firstName, l.lastName].filter(Boolean).join(" ");
    const sub = [name ? clip(name, 40) : null, l.company ? clip(l.company, 50) : null].filter(Boolean).join(" · ");
    items.push({
      type: "lead",
      id: l.id,
      title: l.email,
      subtitle: sub || null,
      // Leads don't have a detail page yet; link to filtered list.
      href: `/app/leads?prefill=${encodeURIComponent(l.email)}`,
      icon: "👥",
    });
  }

  for (const d of domains) {
    items.push({
      type: "domain",
      id: d.id,
      title: d.name,
      subtitle: null,
      href: `/app/domains/${d.id}`,
      icon: "🌐",
    });
  }

  for (const m of mailboxes) {
    items.push({
      type: "mailbox",
      id: m.id,
      title: m.fromEmail || m.name,
      subtitle: m.fromEmail ? m.name : null,
      href: `/app/mailboxes?prefill=${encodeURIComponent(m.fromEmail || m.name)}`,
      icon: "📮",
    });
  }

  for (const t of tenants) {
    items.push({
      type: "tenant",
      id: t.id,
      title: t.name,
      subtitle: [t.serverIp ? `IP ${t.serverIp}` : null, t.status ? String(t.status) : null].filter(Boolean).join(" · ") || null,
      href: `/app/mailstack/${t.id}`,
      icon: "🛠️",
    });
  }

  return { q, items };
}
