import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  let s: any;
  try { s = await requireSession(); } catch { return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }); }

  const existing = await prisma.warmupTemplate.count({ where: { workspaceId: s.wid } });
  if (existing > 0) return NextResponse.json({ ok: true, skipped: true });

  const initial = [
    {
      name: "Short intro",
      subject: "[WU] Quick question",
      text: `Hey! Quick question — are you using any tool to manage outbound email?

Just curious. Thanks!`,
    },
    {
      name: "Friendly hello",
      subject: "[WU] Hello 👋",
      text: `Hey there 👋

Hope you’re doing well. Wanted to say hi.

Cheers!`,
    },
  ];
  const reply = [
    {
      name: "Simple reply",
      subject: "Re: [WU] Quick question",
      text: `Thanks! Appreciate it. Makes sense.

Have a great day!`,
    },
    {
      name: "Ack",
      subject: "Re: [WU]",
      text: `Got it — thank you!

All the best.`,
    },
  ];

  await prisma.warmupTemplate.createMany({
    data: [
      ...initial.map((t) => ({ workspaceId: s.wid, type: "initial", ...t, isActive: true, source: "system" })),
      ...reply.map((t) => ({ workspaceId: s.wid, type: "reply", ...t, isActive: true, source: "system" })),
    ],
  });

  return NextResponse.json({ ok: true });
}
