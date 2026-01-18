import { prisma } from "@/lib/prisma";

export async function logLeadActivity(args: {
  workspaceId: string;
  leadId: string;
  actorUserId?: string | null;
  type: string;
  text?: string | null;
  meta?: any;
}) {
  try {
    await prisma.leadActivity.create({
      data: {
        workspaceId: args.workspaceId,
        leadId: args.leadId,
        actorUserId: args.actorUserId || null,
        type: args.type,
        text: args.text || null,
        meta: args.meta ?? null,
      },
    });
  } catch {
    // best-effort logging; never break primary flow
  }
}
