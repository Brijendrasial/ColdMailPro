# ColdMail Pro

**Version:** v1.75

## What's new in v1.75
- **AIOps-managed services**: system-level health checks + safe auto-remediation for Exim, Dovecot, MariaDB, ColdMail app, and worker via `coldmail-aiops.timer`.
- **AutoFix**: safe fixes auto-applied; risky fixes are AI suggestions only (never executed automatically).
- **Incidents UI**: Settings → System shows open incidents + Apply Safe Fixes action.
- **AlmaLinux 9 SELinux hardening**: `/var/vmail` relabel + Exim DB boolean + Exim maps restorecon.
- **Tenant delete DNS cleanup**: optional Cloudflare DNS purge on tenant reset/delete.


Self-hosted **cold email + warmup** app built with **Next.js 14**, **Prisma**, and **MariaDB**.

> Not affiliated with Instantly.ai or Mailgun. “Instantly-style” is used as a product description only.

## Demo
You can access the live demo here:
- https://demo.coldmailpro.io

> Note: The demo environment may be reset periodically.

## Screenshots

<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="Dashboard" width="900" />
</p>

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/campaigns.png" alt="Campaigns" /></td>
    <td width="50%"><img src="docs/screenshots/leads.png" alt="Leads" /></td>
  </tr>
</table>

<p align="center">
  <img src="docs/screenshots/mailboxes.png" alt="Mailboxes" width="900" />
</p>

> Want to add more? Drop PNGs into `docs/screenshots/` and link them here.

## Features
- Campaigns + multi-step sequences (Instantly-style list: search/sort/status/health filters, bulk run/pause/stop/archive/duplicate, health pill, ops alerts for spikes/DNS/capacity with inline drill-down)
- Campaign analytics: step summary + per-variant breakdown, **variant winners** (reply-rate winner + uplift)
- Deliverability drill-down: template QA, sender throttles, and **guardrails (auto-pause thresholds)**
- Campaign mailbox dashboard: visual sender **health + load per campaign** (sent/queue/bounces/replies), with 1-click **cooldown clear**
- Lead import + dedupe
- Manual lead add (single lead) + optional email verification (ping-email)
- Import wizard: optional email verification (MX/SMTP) with invalid-row handling
- Leads (workflow): bulk actions (tag/verify/enrich/delete/assign owner/move list/**create tasks**/**snooze**), stages + optional Kanban view (**drag → stage update**)
- Leads (productivity): per-lead drawer with notes/call logs/meetings, tasks/reminders, and an activity timeline
- Leads (quality & safety): email risk badges (catch-all/free/role/disposable/no-MX/suppressed), email fallback generator (pattern suggestions) + verify-before-import
- Mailboxes: health checks + test sends, advanced SMTP/IMAP editing (no password reveal), IMAP cursor reset, CSV export, safe delete (keeps historical message rows), **bulk warmup toggles**, and **per-campaign cooldown management** (view, clear, and add manual cooldowns)
- Warmup suite: profiles + ramp plan + seed + internal mailbox placement tracking (inbox/spam) + auto-open/star engagement simulation + template library + AI template generator + **timezone-aware daily targets/counts** + **pacing (min gap)** + **thread reuse + multi-turn follow-ups** + **Activity analytics & recent message log (14d)** + **manual “Re-check placement” button** + **Ramp calendar** + **Thread viewer** + **Seed health dashboard (bulk test)** + **auto-disable warmup on spam spike** + **Warmup Control Center (worker heartbeat, mailbox health, actions, logs)**
- SMTP mailbox pools + rotation (weighted) + score-based routing (healthiest, score+idle)
- Worker-based sending + scheduling + daily limits + pacing
- Open/click tracking (pixel + redirect)
- Unsubscribe + suppression lists
- Basic bounce handling (SMTP errors + optional IMAP DSN parsing)
- Dashboard command center: **today send capacity/pacing**, replies triage snapshot, queue health, DNS/warmup signals, plus **top broken domains**, bounce reason breakdown, and recipient-domain hotspots (with 1-click drill-down to Analytics/Leads)
- Multi-tenant workspaces + users
- Message logs + analytics
- Rich Settings: account/workspace, password change, **2FA (TOTP)**, sessions/devices
- Team/Security: invites, roles, audit log (who changed what)

## Warmup Control Center

A dedicated operations view for warmup health and debugging:

- Worker heartbeat (detects if the warmup worker is running)
- Mailbox health table (warmup on/off, IMAP configured, last activity, placement counts)
- One-click actions: pause/resume warmup, force warmup tick, force placement/seed checks, and **Test IMAP** (lists folders + probes Gmail All Mail/Spam even if hidden)
- Log viewer (recent warmup job logs and errors)

### Gmail/Google Workspace notes
Warmup placement and starring depend on IMAP visibility. If placement stays **unknown**, ensure:

- IMAP is enabled in Gmail
- The **All Mail** and **Spam** labels are set to **Show in IMAP** (Gmail Settings → Labels)
- You are using a Gmail **App Password** for IMAP (recommended for accounts with 2FA)

The warmup worker scans INBOX and also attempts All Mail/Archive + Spam/Junk folders (with probing) to avoid “unknown” placement due to auto-archiving.

## Tech stack
- Web: Next.js 14 (App Router), React, Tailwind
- DB: MariaDB/MySQL via Prisma
- Worker: Node background process (`worker/worker.ts`) for sending and scheduled jobs

## Requirements
### Production server
- **AlmaLinux 9** (required)

### Local development
- Node.js 20+
- MariaDB 10.6+ (or 10.11 LTS)

## Quick start (local)
1) Copy env
```bash
cp .env.example .env
```

2) Start MariaDB (Docker) (optional)
```bash
docker compose up -d db adminer
```

3) Install dependencies
```bash
npm install
```

4) Prisma + seed
```bash
# IMPORTANT: Fresh installs must use migrations (do NOT run `prisma db push`)
# Verify prisma/migrations contains ONLY the init migration
bash scripts/verify-migrations.sh

# Apply migrations (fresh install)
npx prisma migrate deploy
npx prisma generate
npm run seed
```

Optional helper (same steps):
```bash
bash scripts/db-fresh-install.sh
```

5) Run web + worker
```bash
npm run dev
*(in another terminal)*
npm run worker:dev
```

App: `http://localhost:3000`

Default seed user:
- email: `admin@local.test`
- password: `Admin@12345`

## Production deployment
### Upgrading from older installs (baseline)
If you’re upgrading a server that already has an existing database created by older “ALTER-only” migrations, **baseline** the new init migration once:

```bash
# Mark the init migration as already applied (no schema changes)
npx prisma migrate resolve --applied 20260112000000_init
```

If Prisma complains about missing migrations that no longer exist locally, remove their rows from `_prisma_migrations` (the old folder names), then re-run:

```bash
npx prisma migrate status
npx prisma migrate deploy
```
0) Install mail server (Mailstack) on the server **first**

```bash
/root/coldmail-pro/scripts/mailstack.sh install \
  --hostname <YOUR_HOSTNAME> \
  --email <YOUR_EMAIL> \
  --mailbox <MAILBOX_EMAIL> \
  --mailpass '<MAILBOX_PASSWORD>'
```

- `<YOUR_HOSTNAME>` is your server hostname (example: `srv1.us1.mainip.vh.hadimba.com`) — replace it with yours.
- Replace `<YOUR_EMAIL>`, `<MAILBOX_EMAIL>`, `<MAILBOX_PASSWORD>` with your own values.

1) Build
```bash
npm install
npm run prisma:generate
npm run build
```

2) Database + migrations (production)
```bash
# Create the database if it doesn't exist
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS coldmail CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# Apply migrations
npx prisma migrate deploy
```

> Fresh re-install? Drop + recreate the DB first:
```bash
mysql -u root -p -e "DROP DATABASE IF EXISTS coldmail; CREATE DATABASE coldmail CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
npx prisma migrate deploy
```

3) Start web + worker (separate processes)
```bash
npm run start
npm run worker:prod
```

Use a process manager (systemd/pm2/Docker) for both processes.

## Mailstack integration (optional)
This repo includes an integrated UI under **App → Mailstack** that can run:
- `mailstack.sh` (installer)
- `mailstack-addon.sh` (tenant provisioning, Cloudflare DNS, DKIM/SPF/DMARC, mailbox creation, IP rotation)

Env defaults:
- `MAILSTACK_SCRIPT=./scripts/mailstack.sh`
- `MAILSTACK_ADDON_SCRIPT=./scripts/mailstack-addon.sh`

Note: `scripts/*.sh` are shipped with executable permissions.

Recommended: run the worker as a non-root user and allow only these scripts via sudo.


### Installing Mailstack (server prerequisite)
Run this on the server before using the Mailstack UI:

```bash
/root/coldmail-pro/scripts/mailstack.sh install \
  --hostname <YOUR_HOSTNAME> \
  --email <YOUR_EMAIL> \
  --mailbox <MAILBOX_EMAIL> \
  --mailpass '<MAILBOX_PASSWORD>'
```


## Email verification (optional: ping-email)

ColdMail Pro can verify lead emails **before saving** using `ping-email` (syntax/domain/MX and optional SMTP mailbox verification).

Where it's available:
- **Leads → Add lead** (manual add): verify before saving, choose verification mode.
- **Leads → Import CSV wizard**: optionally verify each row during import, and either *skip invalid rows* or *stop on first error*.
- **Leads → ✨ Enrich by website → Discover emails**: shows **all emails found**, then you can **Select → Verify (ping-email) → Import**. Includes:
  - **Risk score + flags** per email (catch-all, free provider, role-based, disposable, no-MX, suppressed)
  - **Manual check before adding** (verify first, then add)
  - **Email fallback generator**: generate common patterns (first.last, f.last, etc.) and verify before importing
  - **Auto-suppress safety**: suppressed (DNC) emails are blocked during create + CSV import + AI import

Verification modes:
- **Full (MX + SMTP mailbox check)**: attempts SMTP verification to confirm mailbox (best-effort).
- **Safe (syntax + domain + MX only)**: does **not** confirm mailbox existence (useful when outbound SMTP is blocked).

### Environment variables

Add these to your `.env` (see `.env.example`):

```env
# Enable/disable ping-email verification
PING_EMAIL_ENABLED=1

# Required for SMTP HELO/EHLO identity (use your server hostname)
PING_EMAIL_FQDN=your.server.hostname

# Sender used during verification (must be a real address on your domain)
PING_EMAIL_SENDER=verify@yourdomain.com

# SMTP port (25 is typical for MX). If your VPS blocks outbound 25, use Safe mode.
PING_EMAIL_PORT=25

# Optional tuning
PING_EMAIL_TIMEOUT_MS=8000
PING_EMAIL_ATTEMPTS=1
```

### Notes
- Many providers (including Gmail) may **not reliably disclose mailbox existence** via SMTP (anti-enumeration), so Full mode is still best-effort.
- If your VPS blocks outbound port 25, Full mode will fail—use Safe mode or unblock/relay SMTP.

## Leads AI (optional)

ColdMail Pro can use an **OpenAI-compatible** API to add AI helpers inside the Leads screen.

Where it's available:
- **Leads → select leads** → bulk bar → **✨ AI tags** (suggests a shared tag set and lets you apply it).
- **Leads → select leads** → bulk bar → **✨ AI enrich** (suggests missing fields like name/company/website; applies in safe mode by default: *fill missing only*).
- **Leads → select leads** → bulk bar → **+ Task** (creates the same follow-up/reminder task for all selected leads).
- **Leads → select leads** → bulk bar → **Snooze / Unsnooze** (hide leads until a chosen date so you can work a clean queue).
- **Leads** (top right) → **✨ AI segments** (suggests useful saved views/segments; you can apply or save them).
- **Leads** (top right) → **✨ Enrich by website** (paste a company site like `https://acme.com`).
  - If you already have leads with matching email domains (e.g. `@acme.com`), it enriches missing fields in bulk.
  - It can optionally discover **published emails via AI web search** (similar to ChatGPT browsing), create leads for them (skip duplicates), then enrich.
  - The modal shows AI-labeled context for each found email (purpose, recommendation, confidence) and links to evidence URLs when available.

### Environment variables

Add these to your `.env` (see `.env.example`):

```env
LEADS_AI_ENABLED=1

# Shared AI settings (OpenAI / OpenRouter / local gateway)
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=...
AI_MODEL=gpt-4o-mini
AI_TIMEOUT_MS=60000

# AI web search (recommended for email discovery without crawling)
AI_WEBSEARCH_ENABLED=1
AI_WEBSEARCH_MODEL=gpt-5
AI_WEBSEARCH_MAX_TOOL_CALLS=3
AI_WEBSEARCH_TIMEOUT_MS=120000


## Replies AI (optional)

ColdMail Pro can auto-triage inbound replies and (optionally) auto-send replies for **positive** responses.

In the **Replies** tab you get:
- 🏷️ Sentiment + intent + confidence label for the latest inbound reply
- ✨ One-click "AI draft" to generate a reply
- "Insert to reply" to drop the draft into the composer
- Optional **Autopilot**: worker can auto-send the AI draft for positive replies above a confidence threshold (unless the model explicitly says to ignore/close/unsubscribe)
- 📅 Optional **Google Calendar** integration: create a Google Meet invite when a reply contains an exact time (and optionally auto-send a confirmation reply)
- Negative/OOO/unsubscribe replies are ignored (and can be auto-closed)

Enable via env:

```bash
REPLIES_AI_ENABLED=1

# --- Google Calendar (optional, for meeting scheduling) ---
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
# Optional; defaults to ${PUBLIC_APP_URL}/api/integrations/google/callback
GOOGLE_OAUTH_REDIRECT_URL=
# Optional scopes override (space-separated)
GOOGLE_OAUTH_SCOPES=

# Uses the same OpenAI-compatible settings as Leads AI:
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=...
AI_MODEL=gpt-4o-mini
AI_TIMEOUT_MS=60000
```

> **Autopilot runs in the worker.** Make sure the worker process receives these env vars.
> - `npm run worker:prod` now loads `.env` automatically.
> - If you run the worker via systemd/pm2/Docker, you still need to pass the env vars to that process.

In **Replies** → click **AI** (top-right of the Conversation panel — visible even before selecting a thread) to configure: Enabled, Mode (suggest/autopilot), Min confidence, an optional booking link, and (if you connected Google) meeting scheduling options.

## Security notes
- Never commit `.env` or any private keys/certs.
- Keep `.env.example` safe (placeholders only).

## License

**Proprietary (MTA). Not for redistribution or sale.**

This project is governed by the **ColdMailPro Proprietary License (MTA)** (see `LICENSE`). You may not redistribute, publish, or sell this software, except as explicitly permitted under an executed Master Terms Agreement (“MTA”).
## Security hardening (applied in this release)

## Mailboxes UX upgrades (v1.7.8)
- Campaign \u2192 Mailboxes dashboard now supports **selection + bulk actions** (warmup on/off, cooldown set/clear).
- Added **Routing preview** modal: shows which mailbox would be picked next for the campaign strategy, with explainable reasons.
- Added **Export CSV** for the current filtered/sorted view.
- Added **quick actions** per mailbox row (cooldown presets + warmup toggle).
## Campaign Mailboxes analytics (v1.7.9)
- Added **Exclude from campaign** toggle per mailbox (without disabling the mailbox globally). Works for pool/all sender modes via `CampaignMailbox.isActive=false` overrides.
- Added **Domains breakdown (7d)** per mailbox: Gmail / Outlook / Yahoo / Other with `sent/bounced` counts.
- Added **Sent trend sparkline (7d)** per mailbox for quick scanning.

### 1) Signed click-tracking links (fixes open redirect)
`/t/click` now requires a valid `sig` query param (HMAC) and only allows `http(s)` destinations.  
New outbound emails automatically generate signed click links.

**New env (recommended):**
- `TRACKING_LINK_SECRET` — secret used to sign/verify tracking links (falls back to `JWT_SECRET` if unset).

### 2) Avoid logging query-string PII from tracking endpoints
The Next.js `middleware.ts` no longer runs on `/t/*`, and request logging no longer stores raw query-string values.
(It records only param names.)

### 3) Separate encryption key from JWT secret (key rotation-friendly)
Mailbox credentials (and other encrypted fields) now prefer `ENCRYPTION_KEY` instead of `JWT_SECRET`.
For backward compatibility, decrypt will also try the legacy JWT-derived key.

**New env (recommended):**
- `ENCRYPTION_KEY` — independent 32-byte key (base64/base64url). If unset, `JWT_SECRET` is used.

### 4) AppLog retention sweep (automatic cleanup)
The worker performs a daily retention sweep using `LOG_RETENTION_DAYS` (default: 30) and deletes older rows from `AppLog`.

### 5) Basic CSRF mitigation for API routes
Middleware blocks cross-origin unsafe requests (POST/PUT/PATCH/DELETE) to `/api/*` when an `Origin` header is present and not allowed.
Use `ALLOWED_ORIGINS` (comma-separated) if you legitimately need cross-origin access.

## Domains DNS Check worker fix (v1.7.9b)
- Fixed a worker crash when running `domain_dns_check` jobs (ReferenceError: `selector is not defined`) which caused the **Domains → Check** button to fail.
- The worker now reports the checked DKIM selector via `records.dkim.selector` (typically `default`).
- Updated the **Domains** table action to render **Open** as a proper button (consistent with other page actions).

### Warmup worker + UI improvements
- Fixed warmup daily targets and "sent today" counts to be **timezone-aware** and to respect **Weekdays only** (aligned with the Ramp calendar).
- Added warmup pacing (prevents bursty warmup) via `WARMUP_MIN_GAP_MINUTES`.
- Added more human-like warmup behavior: "thread reuse" + optional multi-turn follow-ups; threads auto-close at `WARMUP_THREAD_MAX_MESSAGES`.
- Profiles table now shows **daily progress** (sent/target) and the mailbox’s local timezone.


### Bulk warmup profile actions
Warmup → Profiles supports multi-select and one-shot bulk actions:

New: **Warmup Control Center**
- UI: `/app/mailboxes/warmup/control-center`
- APIs: `/api/warmup/control-center/...`
- Shows worker heartbeat, placement summary, warmup job queue stats, mailbox IMAP/warmup health, and a log viewer.
- Includes quick actions: pause/resume mailbox warmup, enqueue warmup tick, run seed check / mailbox placement check, and test IMAP connectivity.
- Enable/disable warmup
- Re-check placement (Inbox vs Spam/Junk) for selected mailboxes
- Check SMTP/IMAP in bulk
- Run warmup now in bulk
- Delete profiles in bulk
- Bulk editor to update ramp + window settings and **copy settings from** a known-good mailbox
- **Inline “Copy profile”** action on a row to set it as the copy source
- **Presets**: apply built-in presets (e.g. “Gmail safe ramp”) or save your own presets locally (per-browser)



## AutoFix (self-healing)

The worker includes an optional **AutoFix** layer that can automatically apply **safe** fixes when common
infrastructure errors are detected (SELinux labels, Exim map permissions, Exim DB lookup SELinux boolean),
and can generate **suggestions** (AI) for risky/unknown failures.

Environment variables:
- `AUTOFIX_ENABLED` (default: `true`)
- `AUTOFIX_AUTO_APPLY_SAFE` (default: `true`)
- `AUTOFIX_AI_SUGGESTIONS` (default: `true`) – requires `AI_API_KEY`
- `AUTOFIX_MAX_SAFE_ATTEMPTS_PER_JOB` (default: `1`)

Safe fixes are applied via a strict allowlist and executed through the existing provisioning runner (sudo-wrapped).
AI suggestions are logged to the JobLog but **never applied automatically**.

## Deploy / Upgrade
### 1) Pull latest code + install deps
```bash
git pull
npm ci
```

### 2) Prisma migrations + regenerate client
```bash
npx prisma migrate deploy
npx prisma generate
```

### 3) Restart app + worker
Use whatever you run in production (systemd / pm2 / docker). Example:
```bash
systemctl restart coldmail-app coldmail-worker
```

## AIOps Agent (systemd)
ColdMail includes a **system-level AIOps agent** that monitors core services installed/managed by the stack and performs **safe auto-recovery**.

**Monitored services (default):**
- `exim`
- `dovecot`
- `mariadb`
- `coldmail-app`
- `coldmail-worker`

**Installed units:**
- `/etc/systemd/system/coldmail-aiops.service`
- `/etc/systemd/system/coldmail-aiops.timer`

The timer runs every minute.

### Install / enable the AIOps agent
If you run the installer (`scripts/mailstack.sh`) it enables the timer automatically.
For existing servers:

```bash
cp -f scripts/systemd/coldmail-aiops.service /etc/systemd/system/coldmail-aiops.service
cp -f scripts/systemd/coldmail-aiops.timer /etc/systemd/system/coldmail-aiops.timer
systemctl daemon-reload
systemctl enable --now coldmail-aiops.timer
```

### SELinux note (AlmaLinux 9)
systemd may refuse to execute scripts from `/root` (`admin_home_t`). The installer copies the agent to:
- `/usr/local/bin/coldmail-aiops-agent`

You can verify:
```bash
ls -lZ /usr/local/bin/coldmail-aiops-agent
systemctl status coldmail-aiops.timer --no-pager -l
```

### Logs
```bash
tail -f /var/log/coldmail-aiops.log
```

## AutoFix + Incidents
- **Safe fixes** are applied automatically by the worker when a job fails (e.g., SELinux contexts, exim maps perms, restart services).
- **Risky fixes** are **AI suggestions only** and are never executed automatically.

UI:
- Go to **Settings → System** to see:
  - **Incidents** (open issues detected) + “Apply safe fixes”
  - **AutoFix activity** (safe applied + AI suggested)

Environment flags:
```env
AUTOFIX_ENABLED=true
AUTOFIX_AUTO_APPLY_SAFE=true
AUTOFIX_AI_SUGGESTIONS=true
AUTOFIX_MAX_SAFE_ATTEMPTS_PER_JOB=1
AIOPS_ENABLED=true
AIOPS_AI_ANALYSIS=true
```
