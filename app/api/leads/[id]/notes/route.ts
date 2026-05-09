import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logLeadActivity } from "@/lib/lead-activity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Create = z.object({ kind: z.enum(["note", "call", "meeting"]).optional().default("note"), body: z.string().min(1) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await requireSession();
  const leadId = String(params.id || "");
  const raw = await req.json().catch(() => ({}));
  const parsed = Create.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });

  const lead = await prisma.lead.findFirst({ where: { id: leadId, workspaceId: s.wid }, select: { id: true } });
  if (!lead) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const note = await prisma.leadNote.create({
    data: {
      workspaceId: s.wid,
      leadId,
      authorUserId: s.uid || null,
      kind: parsed.data.kind,
      body: parsed.data.body,
    },
    select: { id: true, kind: true, body: true, createdAt: true, authorUserId: true },
  });

  await logLeadActivity({
    workspaceId: s.wid,
    leadId,
    actorUserId: s.uid || null,
    type: "note",
    text: `${parsed.data.kind}: ${parsed.data.body}`.slice(0, 5000),
    meta: { kind: parsed.data.kind, noteId: note.id },
  });

  return NextResponse.json({ ok: true, note });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await requireSession();
  const leadId = String(params.id || "");
  const url = new URL(req.url);
  const noteId = String(url.searchParams.get("noteId") || "");
  if (!noteId) return NextResponse.json({ ok: false, error: "Missing noteId" }, { status: 400 });

  await prisma.leadNote.deleteMany({ where: { id: noteId, leadId, workspaceId: s.wid } });
  await logLeadActivity({ workspaceId: s.wid, leadId, actorUserId: s.uid || null, type: "note_delete", text: "Note deleted", meta: { noteId } });
  return NextResponse.json({ ok: true });
}
