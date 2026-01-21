import { prisma } from "@/lib/prisma";

export type AuditInput = {
  workspaceId: string;
  actorUserId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  meta?: any;
};

function cleanShort(s?: string | null, max = 191) {
  if (!s) return null;
  return String(s).slice(0, max);
}

export async function logAudit(input: AuditInput) {
  try {
    await prisma.auditLog.create({
      data: {
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId || null,
        action: cleanShort(input.action)!,
        targetType: cleanShort(input.targetType),
        targetId: cleanShort(input.targetId),
        ip: cleanShort(input.ip),
        userAgent: input.userAgent ? String(input.userAgent).slice(0, 5000) : null,
        meta: input.meta ?? null,
      },
      select: { id: true },
    });
  } catch {
    // audit must never break the app
  }
}
