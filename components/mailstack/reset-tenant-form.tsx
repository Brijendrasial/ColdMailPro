"use client";

import * as React from "react";
import { Button, Badge } from "@/components/ui";

export function ResetTenantForm({
  tenantId,
  tenantName,
}: {
  tenantId: string;
  tenantName: string;
}) {
  const [deleteDns, setDeleteDns] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  return (
    <form
      action="/api/mailstack/tenant/reset"
      method="post"
      onSubmit={(e) => {
        const msg =
          `Reset tenant "${tenantName}"?\n\n` +
          `This will:\n` +
          `• delete the tenant from the app database\n` +
          `• delete imported mailboxes from the app\n` +
          `• remove /etc/mailstack/tenants/${tenantName} on the server\n` +
          `• rebuild Exim maps\n\n` +
          (deleteDns
            ? `AND delete Cloudflare DNS records created by Mailstack (A/MX/TXT).\n\n`
            : "") +
          `This cannot be undone.`;
        if (!window.confirm(msg)) {
          e.preventDefault();
          return;
        }
        setBusy(true);
      }}
      className="grid gap-2"
    >
      <input type="hidden" name="tenantId" value={tenantId} />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="deleteDns"
          value="1"
          checked={deleteDns}
          onChange={(e) => setDeleteDns(e.target.checked)}
        />
        Delete Cloudflare DNS records too
      </label>
      <div className="text-xs opacity-70">
        If enabled, we will delete <code>mail.&lt;domain&gt;</code> A, MX, SPF TXT, DKIM TXT, and DMARC TXT.
      </div>

      <div className="flex gap-2 items-center">
        <Button variant="danger" type="submit" disabled={busy}>
          {busy ? "Reset queued…" : "Reset tenant"}
        </Button>
        <Badge>Irreversible</Badge>
      </div>
    </form>
  );
}
