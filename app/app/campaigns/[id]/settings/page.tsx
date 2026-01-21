import Link from "next/link";
import { Container, Card, Input, TextArea, Button, Badge, Pill } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function fmtDtLocal(d?: Date | null) {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

const weekdayLabels: Array<[number, string]> = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [0, "Sun"],
];

export default async function CampaignSettings({ params }: { params: { id: string } }) {
  const s = await requireSession();
  const id = params.id;

  const camp = await prisma.campaign.findFirst({
    where: { id, workspaceId: s.wid },
    include: {
      steps: { orderBy: { stepNumber: "asc" } },
      mailboxes: { include: { mailbox: true }, orderBy: { createdAt: "asc" } },
    },
  });

  if (!camp) {
    return (
      <Container>
        <Card title="Not found">Campaign not found.</Card>
      </Container>
    );
  }

  const allMailboxes = await prisma.mailbox.findMany({
    where: { workspaceId: s.wid },
    orderBy: { createdAt: "asc" },
  });

  const pools = await prisma.mailboxPool.findMany({
    where: { workspaceId: s.wid },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { members: true } } },
  });

  const selectedIds = new Set(camp.mailboxes.filter((m) => m.isActive).map((m) => m.mailboxId));

  const currentPoolId = (camp as any).mailboxPoolId ? String((camp as any).mailboxPoolId) : "";
  const senderMode: "manual" | "pool" | "all" = selectedIds.size > 0 ? "manual" : currentPoolId ? "pool" : "all";

  let days: number[] | null = null;
  try {
    const v = JSON.parse(String((camp as any).daysOfWeek || ""));
    if (Array.isArray(v)) days = v.map((x) => Number(x)).filter((x) => Number.isFinite(x));
  } catch {}

  return (
    <Container>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div className="min-w-0">
          <div className="text-2xl font-semibold tracking-tight">Campaign Settings</div>
          <div className="mt-1 text-sm opacity-70">Instantly-style control panel: schedule, sender pool, ramp-up, and stop rules.</div>
          <div className="mt-2 flex gap-2 flex-wrap">
            <Badge>Name: {camp.name}</Badge>
            <Pill tone={camp.status === "running" ? "success" : camp.status === "paused" ? "warning" : "neutral"}>{camp.status}</Pill>
            {(camp as any).archivedAt ? <Pill tone="danger">archived</Pill> : null}
          </div>
        </div>

        <div className="flex gap-2">
          <Link href={`/app/campaigns/${camp.id}`}><Button variant="ghost">← Back</Button></Link>
          <Link href={`/app/campaigns/${camp.id}/edit`}><Button variant="ghost">Edit sequence</Button></Link>
          <Link href={`/app/campaigns/${camp.id}/enroll`}><Button>Enroll leads</Button></Link>
        </div>
      </div>

      <div className="grid gap-4">
        <Card
          title="Basics"
          subtitle="Name, timezone, daily limits, schedule, ramp-up"
        >
          <form action="/api/campaigns/updateSettings" method="post" className="grid gap-4">
            <input type="hidden" name="campaignId" value={camp.id} />

            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <div className="text-sm mb-1 opacity-80">Campaign name</div>
                <Input name="name" defaultValue={camp.name} required />
              </div>
              <div>
                <div className="text-sm mb-1 opacity-80">Timezone (IANA)</div>
                <Input name="timezone" defaultValue={camp.timezone} placeholder="Asia/Kolkata" />
              </div>
            </div>

            <div className="grid md:grid-cols-4 gap-3">
              <div>
                <div className="text-sm mb-1 opacity-80">Sending window</div>
                <Input name="sendingWindow" defaultValue={camp.sendingWindow} placeholder="09:00-18:00" />
              </div>
              <div>
                <div className="text-sm mb-1 opacity-80">Daily send limit</div>
                <Input name="dailySendLimit" type="number" min="0" defaultValue={camp.dailySendLimit} />
              </div>
              <div>
                <div className="text-sm mb-1 opacity-80">Mailbox strategy</div>
                <select
                  name="mailboxStrategy"
                  defaultValue={camp.mailboxStrategy}
                  className="w-full px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-transparent"
                >
                  <option value="round_robin">Round robin</option>
                  <option value="least_recent">Least recently used</option>
                  <option value="score">Score-based (healthiest)</option>
                  <option value="score_idle">Score + min idle time</option>
                  <option value="random">Random</option>
                  <option value="weighted">Weighted (pool)</option>
                </select>
              </div>
              <div>
                <div className="text-sm mb-1 opacity-80">Min idle minutes (score+idle)</div>
                <Input name="mailboxMinIdleMinutes" type="number" min="0" defaultValue={(camp as any).mailboxMinIdleMinutes ?? 0} />
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <div className="text-sm mb-1 opacity-80">Start at (optional)</div>
                <Input name="startAt" type="datetime-local" defaultValue={fmtDtLocal((camp as any).startAt)} />
              </div>
              <div>
                <div className="text-sm mb-1 opacity-80">End at (optional)</div>
                <Input name="endAt" type="datetime-local" defaultValue={fmtDtLocal((camp as any).endAt)} />
              </div>
            </div>

            <div>
              <div className="text-sm mb-2 opacity-80">Days of week</div>
              <div className="flex flex-wrap gap-2">
                {weekdayLabels.map(([k, label]) => (
                  <label key={k} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/10">
                    <input
                      type="checkbox"
                      name="daysOfWeek"
                      value={String(k)}
                      defaultChecked={days ? days.includes(k) : (k >= 1 && k <= 5)}
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
              <div className="text-xs opacity-60 mt-2">If you never set this before, defaults to weekdays (Mon-Fri).</div>
            </div>

            <div className="rounded-2xl border border-black/10 dark:border-white/10 p-4">
              <div className="font-semibold">Ramp-up (optional)</div>
              <div className="text-sm opacity-70 mt-1">Gradually increase daily volume after campaign start.</div>

              <div className="mt-3 flex items-center gap-2">
                <input type="checkbox" name="rampEnabled" defaultChecked={(camp as any).rampEnabled} />
                <div className="text-sm">Enable ramp-up</div>
              </div>

              <div className="mt-3 grid md:grid-cols-3 gap-3">
                <div>
                  <div className="text-sm mb-1 opacity-80">Start limit</div>
                  <Input name="rampStartLimit" type="number" min="0" defaultValue={(camp as any).rampStartLimit ?? 20} />
                </div>
                <div>
                  <div className="text-sm mb-1 opacity-80">Daily increase</div>
                  <Input name="rampDailyIncrease" type="number" min="0" defaultValue={(camp as any).rampDailyIncrease ?? 20} />
                </div>
                <div>
                  <div className="text-sm mb-1 opacity-80">Ramp max</div>
                  <Input name="rampMaxLimit" type="number" min="0" defaultValue={(camp as any).rampMaxLimit ?? camp.dailySendLimit} />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-black/10 dark:border-white/10 p-4">
              <div className="font-semibold">Throttling & domain caps</div>
              <div className="text-sm opacity-70 mt-1">Protect deliverability: limit sends/minute and cap daily sends per recipient domain.</div>

              <div className="mt-3 grid md:grid-cols-3 gap-3">
                <div>
                  <div className="text-sm mb-1 opacity-80">Max sends/min per mailbox</div>
                  <Input name="perMailboxPerMinute" type="number" min="1" defaultValue={(camp as any).perMailboxPerMinute ?? 20} />
                </div>
                <div>
                  <div className="text-sm mb-1 opacity-80">Default domain daily cap</div>
                  <Input name="domainDailyCap" type="number" min="0" defaultValue={(camp as any).domainDailyCap ?? 25} />
                </div>
                <div className="text-xs opacity-70 flex items-end">
                  Domain caps apply per campaign. 0 means no cap.
                </div>
              </div>

              <div className="mt-3">
                <div className="text-sm mb-1 opacity-80">Per-domain caps (optional)</div>
                <TextArea
                  name="domainCaps"
                  defaultValue={(camp as any).domainCaps || ""}
                  placeholder={`gmail.com=25\nyahoo.com=15\noutlook.com=20`}
                />
                <div className="text-xs opacity-60 mt-2">Format: one per line, like gmail.com=25 (or paste a JSON map).</div>
              </div>
            </div>

            <div className="rounded-2xl border border-black/10 dark:border-white/10 p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold">Deliverability guardrails (auto-pause)</div>
                  <div className="text-sm opacity-70 mt-1">If bounce/unsub rates exceed thresholds in a rolling window, the campaign auto-pauses.</div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="guardEnabled" defaultChecked={Boolean((camp as any).guardEnabled ?? true)} />
                  Enable
                </label>
              </div>

              <div className="mt-3 grid md:grid-cols-3 gap-3">
                <div>
                  <div className="text-sm mb-1 opacity-80">Window (hours)</div>
                  <Input name="guardWindowHours" type="number" min="1" defaultValue={(camp as any).guardWindowHours ?? 24} />
                </div>
                <div>
                  <div className="text-sm mb-1 opacity-80">Min sent before checking</div>
                  <Input name="guardMinSent" type="number" min="1" defaultValue={(camp as any).guardMinSent ?? 50} />
                </div>
                <div className="text-xs opacity-70 flex items-end">
                  Example: only start pausing after 50 sent in the last 24h.
                </div>
              </div>

              <div className="mt-3 grid md:grid-cols-3 gap-3">
                <div>
                  <div className="text-sm mb-1 opacity-80">Max hard bounce %</div>
                  <Input name="guardMaxHardBouncePct" type="number" min="0" step="0.1" defaultValue={Math.round(((camp as any).guardMaxHardBounceRate ?? 0.05) * 1000) / 10} />
                </div>
                <div>
                  <div className="text-sm mb-1 opacity-80">Max total bounce %</div>
                  <Input name="guardMaxBouncePct" type="number" min="0" step="0.1" defaultValue={Math.round(((camp as any).guardMaxBounceRate ?? 0.08) * 1000) / 10} />
                </div>
                <div>
                  <div className="text-sm mb-1 opacity-80">Max unsubscribe %</div>
                  <Input name="guardMaxUnsubPct" type="number" min="0" step="0.1" defaultValue={Math.round(((camp as any).guardMaxUnsubRate ?? 0.02) * 1000) / 10} />
                </div>
              </div>

              {(camp as any).pausedReason ? (
                <div className="mt-3 text-xs opacity-70">
                  <div className="font-medium">Last pause reason</div>
                  <pre className="mt-1 p-3 rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/10 overflow-auto">{String((camp as any).pausedReason)}</pre>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-black/10 dark:border-white/10 p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold">Auto mailbox throttle (bounce spike protection)</div>
                  <div className="text-sm opacity-70 mt-1">If a sender mailbox starts bouncing too much in a short window, we automatically put it on cooldown so the worker avoids it.</div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="autoThrottleEnabled" defaultChecked={Boolean((camp as any).autoThrottleEnabled ?? true)} />
                  Enable
                </label>
              </div>

              <div className="mt-3 grid md:grid-cols-3 gap-3">
                <div>
                  <div className="text-sm mb-1 opacity-80">Window (minutes)</div>
                  <Input name="autoThrottleWindowMinutes" type="number" min="5" defaultValue={(camp as any).autoThrottleWindowMinutes ?? 60} />
                </div>
                <div>
                  <div className="text-sm mb-1 opacity-80">Min sent in window</div>
                  <Input name="autoThrottleMinSent" type="number" min="1" defaultValue={(camp as any).autoThrottleMinSent ?? 20} />
                </div>
                <div>
                  <div className="text-sm mb-1 opacity-80">Cooldown (minutes)</div>
                  <Input name="autoThrottleCooldownMinutes" type="number" min="5" defaultValue={(camp as any).autoThrottleCooldownMinutes ?? 120} />
                </div>
              </div>

              <div className="mt-3 grid md:grid-cols-3 gap-3">
                <div>
                  <div className="text-sm mb-1 opacity-80">Max hard bounce %</div>
                  <Input name="autoThrottleMaxHardBouncePct" type="number" min="0" step="0.1" defaultValue={Math.round(((camp as any).autoThrottleMaxHardBounceRate ?? 0.08) * 1000) / 10} />
                </div>
                <div>
                  <div className="text-sm mb-1 opacity-80">Max total bounce %</div>
                  <Input name="autoThrottleMaxBouncePct" type="number" min="0" step="0.1" defaultValue={Math.round(((camp as any).autoThrottleMaxBounceRate ?? 0.12) * 1000) / 10} />
                </div>
                <div className="text-xs opacity-70 flex items-end">
                  Uses recent bounce events for this campaign+mailbox.
                </div>
              </div>
            </div>

            <Button type="submit">Save settings</Button>
          </form>
        </Card>

        <Card title="Sender routing" subtitle="Scale with pools + routing. Manual selection overrides pool. If both are empty, all active mailboxes are used.">
          <form action="/api/campaigns/updateSenders" method="post" className="grid gap-3">
            <input type="hidden" name="campaignId" value={camp.id} />

            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <div className="text-sm mb-1 opacity-80">Sender mode</div>
                <select
                  name="senderMode"
                  defaultValue={senderMode}
                  className="w-full px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-transparent"
                >
                  <option value="manual">Select mailboxes (manual)</option>
                  <option value="pool">Use pool</option>
                  <option value="all">All active</option>
                </select>
                <div className="text-xs opacity-60 mt-2">Note: If you select mailboxes below, the campaign will use those and ignore the pool.</div>
              </div>

              <div>
                <div className="text-sm mb-1 opacity-80">Pool (optional)</div>
                <select
                  name="mailboxPoolId"
                  defaultValue={currentPoolId}
                  className="w-full px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-transparent"
                >
                  <option value="">No pool</option>
                  {pools.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({(p as any)._count?.members || 0})
                    </option>
                  ))}
                </select>
                <div className="text-xs opacity-60 mt-2">Create/manage pools in <span className="font-medium">Mailboxes → Pools</span>.</div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-2">
              {allMailboxes.map((m) => (
                <label key={m.id} className="flex items-center gap-2 rounded-xl border border-black/10 dark:border-white/10 p-3">
                  <input type="checkbox" name="mailboxIds" value={m.id} defaultChecked={selectedIds.has(m.id)} />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{m.name}</div>
                    <div className="text-xs opacity-70 truncate">{m.fromEmail}</div>
                  </div>
                  <div className="ml-auto">
                    <Pill tone={m.isActive ? "success" : "warning"}>{m.isActive ? "active" : "inactive"}</Pill>
                  </div>
                </label>
              ))}
            </div>

            <Button type="submit">Save sender routing</Button>
          </form>
        </Card>

        <Card title="Stop rules" subtitle="Auto-stop enrollments based on replies, bounces, unsubscribes, and common patterns (OOO / not interested).">
          <form action="/api/campaigns/updateStopRules" method="post" className="grid gap-4">
            <input type="hidden" name="campaignId" value={camp.id} />

            <div className="grid md:grid-cols-2 gap-3">
              <label className="flex items-center gap-2 rounded-xl border border-black/10 dark:border-white/10 p-3">
                <input type="checkbox" name="stopOnReply" defaultChecked={camp.stopOnReply} />
                <div>
                  <div className="font-medium">Stop on reply</div>
                  <div className="text-xs opacity-70">Stops when the lead replies (default: ON).</div>
                </div>
              </label>

              <label className="flex items-center gap-2 rounded-xl border border-black/10 dark:border-white/10 p-3">
                <input type="checkbox" name="stopOnBounce" defaultChecked={camp.stopOnBounce} />
                <div>
                  <div className="font-medium">Stop on bounce</div>
                  <div className="text-xs opacity-70">Stops when a bounce is detected (default: ON).</div>
                </div>
              </label>

              <label className="flex items-center gap-2 rounded-xl border border-black/10 dark:border-white/10 p-3">
                <input type="checkbox" name="stopOnUnsubscribe" defaultChecked={(camp as any).stopOnUnsubscribe ?? true} />
                <div>
                  <div className="font-medium">Stop on unsubscribe</div>
                  <div className="text-xs opacity-70">Stops if lead clicks one-click unsubscribe or replies to opt out (default: ON).</div>
                </div>
              </label>

              <label className="flex items-center gap-2 rounded-xl border border-black/10 dark:border-white/10 p-3">
                <input type="checkbox" name="stopOnOOO" defaultChecked={(camp as any).stopOnOOO ?? true} />
                <div>
                  <div className="font-medium">Stop on OOO / auto-reply</div>
                  <div className="text-xs opacity-70">Stops and tags lead when reply looks like out-of-office (default: ON).</div>
                </div>
              </label>
            </div>

            <div className="grid md:grid-cols-3 gap-3">
              <div>
                <div className="text-sm mb-1 opacity-80">OOO keywords (comma separated)</div>
                <TextArea name="oooKeywords" defaultValue={(camp as any).oooKeywords || ""} placeholder="out of office, auto-reply, vacation" />
              </div>
              <div>
                <div className="text-sm mb-1 opacity-80">Not interested keywords (comma separated)</div>
                <TextArea name="notInterestedKeywords" defaultValue={(camp as any).notInterestedKeywords || ""} placeholder="not interested, no thanks, stop emailing" />
              </div>
              <div>
                <div className="text-sm mb-1 opacity-80">Generic stop keywords</div>
                <TextArea name="stopKeywords" defaultValue={(camp as any).stopKeywords || ""} placeholder="remove me, do not contact" />
              </div>
            </div>

            <Button type="submit">Save stop rules</Button>
          </form>
        </Card>

        <Card title="Danger zone" subtitle="Duplicate or archive campaigns (archive prevents future sends).">
          <div className="flex flex-wrap gap-2">
            <form action="/api/campaigns/duplicate" method="post">
              <input type="hidden" name="campaignId" value={camp.id} />
              <Button type="submit" variant="ghost">Duplicate campaign</Button>
            </form>

            <form action="/api/campaigns/archive" method="post">
              <input type="hidden" name="campaignId" value={camp.id} />
              <Button type="submit" variant="danger">{(camp as any).archivedAt ? "Unarchive" : "Archive"}</Button>
            </form>
          </div>

          <div className="text-xs opacity-60 mt-3">
            Archiving sets <code className="px-1 py-0.5 rounded border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/10">archivedAt</code>.
            The worker refuses to send from archived campaigns.
          </div>
        </Card>
      </div>
    </Container>
  );
}
