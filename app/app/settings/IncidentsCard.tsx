import { Card, Pill, Button } from "@/components/ui";
import { prisma } from "@/lib/prisma";

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
      createdAt: true,
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
            const actions: any[] = Array.isArray(fixes?.actions) ? fixes.actions : [];
            const safeCount = actions.filter((a) => String(a.kind || "") === "safe").length;
            const riskyCount = actions.filter((a) => String(a.kind || "") === "risky").length;

            return (
              <div key={it.id} className="rounded-2xl border border-slate-200 bg-white/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs rounded-lg bg-slate-100 px-2 py-1">inc {shortId(it.id)}</span>
                  <Pill tone={toneFor(it.severity)}>{String(it.severity || "info")}</Pill>
                  <Pill tone="info">{String(it.source || "worker")}</Pill>
                  <span className="text-xs text-slate-500">{new Date(it.createdAt).toLocaleString()}</span>
                </div>

                <div className="mt-2 text-sm text-slate-900 whitespace-pre-wrap">{it.summary}</div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Pill tone="success">Safe: {safeCount}</Pill>
                  <Pill tone={riskyCount ? "warning" : "info"}>Risky: {riskyCount}</Pill>

                  {safeCount ? (
                    <form action={`/api/system/incidents/${it.id}/apply-safe`} method="post">
                      <Button type="submit">Apply safe fixes</Button>
                    </form>
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
