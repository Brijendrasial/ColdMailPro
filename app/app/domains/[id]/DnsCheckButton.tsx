"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

type JobState = "idle" | "queued" | "running" | "done" | "failed";

type StatusResponse = {
  ok?: boolean;
  error?: string;
  job?: {
    id: string;
    status: JobState | string;
    lastError?: string | null;
  };
  result?: any;
  logs?: Array<{ id?: string; createdAt?: string; line: string }>;
};

function parseResult(v: any) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try {
    const parsed = JSON.parse(String(v));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export default function DnsCheckButton({ domainId, disabled }: { domainId: string; disabled?: boolean }) {
  const router = useRouter();
  const [jobId, setJobId] = useState("");
  const [state, setState] = useState<JobState>(disabled ? "running" : "idle");
  const [message, setMessage] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);

  const busy = state === "queued" || state === "running";

  const label = useMemo(() => {
    if (state === "queued") return "Queued…";
    if (state === "running") return "Checking DNS…";
    if (state === "done") return "Check again";
    if (state === "failed") return "Retry check";
    if (disabled) return "Checking…";
    return "Run check";
  }, [state, disabled]);

  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  async function poll(id: string, attempt = 0) {
    if (stopped.current || !id) return;
    try {
      const res = await fetch(`/api/domains/check/status?jobId=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as StatusResponse;
      if (!res.ok || !data.ok || !data.job) {
        setState("failed");
        setMessage(data.error || "Could not read DNS check status.");
        return;
      }

      const status = String(data.job.status || "running") as JobState;
      setState(status === "queued" || status === "running" || status === "done" || status === "failed" ? status : "running");
      const nextLogs = Array.isArray(data.logs) ? data.logs.map((x) => String(x.line || "")).filter(Boolean).slice(-5) : [];
      setLogs(nextLogs);

      const result = data.result || parseResult(data.job.lastError);
      if (status === "done") {
        const summary = result?.summary;
        const score = typeof summary?.score === "number" ? `, score ${summary.score}` : "";
        const statusLabel = summary?.status ? ` (${summary.status}${score})` : "";
        setMessage(`DNS check complete${statusLabel}.`);
        router.refresh();
        return;
      }

      if (status === "failed") {
        setMessage(data.job.lastError || "DNS check failed. See worker logs for details.");
        router.refresh();
        return;
      }

      const delay = attempt < 4 ? 900 : attempt < 12 ? 1500 : 2500;
      pollTimer.current = setTimeout(() => poll(id, attempt + 1), delay);
    } catch (err: any) {
      setState("failed");
      setMessage(String(err?.message || err || "Could not poll DNS check."));
    }
  }

  async function run() {
    if (busy) return;
    if (pollTimer.current) clearTimeout(pollTimer.current);
    setState("queued");
    setMessage("Queued DNS check. Waiting for worker…");
    setLogs([]);
    try {
      const res = await fetch("/api/domains/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domainId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "DNS check request failed");
      const id = String(data?.jobId || data?.jobs?.[0]?.id || "");
      if (!id) {
        setState("failed");
        setMessage("DNS check was queued, but no job id was returned. Refreshing page…");
        router.refresh();
        return;
      }
      setJobId(id);
      setState(data?.reused ? "running" : "queued");
      setMessage(data?.reused ? "Existing DNS check is already running…" : "DNS check queued. Live status will update here.");
      await poll(id);
    } catch (err: any) {
      setState("failed");
      setMessage(String(err?.message || err || "DNS check failed to start."));
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant={state === "failed" ? "danger" : "ghost"} onClick={run} disabled={!!disabled || busy}>
        {label}
      </Button>
      {jobId || message ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white/75 p-3 text-xs leading-5 text-slate-600 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${state === "done" ? "bg-emerald-500" : state === "failed" ? "bg-red-500" : "bg-indigo-500 animate-pulse"}`} />
            <span className="font-semibold text-slate-800">{state === "idle" ? "Ready" : state}</span>
            {jobId ? <span className="font-mono text-slate-400">{jobId.slice(0, 8)}</span> : null}
          </div>
          {message ? <div className="mt-1">{message}</div> : null}
          {logs.length ? (
            <div className="mt-2 max-h-24 overflow-auto rounded-xl bg-slate-950 p-2 font-mono text-[11px] text-slate-100">
              {logs.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
