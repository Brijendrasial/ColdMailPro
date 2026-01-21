"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

export default function DnsCheckButton({ domainId, disabled }: { domainId: string; disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/domains/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domainId }),
      });
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <Button type="button" variant="ghost" onClick={run} disabled={!!disabled || busy}>
      {busy || disabled ? "Checking…" : "Run check"}
    </Button>
  );
}
