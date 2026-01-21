"use client";

import React, { useState } from "react";
import { Badge, Button } from "@/components/ui";

export default function DkimRotationPanel({
  domainId,
  domainName,
  tenantId,
  tenantName,
  hasPending,
  pendingSelector,
  hasCloudflareToken,
}: {
  domainId: string;
  domainName: string;
  tenantId: string;
  tenantName: string;
  hasPending: boolean;
  pendingSelector?: string | null;
  hasCloudflareToken: boolean;
}) {
  const [busy, setBusy] = useState<"stage" | "activate" | "rotate" | "sync" | null>(null);

  async function post(path: string, body: any) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(j?.error || j?.message || "REQUEST_FAILED"));
    return j;
  }

  async function onStage() {
    const msg =
      `Stage a NEW DKIM key for ${domainName}?\n\n` +
      `This is a zero‑downtime rotation step. It will generate a NEW selector + keypair,` +
      ` but your server will KEEP signing with the current selector until you click Activate.\n\n` +
      `After staging, publish the NEW DKIM TXT record (Manual DNS tab) or let Cloudflare sync it.\n\n` +
      `Tenant: ${tenantName}`;
    if (!confirm(msg)) return;
    setBusy("stage");
    try {
      const j = await post("/api/domains/dkim-stage", { domainId, tenantId });
      alert(
        `✅ DKIM staged.\nJob: ${j?.jobId || "(unknown)"}\n\n` +
          `Next: publish the staged DKIM TXT record, wait for DNS propagation, then click Activate.`
      );
      window.location.reload();
    } catch (e: any) {
      alert(String(e?.message || e || "DKIM_STAGE_FAILED"));
    } finally {
      setBusy(null);
    }
  }

  async function onActivate() {
    const msg =
      `Activate the STAGED DKIM selector for ${domainName}?\n\n` +
      `Only do this after the staged DKIM TXT exists in DNS (and has propagated).\n\n` +
      `Pending selector: ${pendingSelector || "(unknown)"}\n` +
      `Tenant: ${tenantName}`;
    if (!confirm(msg)) return;
    setBusy("activate");
    try {
      const j = await post("/api/domains/dkim-activate", { domainId, tenantId });
      alert(
        `✅ DKIM activated.\nJob: ${j?.jobId || "(unknown)"}\n\n` +
          `New emails will sign with the new selector.`
      );
      window.location.reload();
    } catch (e: any) {
      alert(String(e?.message || e || "DKIM_ACTIVATE_FAILED"));
    } finally {
      setBusy(null);
    }
  }

  async function onRotateImmediate() {
    const msg =
      `⚠️ Force immediate DKIM rotation for ${domainName}?\n\n` +
      `This regenerates keys AND switches signing immediately. DKIM will FAIL in Gmail until DNS is updated.\n\n` +
      `Tenant: ${tenantName}`;
    if (!confirm(msg)) return;
    setBusy("rotate");
    try {
      const j = await post("/api/domains/rotate-dkim", { domainId, tenantId });
      alert(
        `✅ Immediate DKIM rotation queued.\nJob: ${j?.jobId || "(unknown)"}\n\n` +
          `Refresh in ~10–30s to see the updated DKIM TXT record.`
      );
      window.location.reload();
    } catch (e: any) {
      alert(String(e?.message || e || "DKIM_ROTATE_FAILED"));
    } finally {
      setBusy(null);
    }
  }

  async function onDnsSync() {
    const msg =
      `Sync Cloudflare DNS from the SERVER for ${domainName}?\n\n` +
      `This overwrites DKIM TXT (and other mail DNS) in Cloudflare using the keys/records on the server.\n` +
      `Use this if you ever see a DKIM mismatch (DNS key != Exim key).\n\n` +
      `Tenant: ${tenantName}`;
    if (!confirm(msg)) return;
    setBusy("sync");
    try {
      const j = await post("/api/domains/dns-sync", { domainId, tenantId });
      alert(
        `✅ DNS sync queued.\nJob: ${j?.jobId || "(unknown)"}\n\n` +
          `Refresh this page in ~10–30s. Your DKIM TXT record should now match the server.`
      );
      window.location.reload();
    } catch (e: any) {
      alert(String(e?.message || e || "DNS_SYNC_FAILED"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge>tenant: {tenantName}</Badge>
        {hasCloudflareToken ? <Badge>cloudflare: connected</Badge> : <Badge>cloudflare: manual dns</Badge>}
        {hasPending ? (
          <Badge>pending selector: {pendingSelector}</Badge>
        ) : (
          <Badge>no pending selector</Badge>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onStage} disabled={busy !== null}>
          {busy === "stage" ? "Staging…" : hasPending ? "Stage DKIM again" : "Stage DKIM (safe)"}
        </Button>
        <Button type="button" variant="ghost" onClick={onActivate} disabled={busy !== null || !hasPending}>
          {busy === "activate" ? "Activating…" : "Activate staged DKIM"}
        </Button>

        {hasCloudflareToken ? (
          <Button type="button" variant="ghost" onClick={onDnsSync} disabled={busy !== null}>
            {busy === "sync" ? "Syncing DNS…" : "Sync DNS now"}
          </Button>
        ) : null}

        <Button
          type="button"
          variant="ghost"
          onClick={onRotateImmediate}
          disabled={busy !== null}
          title="Legacy behavior: rotates and switches signing immediately (can cause DKIM fail until DNS updates)"
        >
          Force rotate now (legacy)
        </Button>
      </div>

      <div className="text-xs opacity-70">
        Recommended: <b>Stage</b> → publish the new TXT (Manual DNS tab, or Cloudflare sync) → wait for propagation → <b>Activate</b>.
        This avoids the Gmail <b>dkim=fail</b> window you saw when rotating keys.
      </div>
    </div>
  );
}
