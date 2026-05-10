"use client";

import React, { useMemo, useState } from "react";
import { Button, Input, Pill, Textarea } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useDnsTab } from "./DomainDnsTabs";

type Props = {
  domainId: string;
  domainName: string;
  mailHost: string;
  expectedIp: string;
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

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</span>
      {children}
      {hint ? <span className="text-xs leading-5 text-slate-500">{hint}</span> : null}
    </label>
  );
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
    <div className="grid gap-5">
      <div className="flex flex-col gap-4 rounded-[1.5rem] border border-slate-200/80 bg-slate-50/80 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-950">Provisioning readiness</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">Verify DNS propagation before creating mailboxes. Last check: <b>{checkedAt}</b></div>
        </div>
        <Button type="button" variant="ghost" onClick={verify} disabled={checking}>
          {checking ? "Verifying…" : "Verify DNS"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Pill tone={tone(requiredOk)}>{requiredOk ? "DNS ready" : "DNS not ready"}</Pill>
        <Pill tone={tone(mxOk)}>MX</Pill>
        <Pill tone={tone(mailAOk)}>A record</Pill>
        <Pill tone={tone(spfOk)}>SPF</Pill>
        <Pill tone={tone(dkimOk)}>DKIM</Pill>
        <Pill tone={tone(dmarcOk)}>DMARC</Pill>
      </div>

      <div className="rounded-[1.35rem] border border-slate-200/80 bg-white/85 p-4 text-xs leading-5 text-slate-600">
        Mail host: <b className="text-slate-900">{mailHost}</b>{expectedIp ? <> · expected IP: <b className="text-slate-900">{expectedIp}</b></> : null}
      </div>

      {err ? <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700">{err}</div> : null}
      {okMsg ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-700">{okMsg}</div> : null}

      {issues.length ? (
        <div className="rounded-[1.35rem] border border-amber-200 bg-amber-50/80 p-4">
          <div className="text-sm font-semibold text-amber-950">What to fix before provisioning</div>
          <ul className="mt-2 grid gap-2 text-xs leading-5 text-amber-900">
            {issues.slice(0, 10).map((x, i) => (
              <li key={i} className="rounded-xl bg-white/60 px-3 py-2">{x}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!expectedIp ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700">
          Server IP is not set. Configure <b>Mailstack → Settings → Server IP</b> or set <b>HOST_IP</b> in .env to generate the correct A record.
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid gap-4 rounded-[1.6rem] border border-slate-200/80 bg-white/90 p-5">
          <div>
            <div className="text-sm font-semibold text-slate-950">Tenant setup</div>
            <div className="mt-1 text-xs text-slate-500">Name the tenant and point it to the server/IP pool that will send mail.</div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Tenant name">
              <Input value={tenantName} onChange={(e) => setTenantName(e.target.value)} required />
            </Field>
            <Field label="Server IP" hint="The mail A record must match this IP.">
              <Input value={serverIp} onChange={(e) => setServerIp(e.target.value)} placeholder={expectedIp || "51.38.38.222"} />
            </Field>
          </div>
          <Field label="Outbound IPs" hint="Add two or more IPs to enable rotation. SPF suggestions will include these.">
            <div className="grid gap-2">
              <div className="flex justify-end">
                <Button type="button" variant="ghost" onClick={detectOutboundIpsFromServer} disabled={detectIpsBusy}>
                  {detectIpsBusy ? "Detecting…" : "Detect from server"}
                </Button>
              </div>
              <Textarea value={ipsRaw} onChange={(e) => setIpsRaw(e.target.value)} rows={7} placeholder={"15.204.159.169\n15.204.159.170"} className="font-mono text-sm" />
            </div>
          </Field>
        </div>

        <div className="grid gap-4 rounded-[1.6rem] border border-slate-200/80 bg-white/90 p-5">
          <div>
            <div className="text-sm font-semibold text-slate-950">Mailbox defaults</div>
            <div className="mt-1 text-xs text-slate-500">Create sender prefixes and optional display name for generated mailboxes.</div>
          </div>
          <Field label="Mailbox users" hint={<>Use prefixes like <b>sales</b> to create <b>sales@{domainName}</b>. Full emails are also accepted.</>}>
            <Textarea value={usersRaw} onChange={(e) => setUsersRaw(e.target.value)} rows={7} className="font-mono text-sm" />
          </Field>
          <Field label="Sender full name">
            <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="John Doe" />
          </Field>
        </div>
      </div>

      <div className="grid gap-4 rounded-[1.6rem] border border-slate-200/80 bg-white/90 p-5 lg:grid-cols-3">
        <Field label="HELO template" hint="%d = domain">
          <Input value={heloTemplate} onChange={(e) => setHeloTemplate(e.target.value)} />
        </Field>
        <Field label="DMARC policy">
          <Input value={dmarcPolicy} onChange={(e) => setDmarcPolicy(e.target.value)} />
        </Field>
        <Field label="DMARC RUA template" hint="%d = domain">
          <Input value={dmarcRuaTemplate} onChange={(e) => setDmarcRuaTemplate(e.target.value)} />
        </Field>
      </div>

      {tab === "cloudflare" ? (
        <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/85 px-4 py-3 text-sm text-slate-700">
          <input type="checkbox" checked={createZones} onChange={(e) => setCreateZones(e.target.checked)} />
          Create Cloudflare zones/records if missing
        </label>
      ) : null}

      {!requiredOk ? (
        <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 p-4 text-xs leading-6 text-slate-600">
          <div className="font-semibold text-slate-950">Provisioning is disabled until DNS is ready.</div>
          <ul className="mt-2 grid gap-1 pl-4 list-disc">
            <li><b>A</b> record: <b>{mailHost}</b> → <b>{expectedIp || "YOUR_SERVER_IP"}</b></li>
            <li><b>MX</b> record: <b>{domainName}</b> → <b>{mailHost}</b> priority 10</li>
            <li><b>SPF</b> TXT at root: <b>v=spf1 ...</b></li>
            <li><b>DKIM</b> TXT selector <b>{dkimSelectorDisplay}</b> at <b>{dkimNameDisplay}</b></li>
            <li><b>DMARC</b> TXT at <b>_dmarc.{domainName}</b></li>
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-[1.6rem] border border-slate-200/80 bg-slate-950 p-5 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold">Ready to provision?</div>
          <div className="mt-1 text-xs leading-5 text-slate-300">This queues tenant setup, mailbox creation, Exim/Dovecot rebuilds, and DNS-related defaults.</div>
        </div>
        <Button type="button" onClick={provision} disabled={busy || !serverIp || !requiredOk}>
          {busy ? "Queuing…" : existingTenantId ? "Update & re-provision" : "Provision & queue setup"}
        </Button>
      </div>

      {existingTenantId ? (
        <div className="rounded-[1.6rem] border border-slate-200/80 bg-white/90 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-950">Tenant actions</div>
              <div className="mt-1 text-xs text-slate-500">Run maintenance actions after IP or DNS changes.</div>
            </div>
            <a className="text-sm font-semibold text-indigo-700 underline" href={`/app/mailstack/${existingTenantId}`}>Open tenant</a>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" onClick={() => postTenantAction("/api/mailstack/tenant/rotate")} disabled={busy}>Rotate now</Button>
            <Button type="button" variant="ghost" onClick={() => postTenantAction("/api/mailstack/tenant/sync")} disabled={busy}>DNS sync</Button>
            <Button type="button" variant="ghost" onClick={() => postTenantAction("/api/mailstack/tenant/rebuild")} disabled={busy}>Exim rebuild</Button>
            <Button type="button" variant="ghost" onClick={() => postTenantAction("/api/mailstack/tenant/ssl")} disabled={busy}>Issue SSL</Button>
            <a className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-2.5 text-sm font-semibold text-indigo-700 shadow-sm" href={`/api/mailstack/tenant/mailboxes?tenantId=${existingTenantId}`}>Download mailboxes CSV</a>
          </div>
          <div className="mt-3 text-xs leading-5 text-slate-500">Rotation uses the tenant outbound IP list above. Add 2+ IPs, re-provision, then use Rotate now.</div>
        </div>
      ) : null}
    </div>
  );
}
