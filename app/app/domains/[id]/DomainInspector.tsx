"use client";

import React, { useMemo, useState } from "react";
import { Button, CodeBlock, Divider, Pill, ProgressBar, Segmented } from "@/components/ui";
import DnsCheckButton from "./DnsCheckButton";
import DeleteDomainButton from "./DeleteDomainButton";

type Rec = {
  spf?: { detail?: string };
  dkim?: { detail?: string };
  dmarc?: { detail?: string };
  mx?: { detail?: string };
};

function toneFromStatus(status: string, pending: boolean) {
  if (pending) return "info" as const;
  if (status === "healthy") return "success" as const;
  if (status === "warning") return "warning" as const;
  if (status === "fail") return "danger" as const;
  return "neutral" as const;
}

function labelFromStatus(status: string, pending: boolean) {
  if (pending) return "checking…";
  if (status === "healthy") return "healthy";
  if (status === "warning") return "needs work";
  if (status === "fail") return "misconfigured";
  return "not checked";
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-9 px-3"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 900);
        } catch {
          // ignore
        }
      }}
    >
      {ok ? "Copied" : label}
    </Button>
  );
}

export default function DomainInspector(props: {
  domainId: string;
  domainName: string;
  pending: boolean;
  status: string;
  score: number;
  lastCheckedAt?: string | null;
  issues?: string[];
  rec?: Rec | null;
  spfValue: string;
  dmarcValue: string;
  mxValue: string;
}) {
  const {
    domainId,
    domainName,
    pending,
    status,
    score,
    lastCheckedAt,
    issues,
    rec,
    spfValue,
    dmarcValue,
    mxValue,
  } = props;

  const [tab, setTab] = useState<"health" | "dns" | "danger">("health");

  const statusTone = toneFromStatus(status, pending);
  const statusLabel = labelFromStatus(status, pending);
  const safeScore = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;

  const topIssues = useMemo(() => {
    const arr = Array.isArray(issues) ? issues.filter(Boolean) : [];
    return arr.slice(0, 8);
  }, [issues]);

  return (
    <div className="xl:sticky xl:top-24 self-start">
      <div className="glass overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200/70 bg-gradient-to-b from-white/60 to-white/0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">Inspector</div>
              <div className="text-xs text-slate-600 mt-0.5">Quick health + copy‑paste DNS + destructive actions.</div>
            </div>
            <div className="shrink-0">
              <DnsCheckButton domainId={domainId} disabled={pending} />
            </div>
          </div>

          <div className="mt-3 grid gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Pill tone={statusTone}>{statusLabel}</Pill>
              <Pill tone="neutral">
                score: <b className="font-semibold">{safeScore}</b>/100
              </Pill>
              {lastCheckedAt ? <span className="text-xs text-slate-500">last: {lastCheckedAt}</span> : null}
            </div>
            <ProgressBar value={safeScore} />
          </div>

          <div className="mt-4">
            <Segmented
              value={tab}
              onChange={(v) => setTab(v as any)}
              className="w-full"
              options={[
                { value: "health", label: "Health" },
                { value: "dns", label: "DNS" },
                { value: "danger", label: "Danger" },
              ]}
            />
          </div>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 max-h-[calc(100vh-9.5rem)] overflow-auto">
          {tab === "health" ? (
            <div className="grid gap-4">
              {topIssues.length ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3">
                  <div className="text-xs uppercase tracking-wider text-amber-700">What to fix</div>
                  <ul className="mt-2 grid gap-1 text-sm text-amber-900">
                    {topIssues.map((x, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                        <span className="leading-snug">{x}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-emerald-900">
                  No issues found (or not checked yet).
                </div>
              )}

              <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
                <div className="text-xs uppercase tracking-wider text-slate-500">Signals</div>
                <div className="mt-2 grid gap-1 text-xs text-slate-700">
                  <div><b>SPF</b>: {rec?.spf?.detail || "—"}</div>
                  <div><b>DKIM</b>: {rec?.dkim?.detail || "—"}</div>
                  <div><b>DMARC</b>: {rec?.dmarc?.detail || "—"}</div>
                  <div><b>MX</b>: {rec?.mx?.detail || "—"}</div>
                </div>
              </div>
            </div>
          ) : null}

          {tab === "dns" ? (
            <div className="grid gap-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Suggested records</div>
                  <div className="text-xs text-slate-600">Copy‑paste into your DNS provider.</div>
                </div>
                <CopyBtn
                  text={[`SPF: ${spfValue}`, `DMARC: ${dmarcValue}`, `MX: ${mxValue}`].join("\n")}
                  label="Copy all"
                />
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs uppercase tracking-wider text-slate-500">SPF (TXT @)</div>
                  <CopyBtn text={spfValue} label="Copy" />
                </div>
                <CodeBlock className="mt-2">{spfValue}</CodeBlock>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs uppercase tracking-wider text-slate-500">DMARC (TXT _dmarc)</div>
                  <CopyBtn text={dmarcValue} label="Copy" />
                </div>
                <CodeBlock className="mt-2">{dmarcValue}</CodeBlock>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs uppercase tracking-wider text-slate-500">MX (@)</div>
                  <CopyBtn text={mxValue} label="Copy" />
                </div>
                <CodeBlock className="mt-2">{mxValue}</CodeBlock>
              </div>

              <Divider />
              <div className="text-xs text-slate-600">
                Need the full record set (DKIM selectors, A/mailhost, TTL)? Open the <b>Manual DNS</b> tab.
              </div>
            </div>
          ) : null}

          {tab === "danger" ? (
            <div className="grid gap-3">
              <div className="rounded-2xl border border-red-200 bg-red-50/60 p-3">
                <div className="text-sm font-semibold text-red-900">Delete domain</div>
                <div className="text-sm text-red-800 mt-1">
                  This removes the domain from the app and deletes any mailboxes whose email ends with <b>@{domainName}</b>.
                </div>
              </div>
              <DeleteDomainButton domainId={domainId} domainName={domainName} />
              <div className="text-xs text-slate-500">
                Note: this does not automatically delete mailbox accounts from the Mailstack server OS.
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
