import Link from "next/link";
import { Container, Card, Button, Input, PageHeader, SegmentedNav } from "@/components/ui";
import MailboxesClient from "./MailboxesClient";
import { requireSession } from "@/lib/auth";


export default async function Mailboxes({ searchParams }: { searchParams?: { ok?: string; sent?: string; err?: string; to?: string; mid?: string } }) {
  await requireSession();
  return (
    <Container>
{searchParams?.ok ? (
  <div className="mb-4 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm">
    ✅ Mailbox saved.
  </div>
) : null}
{searchParams?.sent ? (
  <div className="mb-4 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm">
    ✅ Test email sent{searchParams.to ? ` to ${searchParams.to}` : ""}{searchParams.mid ? ` (message-id: ${searchParams.mid})` : ""}.
  </div>
) : null}
{searchParams?.err ? (
  <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm">
    ❌ {searchParams.err}
  </div>
) : null}
<PageHeader
        title="Mailboxes"
        subtitle="Add, verify, and monitor sender mailboxes."
        right={
          <SegmentedNav
            active="mailboxes"
            items={[
              { value: "mailboxes", label: "📮 Mailboxes", href: "/app/mailboxes" },
              { value: "pools", label: "🧺 Pools", href: "/app/mailboxes/pools" },
              { value: "warmup", label: "🔥 Warmup", href: "/app/mailboxes/warmup" },
            ]}
          />
        }
      />

      <div className="grid gap-4 mt-4">
        <Card title="Add mailbox">
          <form action="/api/mailboxes/create" method="post" className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm mb-1 opacity-80">Display name</div>
                <Input name="name" required placeholder="John" />
              </div>
              <div>
                <div className="text-sm mb-1 opacity-80">From email</div>
                <Input name="fromEmail" required placeholder="john@yourdomain.com" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm mb-1 opacity-80">SMTP Host</div>
                <Input name="smtpHost" required placeholder="smtp.yourdomain.com" />
              </div>
              <div>
                <div className="text-sm mb-1 opacity-80">SMTP Port</div>
                <Input name="smtpPort" type="number" required defaultValue="587" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm mb-1 opacity-80">SMTP User</div>
                <Input name="smtpUser" required />
              </div>
              <div>
                <div className="text-sm mb-1 opacity-80">SMTP Pass</div>
                <Input name="smtpPass" type="password" required />
              </div>
            </div>

<div className="mt-4 border-t border-black/10 pt-4">
  <div className="text-sm font-semibold mb-2">IMAP (optional, for reply detection)</div>
  <div className="grid grid-cols-3 gap-3">
    <div className="col-span-2">
      <div className="text-sm mb-1 opacity-80">IMAP Host</div>
      <Input name="imapHost" placeholder="imap.gmail.com" />
    </div>
    <div>
      <div className="text-sm mb-1 opacity-80">IMAP Port</div>
      <Input name="imapPort" type="number" defaultValue="993" />
    </div>
  </div>
  <div className="grid grid-cols-2 gap-3 mt-3">
    <div>
      <div className="text-sm mb-1 opacity-80">IMAP User</div>
      <Input name="imapUser" placeholder="same as fromEmail" />
    </div>
    <div>
      <div className="text-sm mb-1 opacity-80">IMAP Pass</div>
      <Input name="imapPass" type="password" />
    </div>
  </div>
  <label className="flex items-center gap-2 text-sm opacity-80 mt-3">
    <Input name="imapSecure" type="checkbox" defaultChecked />
    SSL (secure)
  </label>
  <label className="flex items-center gap-2 text-sm opacity-80 mt-2">
    <Input name="imapTlsSkipVerify" type="checkbox" />
    TEMP: Skip TLS certificate verification (fixes hostname mismatch)
  </label>
  <p className="text-xs opacity-70 mt-2">
    If configured, the worker will poll INBOX and auto-stop sequences on replies.
  </p>
</div>

            <div className="grid grid-cols-3 gap-3">
              <label className="flex items-center gap-2 text-sm opacity-80">
                <Input name="smtpSecure" type="checkbox" />
                SSL (secure)
              </label>
              <div>
                <div className="text-sm mb-1 opacity-80">Daily limit</div>
                <Input name="dailyLimit" type="number" defaultValue="50" min="1" />
              </div>
              <div>
                <div className="text-sm mb-1 opacity-80">Local bind IP (optional)</div>
                <Input name="localAddress" placeholder="15.204.x.x" />
              </div>
            </div>
            <Button type="submit">Save</Button>
          </form>
        </Card>

        <Card title="Existing">
          <MailboxesClient />
        </Card>
      </div>
    </Container>
  );
}
