# ColdMail Pro

Self-hosted **cold email + warmup** app built with **Next.js 14**, **Prisma**, and **MariaDB**.

> Not affiliated with Instantly.ai or Mailgun. “Instantly-style” is used as a product description only.

## Demo
You can access the live demo here:
- http://51.38.38.222:3000

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
- Lead import + dedupe
- Manual lead add (single lead) + optional email verification (ping-email)
- Import wizard: optional email verification (MX/SMTP) with invalid-row handling
- SMTP mailbox pools + rotation
- Worker-based sending + scheduling + daily limits + pacing
- Open/click tracking (pixel + redirect)
- Unsubscribe + suppression lists
- Basic bounce handling (SMTP errors + optional IMAP DSN parsing)
- Dashboard command center: **today send capacity/pacing**, replies triage snapshot, queue health, DNS/warmup signals, plus **top broken domains**, bounce reason breakdown, and recipient-domain hotspots (with 1-click drill-down to Analytics/Leads)
- Multi-tenant workspaces + users
- Message logs + analytics
- Rich Settings: account/workspace, password change, **2FA (TOTP)**, sessions/devices
- Team/Security: invites, roles, audit log (who changed what)

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

## Security notes
- Never commit `.env` or any private keys/certs.
- Keep `.env.example` safe (placeholders only).

## License

**Proprietary (MTA). Not for redistribution or sale.**

This project is governed by the **ColdMailPro Proprietary License (MTA)** (see `LICENSE`). You may not redistribute, publish, or sell this software, except as explicitly permitted under an executed Master Terms Agreement (“MTA”).