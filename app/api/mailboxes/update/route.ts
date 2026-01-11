import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function isEmailish(x: string) {
  const s = x.trim();
  return s.includes("@") && !s.includes(" ");
}

function clampInt(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

export async function POST(req: NextRequest) {
  let s: any;
  try {
    s = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const id = String(body?.id || "");
  const data = body?.data || {};
  if (!id) return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });

  const mb = await prisma.mailbox.findFirst({ where: { id, workspaceId: s.wid } });
  if (!mb) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const patch: any = {};

  if (typeof data.name === "string") patch.name = data.name.trim().slice(0, 120) || mb.name;
  if (typeof data.fromEmail === "string") {
    const v = data.fromEmail.trim();
    if (!isEmailish(v)) return NextResponse.json({ error: "INVALID_FROM" }, { status: 400 });
    patch.fromEmail = v;
  }

  if ("replyTo" in data) {
    const v = data.replyTo === null ? null : String(data.replyTo || "").trim();
    if (v && !isEmailish(v)) return NextResponse.json({ error: "INVALID_REPLY_TO" }, { status: 400 });
    patch.replyTo = v || null;
  }

  if ("isActive" in data) patch.isActive = !!data.isActive;
  if ("warmupEnabled" in data) patch.warmupEnabled = !!data.warmupEnabled;

  if ("dailyLimit" in data) {
    patch.dailyLimit = clampInt(Number(data.dailyLimit), 1, 100000);
  }

  if ("localAddress" in data) {
    const v = data.localAddress === null ? null : String(data.localAddress || "").trim();
    patch.localAddress = v || null;
  }

  await prisma.mailbox.update({ where: { id }, data: patch });
  return NextResponse.json({ ok: true });
}
