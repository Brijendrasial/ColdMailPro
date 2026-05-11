import { Container, Badge, Pill } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { collectBlacklistAssets } from "@/lib/blacklist";
import BlacklistClient from "./BlacklistClient";

function safeJson(v: any) {
  try { return JSON.parse(String(v || "{}")); } catch { return null; }
}

function isManualLookupJob(job: any) {
  return safeJson(job?.payload)?.source === "manual_lookup";
}

async function loadInitial(workspaceId: string) {
  const assets = await collectBlacklistAssets(prisma, workspaceId);
  const jobs = await prisma.job.findMany({
    where: { type: "blacklist_check", status: { in: ["queued", "running", "done", "failed"] }, payload: { contains: workspaceId } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, status: true, payload: true, lastError: true, createdAt: true, lockedAt: true },
  });
  const fleetJobs = jobs.filter((j: any) => !isManualLookupJob(j));
  const pendingJob = fleetJobs.find((j: any) => j.status === "queued" || j.status === "running") || null;
  const latestJob = fleetJobs.find((j: any) => j.status === "done" || j.status === "failed") || null;
  const latestResult = latestJob ? safeJson(latestJob.lastError) : null;
  const byKey = new Map<string, any>();
  if (Array.isArray(latestResult?.results)) for (const r of latestResult.results) byKey.set(`${r.type}:${r.value}`, r);
  const merged = assets.map((a) => ({ ...a, check: byKey.get(`${a.type}:${a.value}`) || null }));
  const listed = merged.filter((a) => a.check?.status === "listed").length;
  const warning = merged.filter((a) => a.check?.status === "warning").length;
  const clear = merged.filter((a) => a.check?.status === "clear").length;
  return {
    assets: merged,
    summary: {
      total: merged.length,
      domains: merged.filter((a) => a.type === "domain").length,
      ips: merged.filter((a) => a.type === "ip").length,
      listed,
      warning,
      clear,
      unknown: merged.length - listed - warning - clear,
      status: listed ? "listed" : warning ? "warning" : clear ? "clear" : "unknown",
      lastCheckedAt: latestResult?.checkedAt || latestJob?.createdAt?.toISOString?.() || null,
    },
    latestJob: latestJob ? { id: latestJob.id, status: latestJob.status, createdAt: latestJob.createdAt.toISOString() } : null,
    pendingJob: pendingJob ? { id: pendingJob.id, status: pendingJob.status, createdAt: pendingJob.createdAt.toISOString() } : null,
  };
}

export default async function BlacklistMonitorPage() {
  const s = await requireSession();
  const initial = await loadInitial(s.wid);

  return (
    <Container wide className="max-w-[1700px] space-y-7">
      <section className="relative overflow-hidden rounded-[2.4rem] border border-white/70 bg-slate-950 text-white shadow-[0_32px_90px_rgba(15,23,42,0.22)]">
        <div className="absolute inset-0 bg-[radial-gradient(900px_circle_at_8%_0%,rgba(239,68,68,0.32),transparent_42%),radial-gradient(820px_circle_at_92%_20%,rgba(14,165,233,0.28),transparent_42%),linear-gradient(135deg,#020617,#111827_54%,#082f49)]" />
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_430px] lg:p-10">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/75 shadow-sm backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_0_4px_rgba(52,211,153,0.18)]" />
              Reputation monitor
            </div>
            <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight sm:text-5xl">Blacklist Monitor</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
              Check every sending domain and outbound IP in ColdMailPro against common DNSBL and URIBL providers before reputation issues damage campaigns.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Badge>{initial.summary.total} watched assets</Badge>
              <Badge>{initial.summary.domains} domains</Badge>
              <Badge>{initial.summary.ips} IPs</Badge>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <HeroStat label="Listed" value={initial.summary.listed} tone={initial.summary.listed ? "danger" : "success"} />
            <HeroStat label="Warnings" value={initial.summary.warning} tone={initial.summary.warning ? "warning" : "success"} />
            <HeroStat label="Clear" value={initial.summary.clear} tone="success" />
            <div className="rounded-[1.4rem] border border-white/10 bg-white/10 p-4 backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Fleet state</div>
              <div className="mt-3"><Pill tone={initial.summary.listed ? "danger" : initial.summary.warning ? "warning" : "success"}>{initial.summary.listed ? "Action needed" : initial.summary.warning ? "Review" : "Clean"}</Pill></div>
              <div className="mt-2 text-xs text-slate-400">Last check: {initial.summary.lastCheckedAt ? new Date(initial.summary.lastCheckedAt).toLocaleString() : "never"}</div>
            </div>
          </div>
        </div>
      </section>

      <BlacklistClient initial={initial as any} />
    </Container>
  );
}

function HeroStat({ label, value, tone }: { label: string; value: any; tone: "success" | "warning" | "danger" }) {
  const cls = tone === "danger" ? "text-red-200" : tone === "warning" ? "text-amber-200" : "text-emerald-200";
  return (
    <div className="rounded-[1.4rem] border border-white/10 bg-white/10 p-4 backdrop-blur">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className={`mt-3 text-3xl font-semibold ${cls}`}>{value}</div>
      <div className="mt-1 text-xs text-slate-400">latest scan</div>
    </div>
  );
}
