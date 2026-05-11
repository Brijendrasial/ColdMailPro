import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { collectBlacklistAssets, normalizeDomain, normalizeIp } from "@/lib/blacklist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let s: any;
  try { s = await requireSession(); } catch { return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }); }

  const body = (await req.json().catch(() => ({}))) as any;
  const mode = String(body?.mode || "all");
  const assets = await collectBlacklistAssets(prisma, s.wid);
  let targets = assets;
  let source = "manual";

  // Manual lookup mode: lets users test custom domains/IPs that are not saved in ColdMailPro.
  // These targets are never persisted as assets; only the job result/logs store the lookup output.
  const customRawTargets = Array.isArray(body?.customTargets)
    ? body.customTargets
    : Array.isArray(body?.manualTargets)
      ? body.manualTargets
      : body?.manualTarget
        ? [body.manualTarget]
        : [];

  if (customRawTargets.length) {
    const custom = new Map<string, any>();
    for (const raw of customRawTargets) {
      const requestedType = String(raw?.type || "auto").toLowerCase();
      const rawValue = String(raw?.value || "").trim();
      const ipValue = normalizeIp(rawValue);
      const domainValue = normalizeDomain(rawValue);
      const type = requestedType === "ip" ? "ip" : requestedType === "domain" ? "domain" : ipValue ? "ip" : domainValue ? "domain" : "";
      const value = type === "ip" ? ipValue : type === "domain" ? domainValue : null;
      if (!value || (type !== "ip" && type !== "domain")) continue;
      custom.set(`${type}:${value}`, {
        type,
        value,
        label: value,
        sources: ["Manual lookup"],
      });
    }
    targets = Array.from(custom.values());
    source = "manual_lookup";
  } else if (Array.isArray(body?.targets) && body.targets.length) {
    const wanted = new Set<string>();
    for (const raw of body.targets) {
      const type = String(raw?.type || "").toLowerCase();
      const value = type === "ip" ? normalizeIp(raw?.value) : normalizeDomain(raw?.value);
      if ((type === "ip" || type === "domain") && value) wanted.add(`${type}:${value}`);
    }
    targets = assets.filter((a) => wanted.has(`${a.type}:${a.value}`));
  } else if (mode === "listed") {
    // keep target list empty here; worker will still collect all if none are supplied.
    targets = assets;
  }

  if (!targets.length) return NextResponse.json({ error: customRawTargets.length ? "NO_VALID_CUSTOM_TARGETS" : "NO_TARGETS" }, { status: 400 });

  // Reuse fleet scans so users do not stack expensive full sweeps. Manual lookup jobs are intentionally
  // not reused, because each lookup may contain different ad-hoc assets.
  if (source !== "manual_lookup") {
    const existing = await prisma.job.findFirst({
      where: { type: "blacklist_check", status: { in: ["queued", "running"] }, payload: { contains: s.wid }, NOT: { payload: { contains: '"source":"manual_lookup"' } } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    if (existing) return NextResponse.json({ jobId: existing.id, status: existing.status, reused: true, targetCount: targets.length, source });
  }

  const job = await prisma.job.create({
    data: {
      type: "blacklist_check",
      payload: JSON.stringify({ workspaceId: s.wid, source, targets: targets.map(({ type, value, label, sources }) => ({ type, value, label, sources })) }),
      runAt: new Date(),
      status: "queued",
    },
    select: { id: true, status: true },
  });

  return NextResponse.json({ jobId: job.id, status: job.status, reused: false, targetCount: targets.length, source });
}
