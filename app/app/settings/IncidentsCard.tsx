import { Card, Pill, Button } from "@/components/ui";
import { prisma } from "@/lib/prisma";

function healthTone(health: string): "info" | "warning" | "danger" | "success" {
  if (health === "healthy") return "success";
  if (health === "degraded") return "warning";
  if (health === "still_unhealthy") return "danger";
  return "info";
}

function labelize(value: string) {
  return String(value || "unknown").replace(/_/g, " ");
}

function toneFor(sev: string): "info" | "warning" | "danger" | "success" {
  const s = String(sev || "info");
  if (s === "critical") return "danger";
  if (s === "error") return "danger";
  if (s === "warn") return "warning";
  return "info";
}

function shortId(id: string) {
  return id ? id.slice(0, 8) : "—";
}

export default async function IncidentsCard() {
  const p: any = prisma as any;
  const incidentDelegate = p?.incident;
  if (!incidentDelegate?.findMany) {
    return (
      <Card
        title="System: Incidents"
        subtitle="Incidents are not available yet. Run Prisma migrations and regenerate the Prisma client."
        right={<Pill tone="warning">Setup needed</Pill>}
      >
        <div className="text-sm text-slate-700">
          This usually happens when <span className="font-mono">prisma generate</span> hasn’t been run after adding the Incident models.
          <div className="mt-2 rounded-xl border border-slate-200 bg-white/60 p-3 font-mono text-xs whitespace-pre-wrap">
            npx prisma migrate deploy\n            npx prisma generate\n            restart app + worker
          </div>
        </div>
      </Card>
    );
  }

  const items = await incidentDelegate.findMany({
    where: { status: "open" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      workspaceId: true,
      severity: true,
      source: true,
      summary: true,
      suggestedFixesJson: true,
      evidenceJson: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      occurrenceCount: true,
      firstSeenAt: true,
      lastSeenAt: true,
      needsHumanReview: true,
      actions: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          actionType: true,
          commandPreview: true,
          outcome: true,
          logs: true,
          createdAt: true,
        },
      },
    },
  });

  const rows = items;

  return (
    <Card
      title="System: Incidents"
      subtitle="AI-powered incident detection across worker + mailstack. Safe actions can be applied by the worker; risky actions are suggestions only."
      right={<Pill tone="info">{rows.length} open</Pill>}
    >
      <div className="grid gap-3">
        {rows.length ? (
          rows.map((it) => {
            const fixes: any = (it as any).suggestedFixesJson || {};
            const evidence: any = (it as any).evidenceJson || {};
            const remediation = evidence?.remediation || {};
            const journalTail = String(evidence?.journal_tail || "").trim();
            const actions: any[] = Array.isArray(fixes?.actions) ? fixes.actions : [];
            const safeCount = actions.filter((a) => String(a.kind || "") === "safe").length;
            const riskyCount = actions.filter((a) => String(a.kind || "") === "risky").length;
            const remediationSteps: string[] = Array.isArray(remediation?.steps) ? remediation.steps : [];
            const verificationItems: string[] = Array.isArray(remediation?.verification?.items) ? remediation.verification.items : [];
            const currentHealth = String(remediation?.currentHealth || "unknown");
            const derivedStatus = String(remediation?.status || (currentHealth === "healthy" ? "resolved" : currentHealth === "still_unhealthy" ? "needs_review" : "open"));
            const autoRemediated = remediation?.autoRemediated === true;
            const timeline = [
              ...remediationSteps.map((step) => ({ label: step, tone: "success" as const })),
              ...((it as any).actions || []).map((action: any) => ({
                label: action.commandPreview || action.actionType || "action",
                tone: action.outcome === "failed" ? ("danger" as const) : action.outcome === "skipped" ? ("warning" as const) : ("info" as const),
              })),
            ];

            return (
              <div key={it.id} className="rounded-2xl border border-slate-200 bg-white/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs rounded-lg bg-slate-100 px-2 py-1">inc {shortId(it.id)}</span>
                  <Pill tone={toneFor(it.severity)}>{String(it.severity || "info")}</Pill>
                  <Pill tone="info">{String(it.source || "worker")}</Pill>
                  <Pill tone={derivedStatus === "resolved" ? "success" : derivedStatus === "needs_review" ? "danger" : derivedStatus === "degraded" ? "warning" : "info"}>
                    Status: {labelize(derivedStatus)}
                  </Pill>
                  {autoRemediated ? <Pill tone="success">Auto-remediated</Pill> : null}
                  {it.needsHumanReview ? <Pill tone="danger">Needs human review</Pill> : null}
                  <Pill tone={healthTone(currentHealth)}>Now: {labelize(currentHealth)}</Pill>
                  <Pill tone={Number(it.occurrenceCount || 1) > 1 ? "warning" : "info"}>Occurrences: {Number(it.occurrenceCount || 1)}</Pill>
                  <span className="text-xs text-slate-500">Opened {new Date(it.firstSeenAt || it.createdAt).toLocaleString()}</span>
                  <span className="text-xs text-slate-500">Last seen {new Date(it.lastSeenAt || it.updatedAt || it.createdAt).toLocaleString()}</span>
                </div>

                <div className="mt-2 text-sm text-slate-900 whitespace-pre-wrap">{it.summary}</div>


                {timeline.length ? (
                  <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">Actions taken</div>
                    <div className="mt-2 grid gap-2">
                      {timeline.map((step, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-sm text-slate-800">
                          <span className="mt-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />
                          <span>{step.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {verificationItems.length ? (
                  <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/70 p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-sky-700">Verification</div>
                    <div className="mt-2 grid gap-2">
                      {verificationItems.map((item, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-sm text-slate-800">
                          <span className="mt-1 inline-block h-2 w-2 rounded-full bg-sky-500" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}


                {journalTail ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-700">Evidence</div>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-700">{journalTail}</pre>
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Pill tone="success">Safe: {safeCount}</Pill>
                  <Pill tone={riskyCount ? "warning" : "info"}>Risky: {riskyCount}</Pill>

                  {safeCount && !autoRemediated ? (
                    <form action={`/api/system/incidents/${it.id}/apply-safe`} method="post">
                      <Button type="submit">Apply safe fixes</Button>
                    </form>
                  ) : autoRemediated ? (
                    <Pill tone="success">Safe actions already applied</Pill>
                  ) : (
                    <Pill tone="info">No safe auto-actions</Pill>
                  )}
                </div>

                {riskyCount ? (
                  <div className="mt-3 text-xs text-slate-600">
                    Risky suggestions are logged in AutoFix activity and stored in incident details (not auto-applied).
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="text-sm text-slate-600">No open incidents right now.</div>
        )}
      </div>
    </Card>
  );
}
