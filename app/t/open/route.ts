import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mid = url.searchParams.get("m");
  if (mid) {
    await prisma.event.create({ data: { messageId: mid, type: "open" } }).catch(() => {});
    await prisma.message.update({ where: { id: mid }, data: { status: "opened" } }).catch(() => {});
  }

  // 1x1 transparent gif
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
  return new NextResponse(gif, {
    headers: {
      "content-type": "image/gif",
      "cache-control": "no-store, max-age=0",
    },
  });
}
