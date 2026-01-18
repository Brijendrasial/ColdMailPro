import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logLeadActivity } from "@/lib/lead-activity";

const Create = z.object({
  title: z.string().min(1).max(200),
  dueAt: z.string().datetime().optional().nullable(),
});

const Update = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  dueAt: z.string().datetime().optional().nullable(),
  completed: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await requireSession();
  const leadId = String(params.id || "");
  const raw = await req.json().catch(() => ({}));
  const parsed = Create.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });

  const lead = await prisma.lead.findFirst({ where: { id: leadId, workspaceId: s.wid }, select: { id: true } });
  if (!lead) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
  const task = await prisma.leadTask.create({
    data: {
      workspaceId: s.wid,
      leadId,
      createdByUserId: s.uid || null,
      title: parsed.data.title,
      dueAt,
    },
    select: { id: true, title: true, dueAt: true, completedAt: true, createdAt: true },
  });

  await logLeadActivity({
    workspaceId: s.wid,
    leadId,
    actorUserId: s.uid || null,
    type: "task_create",
    text: `Task: ${task.title}`,
    meta: { taskId: task.id, dueAt: task.dueAt },
  });

  return NextResponse.json({ ok: true, task });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await requireSession();
  const leadId = String(params.id || "");
  const raw = await req.json().catch(() => ({}));
  const parsed = Update.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });

  const data: any = {};
  if (parsed.data.title !== undefined) data.title = parsed.data.title;
  if (parsed.data.dueAt !== undefined) data.dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
  if (parsed.data.completed !== undefined) data.completedAt = parsed.data.completed ? new Date() : null;

  const updated = await prisma.leadTask.updateMany({
    where: { id: parsed.data.taskId, leadId, workspaceId: s.wid },
    data,
  });

  await logLeadActivity({
    workspaceId: s.wid,
    leadId,
    actorUserId: s.uid || null,
    type: parsed.data.completed ? "task_complete" : "task_update",
    text: parsed.data.completed ? "Task completed" : "Task updated",
    meta: { taskId: parsed.data.taskId, data },
  });

  return NextResponse.json({ ok: true, updated: updated.count });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await requireSession();
  const leadId = String(params.id || "");
  const url = new URL(req.url);
  const taskId = String(url.searchParams.get("taskId") || "");
  if (!taskId) return NextResponse.json({ ok: false, error: "Missing taskId" }, { status: 400 });

  await prisma.leadTask.deleteMany({ where: { id: taskId, leadId, workspaceId: s.wid } });
  await logLeadActivity({ workspaceId: s.wid, leadId, actorUserId: s.uid || null, type: "task_delete", text: "Task deleted", meta: { taskId } });
  return NextResponse.json({ ok: true });
}
