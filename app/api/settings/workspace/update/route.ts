import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const form = await req.formData();
  const name = String(form.get("name") || "").trim();

  if (!name || name.length < 2) {
    return NextResponse.redirect(absoluteUrl(req, "/app/settings?err=" + encodeURIComponent("Workspace name is required")));
  }
  if (name.length > 80) {
    return NextResponse.redirect(absoluteUrl(req, "/app/settings?err=" + encodeURIComponent("Workspace name is too long")));
  }

  await prisma.workspace.update({ where: { id: s.wid }, data: { name } });
  return NextResponse.redirect(absoluteUrl(req, "/app/settings?ok=" + encodeURIComponent("Workspace updated")));
}
