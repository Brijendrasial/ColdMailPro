"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";

type UpdateMode = "server" | "roundcube" | "both";
type RoundcubeChannel = "stable" | "package" | "custom";
type JobStatus = "idle" | "starting" | "queued" | "running" | "done" | "failed";

type JobLogLine = {
  id?: string;
  createdAt: string;
  line: string;
};

type StatusResponse = {
  ok: boolean;
  job?: {
    id: string;
    type: string;
    status: string;
    attempts: number;
    lastError?: string | null;
    createdAt: string;
    runAt: string;
    lockedAt?: string | null;
  };
  logs?: JobLogLine[];
  error?: string;
};

const actions: Record<UpdateMode, { title: string; subtitle: string; tone: string; bullets: string[] }> = {
  server: {
    title: "Update all server software",
    subtitle: "Updates OS packages and restarts MailStack services automatically.",
    tone: "from-indigo-600 via-blue-600 to-cyan-500",
    bullets: ["OS/server packages", "Exim + Dovecot", "Nginx/PHP-FPM/database/cache restarts"],
  },
  roundcube: {
    title: "Update Roundcube",
    subtitle: "Installs your selected Roundcube build, then runs safe post-update steps.",
    tone: "from-violet-600 via-fuchsia-600 to-pink-500",
    bullets: ["Stable latest / OS package / custom", "Roundcube updater/migrations", "Web/mail service restarts"],
  },
  both: {
    title: "Update server + Roundcube",
    subtitle: "Runs the full server update first, then your selected Roundcube build.",
    tone: "from-emerald-600 via-teal-600 to-sky-500",
    bullets: ["Full server update", "Selected Roundcube build", "All MailStack service restarts"],
  },
};

const stepLabels = ["Queued", "Worker picked up", "Updating", "Restarting services", "Finished"];

function shortJobId(id?: string) {
  return id ? id.slice(0, 8) : "pending";
}

function statusLabel(status: JobStatus) {
  if (status === "starting") return "Starting";
  if (status === "queued") return "Queued";
  if (status === "running") return "Running";
  if (status === "done") return "Complete";
  if (status === "failed") return "Failed";
  return "Ready";
}

function estimateProgress(status: JobStatus, logs: JobLogLine[]) {
  const text = logs.map((l) => l.line.toLowerCase()).join("\n");
  if (status === "done") return 100;
  if (status === "failed") return 100;
  if (status === "starting") return 8;
  if (status === "queued") return 15;

  let score = 25;
  if (text.includes("queued")) score = Math.max(score, 20);
  if (text.includes("starting") || text.includes("running") || text.includes("dnf") || text.includes("yum") || text.includes("apt")) score = Math.max(score, 40);
  if (text.includes("roundcube") || text.includes("package")) score = Math.max(score, 55);
  if (text.includes("restart") || text.includes("restarting") || text.includes("systemctl")) score = Math.max(score, 78);
  if (text.includes("completed") || text.includes("done") || text.includes("finished")) score = Math.max(score, 92);
  return Math.min(95, score + Math.min(12, Math.floor(logs.length / 4)));
}

function activeStep(progress: number, status: JobStatus) {
  if (status === "failed") return 4;
  if (progress >= 100) return 4;
  if (progress >= 76) return 3;
  if (progress >= 38) return 2;
  if (progress >= 18) return 1;
  return 0;
}

export default function MailstackMaintenanceClient() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<UpdateMode>("server");
  const [jobId, setJobId] = useState<string | null>(null);
  const [roundcubeChannel, setRoundcubeChannel] = useState<RoundcubeChannel>("stable");
  const [customRoundcubeVersion, setCustomRoundcubeVersion] = useState("1.6.15");
  const [status, setStatus] = useState<JobStatus>("idle");
  const [logs, setLogs] = useState<JobLogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  const action = actions[mode];
  const progress = useMemo(() => estimateProgress(status, logs), [status, logs]);
  const currentStep = activeStep(progress, status);
  const isBusy = status === "starting" || status === "queued" || status === "running";

  useEffect(() => {
    if (!open || !jobId || status === "done" || status === "failed") return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/mailstack/system/update/status?jobId=${encodeURIComponent(jobId)}`, {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        const data = (await res.json()) as StatusResponse;
        if (cancelled) return;
        if (!res.ok || !data.ok || !data.job) {
          setError(data.error || "Could not read update status yet.");
          return;
        }
        const nextStatus = (data.job.status || "queued") as JobStatus;
        setStatus(nextStatus);
        setLogs(data.logs || []);
        setError(data.job.lastError || null);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Could not reach update status endpoint.");
      }
    };

    poll();
    const timer = window.setInterval(poll, 1800);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, jobId, status]);

  useEffect(() => {
    const el = logBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  function roundcubeChoiceLabel() {
    if (roundcubeChannel === "package") return "OS package repository build";
    if (roundcubeChannel === "custom") return `Custom Roundcube ${customRoundcubeVersion || "version"}`;
    return "Latest stable build from Roundcube.net/GitHub";
  }

  async function startUpdate(nextMode: UpdateMode) {
    setMode(nextMode);
    setOpen(true);
    setJobId(null);
    setLogs([]);
    setError(null);
    setCopied(false);
    setStatus("starting");

    try {
      if ((nextMode === "roundcube" || nextMode === "both") && roundcubeChannel === "custom" && !/^\d+\.\d+\.\d+(?:[-a-zA-Z0-9.]+)?$/.test(customRoundcubeVersion.trim())) {
        throw new Error("Enter a valid Roundcube version like 1.6.15.");
      }

      const res = await fetch("/api/mailstack/system/update", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          mode: nextMode,
          roundcubeChannel,
          roundcubeVersion: roundcubeChannel === "custom" ? customRoundcubeVersion.trim() : "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok || !data?.jobId) {
        throw new Error(data?.error || "Could not queue this update job.");
      }
      setJobId(data.jobId);
      setStatus("queued");
      setLogs([{ createdAt: new Date().toISOString(), line: `Queued ${actions[nextMode].title}${nextMode === "server" ? "" : ` using ${roundcubeChoiceLabel()}`}. Waiting for worker...` }]);
    } catch (err: any) {
      setStatus("failed");
      setError(err?.message || "Could not start update.");
      setLogs([{ createdAt: new Date().toISOString(), line: err?.message || "Could not start update." }]);
    }
  }

  async function copyLogs() {
    const text = logs.map((l) => `[${new Date(l.createdAt).toLocaleString()}] ${l.line}`).join("\n");
    await navigator.clipboard.writeText(text || "No logs yet").catch(() => null);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1300);
  }

  return (
    <>
      <div className="grid gap-4">
        <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-cyan-50 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">One-click MailStack maintenance</div>
              <div className="mt-1 text-sm text-slate-600">
                Opens a live progress window, queues the worker job, streams logs, and shows completion/failure clearly. Roundcube can use the newest upstream stable build instead of the older OS repo package.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => startUpdate("server")}>Update all server software</Button>
              <Button type="button" variant="ghost" onClick={() => startUpdate("roundcube")}>Update Roundcube</Button>
              <Button type="button" variant="secondary" onClick={() => startUpdate("both")}>Update server + Roundcube</Button>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">Roundcube build selector</div>
              <div className="mt-1 text-sm text-slate-600">Choose exactly what the Roundcube update button installs. Use Stable latest for versions like 1.6.15 from upstream Roundcube releases.</div>
            </div>
            <div className="grid gap-2 sm:grid-cols-[260px_160px]">
              <label className="grid gap-1 text-xs font-medium text-slate-600">
                Build source
                <select
                  value={roundcubeChannel}
                  onChange={(e) => setRoundcubeChannel(e.target.value as RoundcubeChannel)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="stable">Stable latest from Roundcube.net</option>
                  <option value="custom">Custom upstream version</option>
                  <option value="package">OS package repository</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs font-medium text-slate-600">
                Version
                <input
                  value={customRoundcubeVersion}
                  onChange={(e) => setCustomRoundcubeVersion(e.target.value)}
                  disabled={roundcubeChannel !== "custom"}
                  placeholder="1.6.15"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm disabled:bg-slate-100 disabled:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </label>
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-xs text-violet-800">
            Selected: {roundcubeChoiceLabel()}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {(Object.keys(actions) as UpdateMode[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => startUpdate(key)}
              className="group text-left rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-200"
            >
              <div className={`h-1.5 w-16 rounded-full bg-gradient-to-r ${actions[key].tone}`} />
              <div className="mt-3 font-semibold text-slate-900 group-hover:text-indigo-700">{actions[key].title}</div>
              <div className="mt-1 text-xs leading-5 text-slate-600">{actions[key].subtitle}</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {actions[key].bullets.map((b) => (
                  <span key={b} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600">{b}</span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm">
          <div className="w-full max-w-4xl overflow-hidden rounded-3xl border border-white/20 bg-white shadow-2xl">
            <div className={`bg-gradient-to-r ${action.tone} p-5 text-white`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.25em] opacity-80">MailStack maintenance</div>
                  <div className="mt-1 text-2xl font-semibold">{action.title}</div>
                  <div className="mt-1 text-sm opacity-90">Job {shortJobId(jobId || undefined)} • {statusLabel(status)}</div>
                  {mode !== "server" ? <div className="mt-1 text-xs opacity-80">Roundcube: {roundcubeChoiceLabel()}</div> : null}
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-2xl bg-white/15 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/25"
                >
                  Close
                </button>
              </div>

              <div className="mt-5 rounded-2xl bg-white/15 p-3">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span>{status === "failed" ? "Stopped with error" : status === "done" ? "Update complete" : "Working... keep this window open for live progress"}</span>
                  <span>{progress}%</span>
                </div>
                <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/20">
                  <div className="h-full rounded-full bg-white transition-all duration-700" style={{ width: `${progress}%` }} />
                </div>
              </div>
            </div>

            <div className="grid gap-4 p-5 lg:grid-cols-[280px_1fr]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">Progress stages</div>
                <div className="mt-4 grid gap-3">
                  {stepLabels.map((label, idx) => {
                    const complete = idx < currentStep || status === "done";
                    const active = idx === currentStep && status !== "done" && status !== "failed";
                    const failed = status === "failed" && idx === currentStep;
                    return (
                      <div key={label} className="flex items-center gap-3">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${failed ? "bg-red-100 text-red-700" : complete ? "bg-emerald-100 text-emerald-700" : active ? "bg-indigo-100 text-indigo-700" : "bg-white text-slate-400 border border-slate-200"}`}>
                          {failed ? "!" : complete ? "✓" : active ? "•" : idx + 1}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-slate-800">{label}</div>
                          {active ? <div className="text-xs text-slate-500">In progress now</div> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                  The worker must be running for the job to move past queued. Services restart automatically after package updates.
                </div>
              </div>

              <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-950 text-slate-100">
                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold">Live update logs</div>
                    <div className="text-xs text-slate-400">Auto-refreshes every few seconds while running.</div>
                  </div>
                  <button type="button" onClick={copyLogs} className="rounded-xl border border-white/10 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10">
                    {copied ? "Copied" : "Copy logs"}
                  </button>
                </div>
                <div ref={logBoxRef} className="max-h-[360px] overflow-auto p-4 font-mono text-xs leading-5">
                  {logs.length ? (
                    logs.map((l, idx) => (
                      <div key={(l.id || "log") + idx} className="whitespace-pre-wrap break-words border-b border-white/5 py-1.5 last:border-0">
                        <span className="text-slate-500">[{new Date(l.createdAt).toLocaleTimeString()}]</span> {l.line}
                      </div>
                    ))
                  ) : (
                    <div className="text-slate-400">Preparing update job...</div>
                  )}
                  {error ? <div className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-red-100">{error}</div> : null}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-slate-600">
                {isBusy ? "You can close this popup; the job continues in the worker. Reopen the action to start another job." : status === "done" ? "All set. Check the logs above for exactly what changed." : "Review the error/logs above, then retry when ready."}
              </div>
              <div className="flex gap-2">
                {status === "failed" ? <Button type="button" variant="ghost" onClick={() => startUpdate(mode)}>Retry</Button> : null}
                <Button type="button" variant={status === "done" ? "primary" : "ghost"} onClick={() => setOpen(false)}>
                  {status === "done" ? "Done" : "Minimize"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
