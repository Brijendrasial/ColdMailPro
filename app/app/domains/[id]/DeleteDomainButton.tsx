"use client";

import { Button } from "@/components/ui";

export default function DeleteDomainButton({ domainId, domainName }: { domainId: string; domainName: string }) {
  async function onDelete() {
    if (!confirm(`Delete ${domainName}?\n\nThis removes the domain and all mailboxes using @${domainName} from the app.`)) return;
    const res = await fetch("/api/domains/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domainId }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(String(j?.error || "DELETE_FAILED"));
      return;
    }
    window.location.href = "/app/domains?deleted=1";
  }

  return (
    <Button type="button" variant="ghost" className="text-red-700" onClick={onDelete}>
      Delete domain
    </Button>
  );
}
