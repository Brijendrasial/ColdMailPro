import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mid = url.searchParams.get("m");
  const to = url.searchParams.get("to");

  if (mid) {
    await prisma.event.create({ data: { messageId: mid, type: "click", meta: to ? JSON.stringify({ to }) : null } }).catch(() => {});
    await prisma.message.update({ where: { id: mid }, data: { status: "clicked" } }).catch(() => {});
  }

  if (!to) return NextResponse.redirect(new URL("/", req.url));
  return NextResponse.redirect(to);
}
