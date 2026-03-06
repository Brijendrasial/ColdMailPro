import * as crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

export type IncidentSeverity = "info" | "warn" | "error" | "critical";
export type IncidentSource = "worker" | "api" | "exim" | "dovecot" | "system" | "cloudflare" | "dns" | "other";

export function normalizeError(s: string): string {
  const t = String(s || "");
  return t
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "<ip>")
    .replace(/\b\d+\b/g, "<n>")
    .slice(0, 2000);
}

export function makeSignature(parts: string[]): string {
  const h = crypto.createHash("sha1");
  h.update(parts.join("|"));
  return h.digest("hex");
}

export async function upsertOpenIncident(args: {
  workspaceId?: string | null;
  severity: IncidentSeverity;
  source: IncidentSource;
  signatureParts: string[];
  summary: string;
  evidence?: any;
  suggestedFixes?: any;
}): Promise<string> {
  if (!env.AIOPS_ENABLED) return "";
  const signature = makeSignature(args.signatureParts.map((p) => normalizeError(p)));

  const existing = await prisma.incident.findFirst({
    where: {
      status: "open",
      signature,
      workspaceId: args.workspaceId || null,
    },
    select: { id: true, occurrenceCount: true },
  });
  if (existing?.id) {
    const nextCount = Number(existing.occurrenceCount || 1) + 1;
    const escalatedSeverity: IncidentSeverity = nextCount >= 5
      ? "critical"
      : nextCount >= 3 && args.severity !== "critical"
      ? "error"
      : args.severity;
    await prisma.incident.update({
      where: { id: existing.id },
      data: {
        severity: escalatedSeverity,
        source: args.source,
        summary: args.summary,
        evidenceJson: args.evidence ?? undefined,
        suggestedFixesJson: args.suggestedFixes ?? undefined,
        occurrenceCount: { increment: 1 },
        lastSeenAt: new Date(),
        needsHumanReview: nextCount >= 3,
      },
    }).catch(() => {});
    return existing.id;
  }

  const created = await prisma.incident.create({
    data: {
      workspaceId: args.workspaceId || null,
      severity: args.severity,
      source: args.source,
      signature,
      summary: args.summary,
      status: "open",
      evidenceJson: args.evidence ?? undefined,
      suggestedFixesJson: args.suggestedFixes ?? undefined,
      occurrenceCount: 1,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      needsHumanReview: false,
    },
    select: { id: true },
  });
  return created.id;
}
