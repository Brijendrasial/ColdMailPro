import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const p: any = prisma as any;
  if (!p?.incident?.findFirst) {
    return NextResponse.json({ ok: false, error: "Incidents not available (run prisma generate)" }, { status: 500 });
  }

  const s = await requireSession();
  const id = String(params?.id || "");
  if (!id) return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });

  const inc = await p.incident.findFirst({ where: { id, workspaceId: s.wid } });
  if (!inc) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  // Enqueue a worker job to apply safe actions
  await prisma.job.create({
    data: {
      type: "aiops_apply_incident",
      payload: JSON.stringify({ incidentId: id, mode: "safe", workspaceId: s.wid }),
      runAt: new Date(),
      status: "queued",
    },
  });

  return NextResponse.json({ ok: true });
}
