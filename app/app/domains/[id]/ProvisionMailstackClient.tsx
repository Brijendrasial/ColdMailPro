"use client";

import { useMemo, useState } from "react";
import { Button, Input, Pill, Textarea } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useDnsTab } from "./DomainDnsTabs";

type Props = {
  domainId: string;
  domainName: string;
  mailHost: string;
  expectedIp: string; // may be empty if not configured
  defaultTenantName: string;
  defaultServerIp?: string;
  defaultOutboundIps?: string[];
  defaultHeloTemplate?: string;
  defaultDmarcPolicy?: string;
  defaultDmarcRuaTemplate?: string;
  existingTenantId?: string;
  existingTenantName?: string;
  existingOutboundIps?: string[];
  existingServerIp?: string;
  existingHeloTemplate?: string;
  existingDmarcPolicy?: string;
  existingDmarcRuaTemplate?: string;
  initialResult?: any | null;
};

function getRequiredOk(r: any): boolean {
  if (!r) return false;
  if (typeof r?.summary?.requiredOk === "boolean") return !!r.summary.requiredOk;
  return !!(r?.records?.mx?.ok && r?.records?.mailA?.ok && r?.records?.spf?.ok && r?.records?.dkim?.ok && r?.records?.dmarc?.ok);
}

function tone(ok: any): any {
  if (ok === true) return "success";
  if (ok === false) return "danger";
  return "neutral";
}

export default function ProvisionMailstackClient(props: Props) {
  const {
    domainId,
    domainName,
    mailHost,
    expectedIp,
    defaultTenantName,
    defaultServerIp,
    defaultOutboundIps,
    defaultHeloTemplate,
    defaultDmarcPolicy,
    defaultDmarcRuaTemplate,
    existingTenantId,
    existingTenantName,
    existingOutboundIps,
    existingServerIp,
    existingHeloTemplate,
    existingDmarcPolicy,
    existingDmarcRuaTemplate,
    initialResult,
  } = props;

  const router = useRouter();
  const { tab } = useDnsTab();

  const [checking, setChecking] = useState(false);
  const [res, setRes] = useState<any | null>(initialResult ?? null);
  const [err, setErr] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState<string>("");

  const [tenantName, setTenantName] = useState(existingTenantName || defaultTenantName);
  const [senderName, setSenderName] = useState("");
  const [serverIp, setServerIp] = useState(existingServerIp || defaultServerIp || expectedIp || "");
  const [usersRaw, setUsersRaw] = useState("sales\ninfo\nsupport");
  const [ipsRaw, setIpsRaw] = useState(
    (existingOutboundIps?.length ? existingOutboundIps : defaultOutboundIps)?.join("\n") || ""
  );
  const [heloTemplate, setHeloTemplate] = useState(existingHeloTemplate || defaultHeloTemplate || "mail.%d");
  const [dmarcPolicy, setDmarcPolicy] = useState(existingDmarcPolicy || defaultDmarcPolicy || "none");
  const [dmarcRuaTemplate, setDmarcRuaTemplate] = useState(existingDmarcRuaTemplate || defaultDmarcRuaTemplate || "dmarc@%d");
  const [createZones, setCreateZones] = useState(false);

  const [detectIpsBusy, setDetectIpsBusy] = useState(false);

  async function detectOutboundIpsFromServer() {
    setDetectIpsBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/system/ips", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(j?.error || "FAILED"));
      const pub = Array.isArray(j?.publicIps) ? (j.publicIps as string[]) : [];
      const priv = Array.isArray(j?.privateIps) ? (j.privateIps as string[]) : [];
      const picked = pub.length ? pub : priv;
      setIpsRaw(picked.join("\n"));
      setOkMsg(`Detected ${picked.length} IP${picked.length === 1 ? "" : "s"} from this server.`);
    } catch (e: any) {
      setErr(String(e?.message || e || "FAILED"));
    } finally {
      setDetectIpsBusy(false);
    }
  }

  const requiredOk = useMemo(() => getRequiredOk(res), [res]);

  const mxOk = !!res?.records?.mx?.ok;
  const mailAOk = !!res?.records?.mailA?.ok;
  const spfOk = !!res?.records?.spf?.ok;
  const dkimOk = !!res?.records?.dkim?.ok;
  const dmarcOk = !!res?.records?.dmarc?.ok;

  const dkimNameDisplay: string = String(res?.records?.dkim?.name || `default._domainkey.${domainName}`);
  const dkimSelectorDisplay: string = dkimNameDisplay.split("._domainkey.")[0] || "default";

  const issues: string[] = Array.isArray(res?.summary?.issues) ? res.summary.issues : [];
  const checkedAt = res?.checkedAt ? new Date(res.checkedAt).toLocaleString() : "—";

  async function verify() {
    setChecking(true);
    setErr("");
    try {
      const r = await fetch("/api/domains/verify-dns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domainId, serverIp }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(j?.error || "VERIFY_FAILED"));
      setRes(j);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setChecking(false);
    }
  }

  async function postTenantAction(path: string) {
    if (!existingTenantId) return;
    setBusy(true);
    setErr("");
    setOkMsg("");
    try {
      const r = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ tenantId: existingTenantId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(j?.error || j?.message || "FAILED"));
      setOkMsg("Queued. Worker will run it in background.");
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  async function provision() {
    setBusy(true);
    setErr("");
    setOkMsg("");
    try {
      const r = await fetch("/api/domains/provision-mailstack", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          domainId,
          tenantName,
          senderName,
          serverIp,
          users: usersRaw,
          ips: ipsRaw,
          heloTemplate,
          dmarcPolicy,
          dmarcRuaTemplate,
          createZones: tab === "cloudflare" ? createZones : false,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(j?.error || j?.message || "PROVISION_FAILED"));
      setOkMsg(`Provision queued (job ${String(j?.jobId || "").slice(0, 8)}…).`);
      router.refresh();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs opacity-70">
          Verify DNS propagation (A/MX + SPF/DKIM/DMARC required). Last: <b>{checkedAt}</b>
        </div>
        <Button type="button" variant="ghost" onClick={verify} disabled={checking}>
          {checking ? "Verifying…" : "Verify DNS"}
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Pill tone={tone(requiredOk)}>{requiredOk ? "DNS ready" : "DNS not ready"}</Pill>
        <Pill tone={tone(mxOk)}>MX</Pill>
        <Pill tone={tone(mailAOk)}>A</Pill>
        <Pill tone={tone(spfOk)}>SPF</Pill>
        <Pill tone={tone(dkimOk)}>DKIM</Pill>
        <Pill tone={tone(dmarcOk)}>DMARC</Pill>
        <div className="text-xs opacity-70">mail host: <b>{mailHost}</b>{expectedIp ? <> · expected IP: <b>{expectedIp}</b></> : null}</div>
      </div>

      {err ? <div className="text-xs text-red-600">{err}</div> : null}
      {okMsg ? <div className="text-xs text-emerald-700">{okMsg}</div> : null}

      {issues.length ? (
        <div className="text-xs opacity-80">
          <div className="font-medium mb-1">What to fix</div>
          <ul className="list-disc pl-5">
            {issues.slice(0, 10).map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!expectedIp ? (
        <div className="text-xs text-red-600">
          Server IP is not set. Configure <b>Mailstack → Settings → Server IP</b> (or set <b>HOST_IP</b> in .env) to generate the correct A record.
        </div>
      ) : null}

      <div className="grid gap-3">
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <div className="text-sm mb-1 opacity-80">Tenant name</div>
            <Input value={tenantName} onChange={(e) => setTenantName(e.target.value)} required />
          </div>
          <div>
            <div className="text-sm mb-1 opacity-80">Server IP (mail A record must match)</div>
            <Input value={serverIp} onChange={(e) => setServerIp(e.target.value)} placeholder={expectedIp || "51.38.38.222"} />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <div className="text-sm mb-1 opacity-80">Outbound IPs (one per line)</div>
            <div className="flex items-center gap-2">
              <div className="text-xs opacity-70">Detect from server to avoid wrong IPs.</div>
              <div className="ml-auto">
                <Button type="button" variant="ghost" onClick={detectOutboundIpsFromServer} disabled={detectIpsBusy}>
                  {detectIpsBusy ? "Detecting…" : "Detect"}
                </Button>
              </div>
            </div>
            <Textarea value={ipsRaw} onChange={(e) => setIpsRaw(e.target.value)} rows={6} placeholder={"15.204.159.169\n15.204.159.170"} />
            <div className="text-xs opacity-70 mt-1">Add 2+ IPs to enable rotation. SPF suggestion will include them.</div>
          </div>
          <div>
            <div className="text-sm mb-1 opacity-80">Mailbox users (one per line)</div>
            <Textarea value={usersRaw} onChange={(e) => setUsersRaw(e.target.value)} rows={6} />
            <div className="text-xs opacity-70 mt-1">
              Use just the prefix (e.g. <b>sales</b>) to create <b>sales@{domainName}</b>. If you enter a full email it will be used as-is.
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          <div>
            <div className="text-sm mb-1 opacity-80">HELO template</div>
            <Input value={heloTemplate} onChange={(e) => setHeloTemplate(e.target.value)} />
            <div className="text-xs opacity-60 mt-1">%d = domain</div>
          </div>
          <div>
            <div className="text-sm mb-1 opacity-80">DMARC policy</div>
            <Input value={dmarcPolicy} onChange={(e) => setDmarcPolicy(e.target.value)} />
          </div>
          <div>
            <div className="text-sm mb-1 opacity-80">DMARC RUA template</div>
            <Input value={dmarcRuaTemplate} onChange={(e) => setDmarcRuaTemplate(e.target.value)} />
            <div className="text-xs opacity-60 mt-1">%d = domain</div>
          </div>
        </div>

        {tab === "cloudflare" ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={createZones} onChange={(e) => setCreateZones(e.target.checked)} />
            Create Cloudflare zones/records (if missing)
          </label>
        ) : null}

        <div className="flex items-center gap-2 flex-wrap">
          <Button type="button" onClick={provision} disabled={busy || !serverIp || !requiredOk}>
            {busy ? "Queuing…" : existingTenantId ? "Update & Re-provision" : "Provision & queue setup"}
          </Button>

          {existingTenantId ? (
            <a className="text-indigo-700 underline text-sm" href={`/app/mailstack/${existingTenantId}`}>Open tenant</a>
          ) : null}
        </div>

        <div className="grid gap-2">
          <div className="text-sm mb-1 opacity-80">Sender full name (display name)</div>
          <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="John Doe" />
        </div>

        {!requiredOk ? (
          <div className="text-xs opacity-70">
            Provisioning is disabled until DNS is ready. Add/propagate all required records:
            <ul className="list-disc pl-5 mt-1">
              <li><b>A</b> record: <b>{mailHost}</b> → <b>{expectedIp || "YOUR_SERVER_IP"}</b></li>
              <li><b>MX</b> record: <b>{domainName}</b> → <b>{mailHost}</b> (priority 10)</li>
              <li><b>SPF</b> TXT at root: <b>v=spf1 ...</b></li>
              <li>
                <b>DKIM</b> TXT: selector <b>{dkimSelectorDisplay}</b> at <b>{dkimNameDisplay}</b>
              </li>
              <li><b>DMARC</b> TXT at <b>_dmarc.{domainName}</b></li>
            </ul>
          </div>
        ) : null}

        {existingTenantId ? (
          <div className="mt-2 grid gap-2">
            <div className="text-sm font-medium">Tenant actions</div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button type="button" variant="ghost" onClick={() => postTenantAction("/api/mailstack/tenant/rotate")} disabled={busy}>Rotate now</Button>
              <Button type="button" variant="ghost" onClick={() => postTenantAction("/api/mailstack/tenant/sync")} disabled={busy}>DNS sync</Button>
              <Button type="button" variant="ghost" onClick={() => postTenantAction("/api/mailstack/tenant/rebuild")} disabled={busy}>Exim rebuild</Button>
              <Button type="button" variant="ghost" onClick={() => postTenantAction("/api/mailstack/tenant/ssl")} disabled={busy}>Issue SSL</Button>
              <a className="text-indigo-700 underline text-sm" href={`/api/mailstack/tenant/mailboxes?tenantId=${existingTenantId}`}>Download mailboxes CSV</a>
            </div>
            <div className="text-xs opacity-70">
              Rotation uses the tenant outbound IP list above. Add 2+ IPs, re-provision, then use <b>Rotate now</b>.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
