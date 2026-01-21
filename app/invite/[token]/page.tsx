import Link from "next/link";
import crypto from "crypto";
import { Container, Card, Button, Input, Pill } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export default async function InvitePage({ params }: { params: { token: string } }) {
  const token = String(params.token || "");
  const tokenHash = sha256(token);
  const inv = await prisma.workspaceInvite.findFirst({
    where: { tokenHash },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      usedAt: true,
      workspace: { select: { name: true } },
    },
  });

  const now = Date.now();
  const expired = inv?.expiresAt ? inv.expiresAt.getTime() < now : false;
  const used = !!inv?.usedAt;

  const s = await getSession();
  // We can only check match if we fetch user email
  let sessionEmail: string | null = null;
  if (s) {
    const u = await prisma.user.findUnique({ where: { id: s.uid }, select: { email: true } });
    sessionEmail = u?.email || null;
  }
  const matches = !!(sessionEmail && inv && inv.email.toLowerCase() === sessionEmail.toLowerCase());

  return (
    <Container>
      <div className="max-w-2xl mx-auto grid gap-6">
        <Card
          title="Workspace invite"
          subtitle="Join a workspace securely using a signed invite link."
          right={<Pill tone={inv && !used && !expired ? "success" : "warning"}>Invite</Pill>}
        >
          {!inv ? (
            <div className="text-sm text-slate-700">This invite link is invalid (not found).</div>
          ) : used ? (
            <div className="text-sm text-slate-700">This invite has already been used.</div>
          ) : expired ? (
            <div className="text-sm text-slate-700">This invite has expired. Ask your admin to regenerate it.</div>
          ) : (
            <div className="grid gap-4">
              <div className="rounded-2xl border border-slate-200 bg-white/60 p-4">
                <div className="text-xs text-slate-600">Workspace</div>
                <div className="mt-1 font-medium text-slate-900">{inv.workspace.name}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Pill tone="info">Email: {inv.email}</Pill>
                  <Pill tone={inv.role === "admin" ? "info" : "neutral"}>Role: {inv.role}</Pill>
                  {inv.expiresAt ? <Pill tone="warning">Expires: {inv.expiresAt.toLocaleString()}</Pill> : null}
                </div>
              </div>

              {s ? (
                <div className="rounded-2xl border border-slate-200 bg-white/60 p-4">
                  <div className="text-sm font-medium text-slate-900">Accept with existing account</div>
                  <div className="text-xs text-slate-600 mt-1">
                    Signed in as <span className="font-mono">{sessionEmail}</span>
                  </div>
                  {!matches ? (
                    <div className="mt-3 text-sm text-slate-700">
                      This invite is for <span className="font-mono">{inv.email}</span>. Please sign in with that email to accept.
                    </div>
                  ) : (
                    <form action={`/api/invite/${token}/accept`} method="post" className="mt-3">
                      <Button type="submit" variant="primary">
                        Accept invite
                      </Button>
                    </form>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white/60 p-4">
                  <div className="text-sm font-medium text-slate-900">Create account and accept</div>
                  <div className="text-xs text-slate-600 mt-1">
                    No account found on this browser. Create an account for <span className="font-mono">{inv.email}</span>.
                  </div>

                  <form action={`/api/invite/${token}/accept-new`} method="post" className="mt-4 grid gap-3">
                    <div>
                      <div className="text-sm mb-1 opacity-80">Name (optional)</div>
                      <Input name="name" placeholder="Your name" />
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <div className="text-sm mb-1 opacity-80">Password</div>
                        <Input type="password" name="password" required placeholder="Min 8 chars" />
                      </div>
                      <div>
                        <div className="text-sm mb-1 opacity-80">Confirm</div>
                        <Input type="password" name="confirm" required placeholder="Repeat" />
                      </div>
                    </div>
                    <Button type="submit" variant="primary">
                      Create account + join
                    </Button>
                  </form>

                  <div className="mt-3 text-xs text-slate-600">
                    Already have an account? <Link className="underline" href="/login">Sign in</Link> then open the invite link again.
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
        <div className="text-xs text-slate-500">
          Security note: invite links expire and can be revoked. If you didn’t expect this invite, close this page.
        </div>
      </div>
    </Container>
  );
}
