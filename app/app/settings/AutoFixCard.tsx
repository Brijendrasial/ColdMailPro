import { Card, Pill } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

type Row = {
  createdAt: Date;
  jobId: string;
  jobType: string;
  line: string;
};

function shortId(id: string) {
  return id ? id.slice(0, 8) : "—";
}

export default async function AutoFixCard() {
  // Pull recent JobLogs that mention AutoFix (safe applied + AI suggestions)
  const logs = await prisma.jobLog.findMany({
    where: {
      OR: [
        { line: { contains: "AutoFix" } },
        { line: { contains: "🧠" } },
        { line: { contains: "🔧 AutoFix" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: { jobId: true, line: true, createdAt: true },
  });

  const jobIds = Array.from(new Set(logs.map((l) => l.jobId)));
  const jobs = await prisma.job.findMany({
    where: { id: { in: jobIds } },
    select: { id: true, type: true, status: true, attempts: true, lastError: true },
  });
  const jobMap = new Map(jobs.map((j) => [j.id, j]));

  const rows: Row[] = logs.map((l) => ({
    createdAt: l.createdAt,
    jobId: l.jobId,
    jobType: jobMap.get(l.jobId)?.type || "unknown",
    line: l.line,
  }));

  const enabled = Boolean(env.AUTOFIX_ENABLED);
  const autoApply = Boolean(env.AUTOFIX_AUTO_APPLY_SAFE);
  const aiSuggest = Boolean(env.AUTOFIX_AI_SUGGESTIONS);
  const maxAttempts = Number(env.AUTOFIX_MAX_SAFE_ATTEMPTS_PER_JOB || 1);

  return (
    <Card
      title="System: AutoFix"
      subtitle="Safe fixes are auto-applied. Risky fixes are suggested only (never executed)."
      right={<Pill tone={enabled ? "success" : "warning"}>{enabled ? "Enabled" : "Disabled"}</Pill>}
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <Pill tone={autoApply ? "success" : "warning"}>Auto-apply safe: {autoApply ? "On" : "Off"}</Pill>
          <Pill tone={aiSuggest ? "info" : "warning"}>AI suggestions: {aiSuggest ? "On" : "Off"}</Pill>
          <Pill tone="info">Max safe attempts/job: {String(maxAttempts)}</Pill>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white/60 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 text-sm font-medium">Recent AutoFix activity</div>
          <div className="divide-y divide-slate-200">
            {rows.length ? (
              rows.map((r, i) => (
                <div key={r.jobId + String(i)} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs rounded-lg bg-slate-100 px-2 py-1">job {shortId(r.jobId)}</span>
                    <Pill tone="info">{r.jobType}</Pill>
                    <span className="text-xs text-slate-500">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-slate-800">{r.line}</div>
                </div>
              ))
            ) : (
              <div className="px-4 py-6 text-sm text-slate-600">
                No AutoFix logs yet. When a job fails, the worker will log safe fixes (🔧) and risky suggestions (🧠).
              </div>
            )}
          </div>
        </div>

        <div className="text-xs text-slate-600">
          Tip: If you want stricter behavior, set <span className="font-mono">AUTOFIX_AUTO_APPLY_SAFE=false</span> to switch to
          suggest-only mode for everything.
        </div>
      </div>
    </Card>
  );
}
