import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function randomToken() {
  // URL-safe, readable token. Prefix helps identify keys in logs.
  const raw = crypto.randomBytes(32).toString("base64url");
  return `cm_${raw}`;
}

export async function POST(req: NextRequest) {
  const s = await requireSession();

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const name = String(body?.name || "API key").trim();
  if (!name || name.length < 2) {
    return NextResponse.json({ ok: false, error: "Key name is required" }, { status: 400 });
  }
  if (name.length > 80) {
    return NextResponse.json({ ok: false, error: "Key name is too long" }, { status: 400 });
  }

  // Generate a key and store only a hash. Retry on the (very unlikely) chance of collision.
  let created: { id: string; name: string; createdAt: Date } | null = null;
  let apiKey = "";
  for (let i = 0; i < 3; i++) {
    apiKey = randomToken();
    const keyHash = sha256(apiKey);
    try {
      created = await prisma.apiKey.create({
        data: { userId: s.uid, name, keyHash },
        select: { id: true, name: true, createdAt: true },
      });
      break;
    } catch (e: any) {
      // Retry only on unique constraint errors.
      const msg = String(e?.message || "");
      if (!msg.toLowerCase().includes("unique")) throw e;
    }
  }
  if (!created) {
    return NextResponse.json({ ok: false, error: "Failed to create key (collision)" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, apiKey, id: created.id, name: created.name, createdAt: created.createdAt.toISOString() });
}
