import { Container, Badge } from "@/components/ui";
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

  return (
    <Container wide className="py-0">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="text-2xl font-semibold tracking-tight">Replies</div>
          <div className="text-sm opacity-70 mt-0.5">Shared team inbox (grouped by lead). Pin, snooze, assign, and reply.</div>
        </div>
        <Badge>Auto-refresh (25s)</Badge>
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
