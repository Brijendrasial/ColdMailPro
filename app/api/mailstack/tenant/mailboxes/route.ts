import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const s = await requireSession();
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId") || "";

  const t = await prisma.mailstackTenant.findFirst({
    where: { id: tenantId, workspaceId: s.wid },
    include: { mailboxes: true },
  });
  if (!t) return new Response("Not found", { status: 404 });

  const rows = ["email,password"];
  for (const m of t.mailboxes) {
    let pw = "";
    try { pw = decrypt(m.passwordEnc); } catch { pw = ""; }
    rows.push(`${m.email},${pw}`);
  }
  const csv = rows.join("\n") + "\n";

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${t.name}-mailboxes.csv"`,
      "cache-control": "no-store",
    },
  });
}
