import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function makeSecret() {
  return crypto.randomBytes(24).toString("base64url");
}

export async function PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  const s = await requireSession();
  const id = String(ctx?.params?.id || "");
  const body = await req.json().catch(() => ({}));

  const data: any = {};
  if (typeof body.url === "string") data.url = body.url.trim();
  if (typeof body.events === "string") data.events = body.events.trim();
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;
  if (body.rotateSecret) data.secret = makeSecret();

  const wh = await prisma.webhookEndpoint.updateMany({
    where: { id, workspaceId: s.wid },
    data,
  });

  return NextResponse.json({ ok: true, updated: wh.count });
}

export async function DELETE(_: NextRequest, ctx: { params: { id: string } }) {
  const s = await requireSession();
  const id = String(ctx?.params?.id || "");
  const del = await prisma.webhookEndpoint.deleteMany({
    where: { id, workspaceId: s.wid },
  });
  return NextResponse.json({ ok: true, deleted: del.count });
}
