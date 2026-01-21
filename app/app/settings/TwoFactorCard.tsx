"use client";

import React, { useMemo, useState } from "react";
import { Button, Input, Modal, Pill } from "@/components/ui";

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

function downloadTextFile(filename: string, content: string) {
  try {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    // ignore
  }
}

export default function TwoFactorCard(props: {
  enabled: boolean;
  enabledAt?: string | null;
  recoveryCount: number;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Enable flow
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupQr, setSetupQr] = useState<string | null>(null);
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [setupToken, setSetupToken] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  // Regenerate/Disable flows
  const [regenOpen, setRegenOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [recovery, setRecovery] = useState("");
  const [newRecoveryCodes, setNewRecoveryCodes] = useState<string[] | null>(null);

  const enabledLabel = props.enabled ? "Enabled" : "Not enabled";
  const enabledTone = props.enabled ? "success" : "neutral";

  const canVerifySetup = useMemo(() => setupToken.trim().length >= 6, [setupToken]);

  async function startSetup() {
    setNotice(null);
    setError(null);
    setRecoveryCodes(null);
    setSetupToken("");
    setBusy(true);
    try {
      const res = await fetch("/api/settings/2fa/start", { method: "POST" });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Failed to start 2FA setup");
      setSetupQr(String(j.qrDataUrl || ""));
      setSetupSecret(String(j.manualSecret || ""));
      setSetupOpen(true);
    } catch (e: any) {
      setError(e?.message || "Failed to start 2FA setup");
    } finally {
      setBusy(false);
    }
  }

  async function verifyAndEnable() {
    setNotice(null);
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/settings/2fa/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: setupToken.trim() }),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Invalid code");
      const codes = Array.isArray(j.recoveryCodes) ? j.recoveryCodes.map(String) : [];
      setRecoveryCodes(codes);
      setNotice("2FA enabled. Save your recovery codes now.");
    } catch (e: any) {
      setError(e?.message || "Failed to enable 2FA");
    } finally {
      setBusy(false);
    }
  }

  async function regenerateRecoveryCodes() {
    setNotice(null);
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/settings/2fa/recovery/regenerate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, token: token.trim() }),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Failed to regenerate");
      const codes = Array.isArray(j.recoveryCodes) ? j.recoveryCodes.map(String) : [];
      setNewRecoveryCodes(codes);
      setNotice("New recovery codes generated. Save them now — old codes are invalid.");
    } catch (e: any) {
      setError(e?.message || "Failed to regenerate recovery codes");
    } finally {
      setBusy(false);
    }
  }

  async function disable2fa() {
    setNotice(null);
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/settings/2fa/disable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, token: token.trim(), recovery: recovery.trim() }),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Failed to disable 2FA");
      window.location.href = "/app/settings?ok=2FA%20disabled";
    } catch (e: any) {
      setError(e?.message || "Failed to disable 2FA");
    } finally {
      setBusy(false);
    }
  }

  function finishEnable() {
    // Redirect so server component re-renders with enabled state.
    window.location.href = "/app/settings?ok=2FA%20enabled";
  }

  const recoveryText = (codes: string[]) =>
    `ColdMail Pro — Recovery Codes\n\n` +
    `Each code can be used once. Store securely.\n\n` +
    codes.map((c) => `- ${c}`).join("\n") +
    "\n";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white/60 p-4">
      {notice ? <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm">✅ {notice}</div> : null}
      {error ? <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm">❌ {error}</div> : null}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium text-slate-900">Two-factor authentication (2FA)</div>
            <Pill tone={enabledTone as any}>{enabledLabel}</Pill>
          </div>
          <div className="text-xs text-slate-600 mt-1">
            Use an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password) and backup codes.
          </div>
          {props.enabled ? (
            <div className="mt-2 text-xs text-slate-700">
              Backup codes remaining: <span className="font-mono font-semibold">{props.recoveryCount}</span>
              {props.enabledAt ? <span className="text-slate-500"> · enabled {new Date(props.enabledAt).toLocaleString()}</span> : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {!props.enabled ? (
            <Button type="button" variant="primary" disabled={busy} onClick={startSetup}>
              {busy ? "Working…" : "Enable 2FA"}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setPassword("");
                  setToken("");
                  setNewRecoveryCodes(null);
                  setRegenOpen(true);
                }}
              >
                Regenerate backup codes
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setPassword("");
                  setToken("");
                  setRecovery("");
                  setDisableOpen(true);
                }}
              >
                Disable
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Enable modal */}
      {setupOpen ? (
        <Modal
          title={recoveryCodes ? "Save your recovery codes" : "Enable 2FA"}
          onClose={() => {
            if (busy) return;
            setSetupOpen(false);
            setSetupQr(null);
            setSetupSecret(null);
            setSetupToken("");
            setRecoveryCodes(null);
          }}
        >
          {!recoveryCodes ? (
            <div className="grid gap-4">
              <div className="grid md:grid-cols-2 gap-4 items-start">
                <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
                  <div className="text-sm font-medium text-slate-900">1) Scan QR code</div>
                  <div className="text-xs text-slate-600 mt-1">Open your authenticator app and scan this code.</div>
                  {setupQr ? (
                    <img
                      src={setupQr}
                      alt="2FA QR"
                      className="mt-3 rounded-xl border border-slate-200 bg-white p-3"
                    />
                  ) : null}
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
                  <div className="text-sm font-medium text-slate-900">Manual key (backup)</div>
                  <div className="text-xs text-slate-600 mt-1">If you can’t scan, enter this key in your app.</div>
                  <div className="mt-3 flex gap-2 items-stretch">
                    <Input readOnly value={setupSecret || ""} className="font-mono" />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={async () => {
                        if (!setupSecret) return;
                        const ok = await copyToClipboard(setupSecret);
                        setNotice(ok ? "Copied." : "Copy failed.");
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                  <div className="mt-4">
                    <div className="text-sm font-medium text-slate-900">2) Enter the 6‑digit code</div>
                    <div className="text-xs text-slate-600 mt-1">Type the current code from your app to confirm setup.</div>
                    <div className="mt-2 flex gap-2 items-stretch">
                      <Input
                        value={setupToken}
                        onChange={(e) => setSetupToken(e.target.value)}
                        inputMode="numeric"
                        placeholder="123456"
                        className="font-mono"
                      />
                      <Button
                        type="button"
                        variant="primary"
                        disabled={!canVerifySetup || busy}
                        onClick={verifyAndEnable}
                      >
                        {busy ? "Verifying…" : "Verify"}
                      </Button>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">Tip: if the code keeps failing, check server time and your phone time.</div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
                <div className="font-medium">Important</div>
                <div className="text-slate-700 mt-1">
                  After you verify, we will show you recovery codes once. Save them in a password manager.
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                <div className="font-medium">2FA is enabled ✅</div>
                <div className="text-sm text-slate-700 mt-1">Save these recovery codes now. Each code can be used once.</div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-sm font-medium text-slate-900">Recovery codes</div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={async () => {
                        const ok = await copyToClipboard(recoveryCodes.join("\n"));
                        setNotice(ok ? "Copied recovery codes." : "Copy failed.");
                      }}
                    >
                      Copy
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => downloadTextFile("coldmail-pro-recovery-codes.txt", recoveryText(recoveryCodes))}
                    >
                      Download
                    </Button>
                  </div>
                </div>

                <div className="mt-3 grid sm:grid-cols-2 gap-2">
                  {recoveryCodes.map((c) => (
                    <div key={c} className="font-mono text-sm rounded-xl border border-slate-200 bg-white px-3 py-2">
                      {c}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <Button type="button" variant="primary" onClick={finishEnable}>
                  I saved them
                </Button>
              </div>
            </div>
          )}
        </Modal>
      ) : null}

      {/* Regenerate modal */}
      {regenOpen ? (
        <Modal
          title="Regenerate recovery codes"
          onClose={() => {
            if (busy) return;
            setRegenOpen(false);
            setNewRecoveryCodes(null);
          }}
        >
          {newRecoveryCodes ? (
            <div className="grid gap-4">
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
                <div className="font-medium">New recovery codes generated</div>
                <div className="mt-1 text-slate-700">Old codes are now invalid. Save these now.</div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-sm font-medium text-slate-900">Recovery codes</div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={async () => {
                        const ok = await copyToClipboard(newRecoveryCodes.join("\n"));
                        setNotice(ok ? "Copied recovery codes." : "Copy failed.");
                      }}
                    >
                      Copy
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => downloadTextFile("coldmail-pro-recovery-codes.txt", recoveryText(newRecoveryCodes))}
                    >
                      Download
                    </Button>
                  </div>
                </div>
                <div className="mt-3 grid sm:grid-cols-2 gap-2">
                  {newRecoveryCodes.map((c) => (
                    <div key={c} className="font-mono text-sm rounded-xl border border-slate-200 bg-white px-3 py-2">
                      {c}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <Button type="button" variant="primary" onClick={() => window.location.href = "/app/settings?ok=Recovery%20codes%20updated"}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="text-sm text-slate-700">
                For security, confirm your password and a current authenticator code.
              </div>
              <div>
                <div className="text-sm mb-1 opacity-80">Password</div>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div>
                <div className="text-sm mb-1 opacity-80">2FA code</div>
                <Input value={token} onChange={(e) => setToken(e.target.value)} inputMode="numeric" placeholder="123456" className="font-mono" />
              </div>
              <div className="flex justify-end gap-2 mt-2">
                <Button type="button" variant="secondary" onClick={() => setRegenOpen(false)} disabled={busy}>Cancel</Button>
                <Button type="button" variant="primary" onClick={regenerateRecoveryCodes} disabled={busy || !password || token.trim().length < 6}>
                  {busy ? "Working…" : "Generate"}
                </Button>
              </div>
            </div>
          )}
        </Modal>
      ) : null}

      {/* Disable modal */}
      {disableOpen ? (
        <Modal
          title="Disable 2FA"
          onClose={() => {
            if (busy) return;
            setDisableOpen(false);
          }}
        >
          <div className="grid gap-3">
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm">
              <div className="font-medium">This reduces account security</div>
              <div className="mt-1 text-slate-700">Confirm your password and either a 2FA code or a recovery code.</div>
            </div>

            <div>
              <div className="text-sm mb-1 opacity-80">Password</div>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <div className="text-sm mb-1 opacity-80">2FA code</div>
                <Input value={token} onChange={(e) => setToken(e.target.value)} inputMode="numeric" placeholder="123456" className="font-mono" />
              </div>
              <div>
                <div className="text-sm mb-1 opacity-80">Recovery code (optional)</div>
                <Input value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="ABCD-EFGH-IJKL" className="font-mono" />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-2">
              <Button type="button" variant="secondary" onClick={() => setDisableOpen(false)} disabled={busy}>Cancel</Button>
              <Button
                type="button"
                variant="danger"
                onClick={disable2fa}
                disabled={busy || !password || (!token.trim() && !recovery.trim())}
              >
                {busy ? "Disabling…" : "Disable 2FA"}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
