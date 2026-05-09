import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const s = await requireSession();

  const memberships = await prisma.membership.findMany({
    where: { userId: s.uid },
    orderBy: { createdAt: "asc" },
    select: {
      role: true,
      createdAt: true,
      workspace: { select: { id: true, name: true, createdAt: true } },
    },
  });

  const workspaces = memberships
    .filter((m) => !!m.workspace)
    .map((m) => ({
      workspaceId: m.workspace.id,
      workspaceName: m.workspace.name,
      role: m.role,
      createdAt: m.workspace.createdAt,
      joinedAt: m.createdAt,
    }));

  return NextResponse.json({ ok: true, currentWorkspaceId: s.wid, workspaces });
}
