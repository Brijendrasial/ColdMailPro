# Hotfix fixed15

- Fixed AIOps agent crash in `check_ports()` caused by stray `complex` / `details` references under `set -u`.
- Keeps fixed14 deeper service intelligence intact.

## Important notes / next improvements

## v1.75 Hotfix: AIOps agent logging + service detection
- AIOps agent now ensures `/var/log/coldmail-aiops.log` exists so `tail -f` works even when there are no incidents.
- Service existence detection now uses `systemctl list-unit-files --type=service --no-legend --no-pager` and exact matching to avoid skipping checks due to header/formatting differences.

### DKIM signing
This starter **generates DKIM keys** and shows DNS records, but it does not yet DKIM-sign outbound messages.
You can add DKIM signing in two ways:
1) Sign at the MTA layer (recommended): Postfix/Exim with OpenDKIM.
2) Sign in-app: use a DKIM signer library for NodeMailer and load private key from `Domain.dkimPrivate`.

### Reply detection
This starter doesn't yet connect to IMAP to mark replies automatically.
Common approach:
- Add IMAP creds per mailbox
- Poll inbox every N minutes and parse In-Reply-To / References headers, match to Message.messageId
- Mark Enrollment stopped on reply (if enabled)

### Deliverability
For real cold mailing:
- rotate content variants
- throttle per mailbox
- warm-up sender domains/IPs
- monitor bounces and complaints

---

## Patch notes (AIOps)

- AIOps agent now writes incidents with a **workspaceId** so they appear in **Settings → System → Incidents**.
  - Auto-detects the earliest workspace from DB.
  - Optional override: set `AIOPS_WORKSPACE_ID` in `.env`.



## Hotfix: worker syntax error
- Fixed an extra closing brace in `worker/worker.ts` that caused `tsx`/esbuild to fail with `Unexpected "}"` near line 3818 and prevented `coldmail-worker.service` from starting.

## Hotfix v1.75-fixed6
- Fixed `scripts/aiops-agent.sh` to detect service existence via `systemctl show -p LoadState` instead of parsing `list-unit-files` output.
- Added a `[DB] begin incident write` breadcrumb to make incident DB debugging visible in `/var/log/coldmail-aiops.log`.


- Hotfix fixed7: AIOps incident inserts now build valid JSON for Incident.evidenceJson to satisfy MySQL JSON/check constraints.

- Hotfix fixed8: AIOps incident DB writes now use mysql -p<password> instead of MYSQL_PWD, matching the server's working mysql client behavior.


- Hotfix: System Incidents now show actions taken and current health after AIOps remediation.

- fixed10: fix AIOps DB writer unbound variable crash for incidents with remediation details; persist remediation steps and recovered status.


## v1.75 fixed11
- AIOps now audits service-specific config drift even when a service is up.
- Dovecot: detects and fixes /var/vmail mode drift (for example 000 -> 755) and owner drift.
- Exim: detects and fixes /etc/exim/maps mode drift and normalizes map file modes.
- Incident reasons now include drift details for richer GUI troubleshooting.


## Hotfix: fixed12
- Incident cards now show derived status, current health, action timeline, and verification details.
- AIOps agent now records post-fix verification details in evidenceJson.


## fixed13
- Added incident deduplication and recurrence tracking.
- Open incidents now track occurrence count, first/last seen timestamps, and needs-human-review escalation.
- Incidents UI now shows recurrence badges and an evidence panel.


## fixed14
- Added deeper service intelligence to AIOps (config drift, queue backlog, auth-failure spike, worker startup failure patterns).
- Added root-cause summaries and richer verification details into incident evidence.
