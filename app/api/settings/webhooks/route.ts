import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function makeSecret() {
  return crypto.randomBytes(24).toString("base64url");
}

export async function GET() {
  const s = await requireSession();
  const items = await prisma.webhookEndpoint.findMany({
    where: { workspaceId: s.wid },
    orderBy: { createdAt: "desc" },
    select: { id: true, url: true, events: true, isActive: true, createdAt: true, secret: true },
  });
  return NextResponse.json({ ok: true, webhooks: items });
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({}));
  const url = String(body?.url || "").trim();
  const events = String(body?.events || "sent,open,click,bounce,reply,unsubscribe").trim();
  if (!url) return NextResponse.json({ ok: false, error: "missing_url" }, { status: 400 });

  const wh = await prisma.webhookEndpoint.create({
    data: {
      workspaceId: s.wid,
      url,
      events,
      isActive: true,
      secret: makeSecret(),
    },
    select: { id: true, url: true, events: true, isActive: true, createdAt: true, secret: true },
  });

  return NextResponse.json({ ok: true, webhook: wh });
}
