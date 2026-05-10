import { Container, Badge, Button } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import TeamRepliesInbox from "@/components/replies/team-replies-inbox";

export default async function RepliesPage() {
  const s = await requireSession();

  const [mailboxes, campaigns, members] = await Promise.all([
    prisma.mailbox.findMany({
      where: { workspaceId: s.wid },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, fromEmail: true, isActive: true },
    }),
    prisma.campaign.findMany({
      where: { workspaceId: s.wid },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, status: true },
    }),
    prisma.membership.findMany({
      where: { workspaceId: s.wid },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const activeMailboxes = mailboxes.filter((m) => m.isActive).length;
  const runningCampaigns = campaigns.filter((c) => c.status === "running").length;

  return (
    <Container wide className="py-0">
      <div className="relative mb-6 overflow-hidden rounded-[2rem] border border-white/70 bg-white/78 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl">
        <div className="absolute inset-0 bg-[radial-gradient(900px_circle_at_0%_0%,rgba(99,102,241,0.20),transparent_42%),radial-gradient(760px_circle_at_100%_0%,rgba(20,184,166,0.18),transparent_42%),linear-gradient(135deg,rgba(255,255,255,0.95),rgba(248,250,252,0.72))]" />
        <div className="relative p-5 sm:p-7 lg:p-8 flex flex-col lg:flex-row lg:items-end justify-between gap-5">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.18)]" />
              Team inbox
            </div>
            <h1 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight text-slate-950 font-display">Replies</h1>
            <p className="mt-2 text-sm sm:text-base text-slate-600 leading-6">
              A polished shared inbox for lead conversations. Prioritize replies, assign ownership, use AI assistance, and keep follow-ups moving.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Badge>Auto-refresh 25s</Badge>
            <Badge>{activeMailboxes} active mailbox{activeMailboxes === 1 ? "" : "es"}</Badge>
            <Badge>{runningCampaigns} running campaign{runningCampaigns === 1 ? "" : "s"}</Badge>
            <Button variant="ghost" className="bg-white/85">Shortcuts: J/K · R</Button>
          </div>
        </div>
      </div>

      <TeamRepliesInbox
        mailboxes={mailboxes}
        campaigns={campaigns}
        members={members.map((m) => ({
          id: m.user.id,
          name: m.user.name,
          email: m.user.email,
          role: m.role,
        }))}
      />
    </Container>
  );
}
