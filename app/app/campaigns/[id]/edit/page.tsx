import { Container, Card, Input, TextArea, Button } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function EditSteps({ params }: { params: { id: string } }) {
  const s = await requireSession();
  const camp = await prisma.campaign.findFirst({
    where: { id: params.id, workspaceId: s.wid },
    include: { steps: { orderBy: { stepNumber: "asc" }, include: { variants: { orderBy: { createdAt: "asc" } } } } },
  });
  if (!camp)
    return (
      <Container>
        <Card title="Not found">Campaign not found.</Card>
      </Container>
    );

  const step1: any = camp.steps.find((x: any) => x.stepNumber === 1);
  const step2: any = camp.steps.find((x: any) => x.stepNumber === 2);

  const vA = (step: any) => (step?.variants || []).find((v: any) => String(v.name || "").toUpperCase() === "A") || null;
  const vB = (step: any) => (step?.variants || []).find((v: any) => String(v.name || "").toUpperCase() === "B") || null;

  const step1B = vB(step1);
  const step2B = vB(step2);

  return (
    <Container>
      <div className="max-w-4xl grid gap-4">
        <Card title={`Edit steps: ${camp.name}`}>
          <form action="/api/campaigns/updateSteps" method="post" className="grid gap-6">
            <input type="hidden" name="campaignId" value={camp.id} />

            <div className="rounded-2xl border border-black/10 dark:border-white/10 p-4">
              <div className="font-semibold mb-3">Step 1</div>
              <div className="grid gap-3">
                <div>
                  <div className="text-sm mb-1 opacity-80">Subject</div>
                  <Input name="s1_subject" defaultValue={step1?.subjectTpl || ""} required />
                </div>
                <div>
                  <div className="text-sm mb-1 opacity-80">Body (text)</div>
                  <TextArea name="s1_body" defaultValue={step1?.bodyTpl || ""} required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-sm mb-1 opacity-80">Delay days</div>
                    <Input name="s1_delay" type="number" min="0" defaultValue={step1?.delayDays ?? 0} />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm opacity-80">
                      <input name="s1_isReply" type="checkbox" defaultChecked={step1?.isReply ?? false} />
                      Send as reply
                    </label>
                  </div>
                </div>

                <div className="rounded-xl border border-black/10 dark:border-white/10 p-3 bg-black/5 dark:bg-white/5">
                  <label className="flex items-center gap-2 text-sm">
                    <input name="s1_abEnabled" type="checkbox" defaultChecked={Boolean(step1?.abEnabled)} />
                    <span className="font-medium">Enable A/B test for Step 1</span>
                  </label>
                  <div className="text-xs opacity-70 mt-1">
                    Variant A uses the main Subject/Body above. Variant B below will be randomly (deterministically) assigned per lead using weights.
                  </div>

                  <div className="mt-3 grid gap-3">
                    <div>
                      <div className="text-sm mb-1 opacity-80">Variant B Subject</div>
                      <Input name="s1_b_subject" defaultValue={step1B?.subjectTpl || ""} placeholder="Alt subject" />
                    </div>
                    <div>
                      <div className="text-sm mb-1 opacity-80">Variant B Body (text)</div>
                      <TextArea name="s1_b_body" defaultValue={step1B?.bodyTpl || ""} placeholder="Alt body" />
                    </div>
                    <div className="grid md:grid-cols-2 gap-3">
                      <div>
                        <div className="text-sm mb-1 opacity-80">Variant B traffic %</div>
                        <Input name="s1_b_weight" type="number" min="0" max="100" defaultValue={step1B?.weight ?? 50} />
                      </div>
                      <div className="text-xs opacity-70 flex items-end">
                        Example: 50 means 50% B, 50% A. Set 0 to disable B.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-black/10 dark:border-white/10 p-4">
              <div className="font-semibold mb-3">Step 2</div>
              <div className="grid gap-3">
                <div>
                  <div className="text-sm mb-1 opacity-80">Subject</div>
                  <Input name="s2_subject" defaultValue={step2?.subjectTpl || ""} required />
                </div>
                <div>
                  <div className="text-sm mb-1 opacity-80">Body (text)</div>
                  <TextArea name="s2_body" defaultValue={step2?.bodyTpl || ""} required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-sm mb-1 opacity-80">Delay days</div>
                    <Input name="s2_delay" type="number" min="0" defaultValue={step2?.delayDays ?? 2} />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm opacity-80">
                      <input name="s2_isReply" type="checkbox" defaultChecked={step2?.isReply ?? true} />
                      Send as reply
                    </label>
                  </div>
                </div>

                <div className="rounded-xl border border-black/10 dark:border-white/10 p-3 bg-black/5 dark:bg-white/5">
                  <label className="flex items-center gap-2 text-sm">
                    <input name="s2_abEnabled" type="checkbox" defaultChecked={Boolean(step2?.abEnabled)} />
                    <span className="font-medium">Enable A/B test for Step 2</span>
                  </label>
                  <div className="text-xs opacity-70 mt-1">
                    Variant A uses the main Subject/Body above. Variant B below will be assigned per lead.
                  </div>

                  <div className="mt-3 grid gap-3">
                    <div>
                      <div className="text-sm mb-1 opacity-80">Variant B Subject</div>
                      <Input name="s2_b_subject" defaultValue={step2B?.subjectTpl || ""} placeholder="Alt subject" />
                    </div>
                    <div>
                      <div className="text-sm mb-1 opacity-80">Variant B Body (text)</div>
                      <TextArea name="s2_b_body" defaultValue={step2B?.bodyTpl || ""} placeholder="Alt body" />
                    </div>
                    <div className="grid md:grid-cols-2 gap-3">
                      <div>
                        <div className="text-sm mb-1 opacity-80">Variant B traffic %</div>
                        <Input name="s2_b_weight" type="number" min="0" max="100" defaultValue={step2B?.weight ?? 50} />
                      </div>
                      <div className="text-xs opacity-70 flex items-end">Example: 30 means 30% B, 70% A.</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="text-sm opacity-70">
              Variables:{" "}
              <code className="px-1 py-0.5 rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/10">
                {`{{firstName}} {{lastName}} {{email}} {{company}} {{website}} {{senderName}} {{senderEmail}}`}
              </code>
            </div>

            <Button type="submit">Save steps</Button>
          </form>
        </Card>
      </div>
    </Container>
  );
}
