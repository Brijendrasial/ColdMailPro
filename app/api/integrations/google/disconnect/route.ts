import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { disconnectGoogleCalendar } from "@/lib/google-calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const s = await requireSession();
  await disconnectGoogleCalendar(s.wid);
  return NextResponse.json({ ok: true });
}
