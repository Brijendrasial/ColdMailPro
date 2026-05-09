import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UpdateMode = "server" | "roundcube" | "both";
type RoundcubeChannel = "stable" | "package" | "custom";

function isUpdateMode(v: string): v is UpdateMode {
  return v === "server" || v === "roundcube" || v === "both";
}

function isRoundcubeChannel(v: string): v is RoundcubeChannel {
  return v === "stable" || v === "package" || v === "custom";
}

function cleanRoundcubeVersion(v: unknown) {
  const raw = String(v || "").trim();
  if (!raw) return "";
  // Keep this intentionally strict. The shell script also validates, but this
  // prevents accidental argument injection before the job is even queued.
  return /^\d+\.\d+\.\d+(?:[-a-zA-Z0-9.]+)?$/.test(raw) ? raw : "";
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const accept = (req.headers.get("accept") || "").toLowerCase();
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  const wantsJson = accept.includes("application/json") || ct.includes("application/json");

  let modeRaw = "server";
  let roundcubeChannelRaw = "stable";
  let roundcubeVersionRaw = "";
  if (ct.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as any;
    modeRaw = String(body?.mode || "server").trim().toLowerCase();
    roundcubeChannelRaw = String(body?.roundcubeChannel || "stable").trim().toLowerCase();
    roundcubeVersionRaw = String(body?.roundcubeVersion || "").trim();
  } else {
    const form = await req.formData().catch(() => null);
    modeRaw = String(form?.get("mode") || "server").trim().toLowerCase();
    roundcubeChannelRaw = String(form?.get("roundcubeChannel") || "stable").trim().toLowerCase();
    roundcubeVersionRaw = String(form?.get("roundcubeVersion") || "").trim();
  }

  const mode: UpdateMode = isUpdateMode(modeRaw) ? modeRaw : "server";
  const roundcubeChannel: RoundcubeChannel = isRoundcubeChannel(roundcubeChannelRaw) ? roundcubeChannelRaw : "stable";
  const roundcubeVersion = roundcubeChannel === "custom" ? cleanRoundcubeVersion(roundcubeVersionRaw) : "";

  if ((mode === "roundcube" || mode === "both") && roundcubeChannel === "custom" && !roundcubeVersion) {
    return NextResponse.json({ ok: false, error: "Enter a valid Roundcube version like 1.6.15." }, { status: 400 });
  }

  const job = await prisma.job.create({
    data: {
      type: "mailstack:system-update",
      payload: JSON.stringify({ workspaceId: s.wid, userId: s.uid, mode, roundcubeChannel, roundcubeVersion }),
      runAt: new Date(),
      status: "queued",
    },
  });

  const label = mode === "roundcube" ? "Roundcube update" : mode === "both" ? "server + Roundcube update" : "server software update";
  const rcLabel = roundcubeChannel === "custom" ? `custom Roundcube ${roundcubeVersion}` : roundcubeChannel === "package" ? "OS package Roundcube" : "latest stable Roundcube.net build";
  try { await prisma.jobLog.create({ data: { jobId: job.id, line: `Queued ${label}${mode === "server" ? "" : ` (${rcLabel})`}` } }); } catch {}

  if (wantsJson) return NextResponse.json({ ok: true, jobId: job.id, mode, roundcubeChannel, roundcubeVersion });
  return NextResponse.redirect(absoluteUrl(req, "/app/mailstack"));
}
