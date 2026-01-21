import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/url";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const form = await req.formData();
  const name = String(form.get("name") || "").trim();

  // Keep it simple: allow empty (clears name), but cap length.
  if (name.length > 80) {
    return NextResponse.redirect(absoluteUrl(req, "/app/settings?err=" + encodeURIComponent("Name is too long")));
  }

  await prisma.user.update({
    where: { id: s.uid },
    data: { name: name || null },
  });

  return NextResponse.redirect(absoluteUrl(req, "/app/settings?ok=" + encodeURIComponent("Profile updated")));
}
