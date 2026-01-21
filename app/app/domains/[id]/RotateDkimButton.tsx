"use client";

import { Button } from "@/components/ui";

export default function RotateDkimButton({
  domainId,
  domainName,
  tenantId,
  tenantName,
}: {
  domainId: string;
  domainName: string;
  tenantId: string;
  tenantName: string;
}) {
  async function onRotate() {
    const msg =
      `Rotate DKIM keys for ${domainName}?\n\n` +
      `This will generate a NEW DKIM private key on the server and update the DNS record shown here.\n` +
      `You must paste the new TXT record into your domain panel for DKIM to PASS.\n\n` +
      `Tenant: ${tenantName}`;
    if (!confirm(msg)) return;

    const res = await fetch("/api/domains/rotate-dkim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domainId, tenantId }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(String(j?.error || "DKIM_ROTATE_FAILED"));
      return;
    }

    alert(`✅ DKIM rotation queued.\nJob: ${j?.jobId || "(unknown)"}\n\nRefresh this page in ~10-30 seconds to see the updated DKIM TXT record.`);
    window.location.reload();
  }

  return (
    <Button type="button" variant="ghost" onClick={onRotate}>
      Rotate DKIM (regenerate keys)
    </Button>
  );
}
