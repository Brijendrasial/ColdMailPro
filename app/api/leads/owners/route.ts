import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const s = await requireSession();
  const members = await prisma.membership.findMany({
    where: { workspaceId: s.wid },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });

  const owners = members
    .map((m) => m.user)
    .filter(Boolean)
    .map((u) => ({ id: u.id, name: u.name, email: u.email }));

  return NextResponse.json({ ok: true, owners });
}
