# ColdMailPro v2.0.0

A self-hosted cold email, lead management, warmup, deliverability, and MailStack operations platform built with **Next.js 14**, **Prisma**, **MariaDB/MySQL**, and a Node.js worker.

ColdMailPro v2.0.0 is the redesigned command-center release. It includes a full product UI refresh, improved MailStack operations, selectable Roundcube updates, better DNS workflows, stronger lead enrichment, live operational logs, and clearer production installation guidance.

> ColdMailPro is proprietary software. See [License](#license) before deploying, modifying, redistributing, or selling access.

---

## Table of contents

1. [What this software does](#what-this-software-does)
2. [Server requirements](#server-requirements)
3. [Full production installation](#full-production-installation)
4. [Environment configuration](#environment-configuration)
5. [MariaDB setup](#mariadb-setup)
6. [Prisma migration and seed](#prisma-migration-and-seed)
7. [Build and run with systemd](#build-and-run-with-systemd)
8. [MailStack installation and setup](#mailstack-installation-and-setup)
9. [Cloudflare DNS and MailStack integration](#cloudflare-dns-and-mailstack-integration)
10. [Roundcube and server software updates](#roundcube-and-server-software-updates)
11. [Optional AI features](#optional-ai-features)
12. [Optional email verification](#optional-email-verification)
13. [Warmup setup](#warmup-setup)
14. [Upgrade instructions](#upgrade-instructions)
15. [Troubleshooting](#troubleshooting)
16. [Security checklist](#security-checklist)
17. [v2.0.0 release notes](#v200-release-notes)
18. [Patch history](#patch-history)
19. [GitHub release workflow](#github-release-workflow)
20. [License](#license)

---

## What this software does

ColdMailPro is a self-hosted outbound email platform for teams that want to own their sending infrastructure.

Core modules:

- **Dashboard** — command-center view for sending health, deliverability, replies, queue health, setup progress, and alerts.
- **Campaigns** — campaign fleet management, multi-step sequences, status controls, sender routing, campaign health, ops alerts, analytics, funnels, and deliverability views.
- **Leads** — lead database, CSV import, dedupe, suppression checks, stages, saved views, enrichment, email discovery, and valid-only import.
- **Mailboxes** — SMTP/IMAP sender management, health checks, test sends, warmup controls, pools, routing, cooldowns, throttles, and mailbox-level stats.
- **Domains** — SPF/DKIM/DMARC/MX setup, Cloudflare DNS sync, DKIM rotation, outbound IP pools, DNS checks, and MailStack provisioning.
- **Replies** — shared inbox, reply triage, conversation timeline, lead context, AI draft assistance, assignment, snooze, and reply sending.
- **Analytics** — sending trends, reply/open/bounce stats, campaign leaderboards, mailbox reputation, funnel views, heatmaps, and event streams.
- **Logs** — observability cockpit for DB writes, worker jobs, mail sends, webhooks, UI/API errors, and message attempts.
- **MailStack** — server-side mail infrastructure control center for DNS, tenants, mailboxes, Roundcube, service updates, and repair tools.
- **Settings** — account, workspace, 2FA, sessions, notifications, deliverability defaults, team, audit log, integrations, API keys, incidents, and system controls.

---

## Server requirements

### Recommended production server

- **AlmaLinux 9**
- Root or sudo access
- Public IPv4 address
- Valid hostname pointing to the server
- Node.js 20+
- MariaDB 10.6+ or 10.11 LTS
- Git
- Nginx or another reverse proxy
- systemd

### Mail server requirements

If using the included MailStack installation:

- Clean AlmaLinux 9 server is strongly recommended.
- Reverse DNS should match or be close to your server hostname.
- Port 25 must be open for outbound SMTP if you want direct sending.
- DNS control for sending domains, preferably through Cloudflare.
- A real email address for Let's Encrypt registration.

### Local development requirements

- Node.js 20+
- MariaDB/MySQL
- npm
- Git

---

## Full production installation

These steps install ColdMailPro on a fresh server at `/root/coldmail-pro`.

### 1. Install base packages

```bash
sudo dnf update -y
sudo dnf install -y git curl wget unzip tar nano openssl mariadb-server
```

Enable MariaDB:

```bash
sudo systemctl enable --now mariadb
sudo systemctl status mariadb --no-pager
```

### 2. Install Node.js 20

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
node -v
npm -v
```

### 3. Clone or upload ColdMailPro

Using GitHub:

```bash
cd /root
git clone https://github.com/Brijendrasial/ColdMailPro.git coldmail-pro
cd /root/coldmail-pro
```

Using a release zip:

```bash
cd /root
unzip coldmail-pro-v2.0.0.zip
cd /root/coldmail-pro
```

### 4. Install dependencies

Use `npm ci` when `package-lock.json` is present. Use `npm install` when installing from a package without a lock file.

```bash
cd /root/coldmail-pro
npm ci
```

If `npm ci` fails because lockfile state changed:

```bash
npm install
```

### 5. Create `.env`

```bash
cp .env.example .env
nano .env
```

At minimum, configure:

```env
PUBLIC_APP_URL=https://your-app-domain.com
JWT_SECRET=replace_with_a_long_random_secret
ENCRYPTION_KEY=replace_with_32_byte_base64url_secret
TRACKING_LINK_SECRET=replace_with_a_long_random_secret
COOKIE_NAME=coldmail_session
NODE_ENV=production

DATABASE_URL="mysql://coldmail:ColdmailPass123@127.0.0.1:3306/coldmail"
SHADOW_DATABASE_URL="mysql://coldmail:ColdmailPass123@127.0.0.1:3306/coldmail_shadow"

MAILSTACK_SCRIPT=./scripts/mailstack.sh
MAILSTACK_ADDON_SCRIPT=./scripts/mailstack-addon.sh
MAILSTACK_ACME_EMAIL=you@yourdomain.com
```

Generate secure secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Use one output for `JWT_SECRET`, one 32-byte output for `ENCRYPTION_KEY`, and one output for `TRACKING_LINK_SECRET`.

---

## Environment configuration

Important environment values:

| Variable | Required | Purpose |
|---|---:|---|
| `PUBLIC_APP_URL` | Yes | Public URL used in tracking links, OAuth callbacks, and app redirects. |
| `JWT_SECRET` | Yes | Session signing secret. Use a long random value. |
| `ENCRYPTION_KEY` | Recommended | Encrypts mailbox credentials and sensitive fields. Use a 32-byte base64/base64url value. |
| `TRACKING_LINK_SECRET` | Recommended | Signs click tracking links. Falls back to `JWT_SECRET` if unset. |
| `DATABASE_URL` | Yes | Main MariaDB database connection. |
| `SHADOW_DATABASE_URL` | Yes for Prisma workflows | Shadow DB used by Prisma during migration checks/dev workflows. |
| `WORKER_CONCURRENCY` | Recommended | Number of worker jobs processed concurrently. |
| `SEND_TICK_SECONDS` | Recommended | Worker sending loop interval. |
| `IMAP_POLL_MINUTES` | Recommended | Reply polling interval. |
| `MAILSTACK_SCRIPT` | Optional | Path to `scripts/mailstack.sh`. |
| `MAILSTACK_ADDON_SCRIPT` | Optional | Path to `scripts/mailstack-addon.sh`. |
| `MAILSTACK_ACME_EMAIL` | Recommended | Email used for Let's Encrypt certificates. |
| `ALLOWED_ORIGINS` | Recommended | Comma-separated allowed origins for unsafe API requests. |

Production example:

```env
PUBLIC_APP_URL=https://app.example.com
JWT_SECRET=CHANGE_ME_LONG_RANDOM
ENCRYPTION_KEY=CHANGE_ME_32_BYTE_BASE64URL
TRACKING_LINK_SECRET=CHANGE_ME_LONG_RANDOM
COOKIE_NAME=coldmail_session
NODE_ENV=production
ALLOWED_ORIGINS=https://app.example.com

DATABASE_URL="mysql://coldmail:ColdmailPass123@127.0.0.1:3306/coldmail"
SHADOW_DATABASE_URL="mysql://coldmail:ColdmailPass123@127.0.0.1:3306/coldmail_shadow"

WORKER_CONCURRENCY=10
SEND_TICK_SECONDS=10
IMAP_POLL_MINUTES=5
SEND_GAP_MIN_SECONDS=60
SEND_GAP_MAX_SECONDS=180

MAILSTACK_SCRIPT=./scripts/mailstack.sh
MAILSTACK_ADDON_SCRIPT=./scripts/mailstack-addon.sh
MAILSTACK_ACME_EMAIL=admin@example.com
```

---

## MariaDB setup

ColdMailPro uses **two MariaDB databases**:

1. `coldmail` — main application database used by `DATABASE_URL`.
2. `coldmail_shadow` — Prisma shadow database used by `SHADOW_DATABASE_URL`.

The shadow database is important. Without it, Prisma migration commands may fail during schema checks.

### Create both databases and user

```bash
mysql -u root -p <<'SQL'
CREATE DATABASE IF NOT EXISTS coldmail CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS coldmail_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'coldmail'@'127.0.0.1' IDENTIFIED BY 'ColdmailPass123';
CREATE USER IF NOT EXISTS 'coldmail'@'localhost' IDENTIFIED BY 'ColdmailPass123';

GRANT ALL PRIVILEGES ON coldmail.* TO 'coldmail'@'127.0.0.1';
GRANT ALL PRIVILEGES ON coldmail_shadow.* TO 'coldmail'@'127.0.0.1';
GRANT ALL PRIVILEGES ON coldmail.* TO 'coldmail'@'localhost';
GRANT ALL PRIVILEGES ON coldmail_shadow.* TO 'coldmail'@'localhost';

FLUSH PRIVILEGES;
SQL
```

Test login:

```bash
mysql -u coldmail -p -h 127.0.0.1 -e "SHOW DATABASES;"
```

You should see both `coldmail` and `coldmail_shadow`.

### Fresh reinstall database reset

Only use this if you intentionally want to delete all app data:

```bash
mysql -u root -p <<'SQL'
DROP DATABASE IF EXISTS coldmail;
DROP DATABASE IF EXISTS coldmail_shadow;

CREATE DATABASE coldmail CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE coldmail_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

GRANT ALL PRIVILEGES ON coldmail.* TO 'coldmail'@'127.0.0.1';
GRANT ALL PRIVILEGES ON coldmail_shadow.* TO 'coldmail'@'127.0.0.1';
GRANT ALL PRIVILEGES ON coldmail.* TO 'coldmail'@'localhost';
GRANT ALL PRIVILEGES ON coldmail_shadow.* TO 'coldmail'@'localhost';

FLUSH PRIVILEGES;
SQL
```

---

## Prisma migration and seed

Run migrations and generate the Prisma client:

```bash
cd /root/coldmail-pro
npx prisma migrate deploy
npx prisma generate
```

Seed default data if this is a fresh install:

```bash
npm run seed
```

Default seed login:

```text
Email: admin@local.test
Password: Admin@12345
```

Change this password immediately after first login.

### Migration baseline for older installs

If upgrading from an old install that already has the schema but not the current migration history, mark the init migration as applied once:

```bash
npx prisma migrate resolve --applied 20260112000000_init
npx prisma migrate deploy
```

If Prisma complains about migrations that no longer exist locally, inspect `_prisma_migrations`, remove stale rows only after confirming your schema is correct, then run:

```bash
npx prisma migrate status
npx prisma migrate deploy
```

---

## Build and run with systemd

### 1. Build the app

```bash
cd /root/coldmail-pro
npm run build
```

This runs:

```bash
node scripts/clean-build.mjs && next build && tsc -p tsconfig.worker.json
```

### 2. Create web service

Create `/etc/systemd/system/coldmail-pro-dev.service`:

```ini
[Unit]
Description=ColdMailPro web app
After=network.target mariadb.service

[Service]
Type=simple
WorkingDirectory=/root/coldmail-pro
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 3. Create worker service

Create `/etc/systemd/system/coldmail-worker.service`:

```ini
[Unit]
Description=ColdMailPro worker
After=network.target mariadb.service

[Service]
Type=simple
WorkingDirectory=/root/coldmail-pro
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run worker:prod
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 4. Enable and start services

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now coldmail-pro-dev
sudo systemctl enable --now coldmail-worker
sudo systemctl status coldmail-pro-dev --no-pager
sudo systemctl status coldmail-worker --no-pager
```

Restart after future builds:

```bash
sudo systemctl restart coldmail-pro-dev
sudo systemctl restart coldmail-worker
```

View logs:

```bash
journalctl -u coldmail-pro-dev -f
journalctl -u coldmail-worker -f
```

### 5. Optional Nginx reverse proxy

Example Nginx server block:

```nginx
server {
    listen 80;
    server_name app.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Test and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## MailStack installation and setup

MailStack is the included on-server mail infrastructure layer. It provisions Exim, Dovecot, DNS records, DKIM, SPF, DMARC, mailbox users, tenant folders, TLS/SNI, Roundcube, and repair/update workflows.

### 1. Install MailStack

Run from the ColdMailPro folder:

```bash
cd /root/coldmail-pro
sudo scripts/mailstack.sh install \
  --hostname srv1.example.com \
  --email admin@example.com \
  --mailbox admin@example.com \
  --mailpass 'StrongMailboxPasswordHere'
```

Replace:

- `srv1.example.com` with your real server hostname.
- `admin@example.com` with your real admin or ACME email.
- `admin@example.com` after `--mailbox` with the first mailbox to create.
- `StrongMailboxPasswordHere` with a strong mailbox password.

### 2. Confirm scripts are executable

```bash
chmod +x scripts/mailstack.sh scripts/mailstack-addon.sh
```

### 3. Configure MailStack in the app

Open:

```text
App → MailStack
```

Set:

- Server IP
- Cloudflare API token if using Cloudflare DNS
- MailStack ACME email in `.env`

Then use:

- **Save settings**
- **Init Cloudflare**
- **Create tenant**

### 4. Recommended sudo model

For production, run the app/worker as a non-root user and allow only the required MailStack scripts via sudo. Keep the allowlist narrow.

---

## Cloudflare DNS and MailStack integration

ColdMailPro can use Cloudflare to create and sync DNS records for sending domains.

Supported records:

- SPF TXT at root
- DKIM TXT at selector host, usually `default._domainkey.domain.com`
- DMARC TXT at `_dmarc.domain.com`
- MX record pointing to `mail.domain.com`
- A record for `mail.domain.com`
- Optional tracking CNAME

### Cloudflare token permissions

Create a Cloudflare API token with zone DNS edit permissions for the domains you want to manage.

Typical permissions:

```text
Zone → DNS → Edit
Zone → Zone → Read
```

### DNS workflow

1. Add domains in **Domains**.
2. Select outbound IPs.
3. Copy or sync DNS records.
4. Run **Check DNS**.
5. When SPF/DKIM/DMARC/MX are healthy, provision mailboxes.
6. Use DKIM rotation when needed.

---

## Roundcube and server software updates

ColdMailPro v2.0.0 includes live MailStack maintenance actions in:

```text
App → MailStack → Server maintenance
```

Available actions:

- **Update all server software** — updates OS packages and restarts MailStack-related services.
- **Update Roundcube** — updates Roundcube using the selected build source.
- **Update server + Roundcube** — runs both in sequence.

### Roundcube build selector

The UI allows choosing:

- **Stable latest from Roundcube.net/GitHub** — best for upstream latest, such as `1.6.15`.
- **Custom upstream version** — install a specific version, for example `1.6.15`.
- **OS package repository** — use the version from enabled server repositories.

Manual commands:

```bash
sudo scripts/mailstack-addon.sh server-update
sudo scripts/mailstack-addon.sh roundcube-update --channel stable
sudo scripts/mailstack-addon.sh roundcube-update --channel custom --version 1.6.15
sudo scripts/mailstack-addon.sh roundcube-update --channel package
sudo scripts/mailstack-addon.sh roundcube-webfix
```

If `/roundcube/` downloads PHP files or shows the wrong page, run:

```bash
sudo scripts/mailstack-addon.sh roundcube-webfix
```

The repair command detects Roundcube docroot, detects PHP-FPM socket/port, writes the Nginx route, tests Nginx, and restarts web/PHP services.

---

## Optional AI features

ColdMailPro supports OpenAI-compatible AI providers for leads, replies, and operational suggestions.

### Shared AI environment

```env
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=your_api_key
AI_MODEL=gpt-4o-mini
AI_TIMEOUT_MS=60000
```

### Leads AI

```env
LEADS_AI_ENABLED=1
AI_WEBSEARCH_ENABLED=1
AI_WEBSEARCH_MODEL=gpt-5
AI_WEBSEARCH_MAX_TOOL_CALLS=3
AI_WEBSEARCH_TIMEOUT_MS=120000
```

Features:

- AI tags
- AI enrichment
- AI saved segments
- Website-based lead discovery
- Website email discovery and explanation
- Valid-only import after verification

### Replies AI

```env
REPLIES_AI_ENABLED=1
```

Features:

- Reply sentiment and intent
- One-click AI draft
- Optional autopilot for positive replies
- Optional Google Calendar scheduling
- Suggested actions inside the conversation studio

### Google Calendar scheduling

```env
GOOGLE_OAUTH_CLIENT_ID=your_client_id
GOOGLE_OAUTH_CLIENT_SECRET=your_client_secret
GOOGLE_OAUTH_REDIRECT_URL=https://your-app-domain.com/api/integrations/google/callback
GOOGLE_OAUTH_SCOPES=
```

---

## Optional email verification

ColdMailPro can verify email addresses before saving/importing using `ping-email`.

```env
PING_EMAIL_ENABLED=1
PING_EMAIL_FQDN=srv1.example.com
PING_EMAIL_SENDER=verify@example.com
PING_EMAIL_PORT=25
PING_EMAIL_TIMEOUT_MS=8000
PING_EMAIL_ATTEMPTS=1
```

Verification modes:

- **Safe** — syntax + domain + MX. Does not confirm mailbox existence.
- **Full** — syntax + MX + SMTP mailbox check. Best-effort; many providers block mailbox enumeration.
- **SMTP-only confirmation** — stricter mode when you want mailbox confirmation only.

Notes:

- Gmail and many large providers may not reliably disclose whether a mailbox exists.
- If outbound port 25 is blocked, use Safe mode or ask your provider to unblock it.
- Suppressed/DNC emails are blocked during lead creation, CSV import, and AI import.

---

## Warmup setup

Warmup improves sender reputation by sending realistic internal emails between configured mailboxes and seed inboxes.

Enable worker warmup:

```env
AUTO_WARMUP_ENABLED=1
WARMUP_DEBUG=0
WARMUP_POLL_MINUTES=10
WARMUP_SEEDCHECK_POLL_MINUTES=10
WARMUP_STALE_MINUTES=30
WARMUP_MIN_GAP_MINUTES=15
WARMUP_THREAD_REUSE_RATE=0.50
WARMUP_THREAD_MAX_MESSAGES=4
WARMUP_FOLLOWUP_RATE=0.35
WARMUP_FOLLOWUP_MIN_DELAY_MIN=60
WARMUP_FOLLOWUP_MAX_DELAY_MIN=240
WARMUP_SEED_ENGAGE=1
WARMUP_SEED_ENGAGE_OPEN_RATE=0.85
WARMUP_SEED_ENGAGE_STAR_RATE=0.35
WARMUP_SEED_ENGAGE_ARCHIVE_RATE=0.15
```

Warmup areas:

- **Mailboxes → Warmup**
- **Mailbox Pools**
- **Warmup Studio**
- **Warmup Control Center**

Gmail/Google Workspace notes:

- Enable IMAP.
- Use Gmail App Passwords for SMTP/IMAP when 2FA is enabled.
- In Gmail Settings → Labels, set All Mail and Spam to Show in IMAP.
- If placement stays unknown, use the Warmup Control Center to test IMAP folders.

---

## Upgrade instructions

### Standard upgrade

```bash
cd /root/coldmail-pro
git pull origin main
npm ci
npx prisma migrate deploy
npx prisma generate
npm run build
sudo systemctl restart coldmail-pro-dev
sudo systemctl restart coldmail-worker
```

### Upgrade from release zip

```bash
cd /root
unzip coldmail-pro-v2.0.0.zip
cd /root/coldmail-pro
npm ci
npx prisma migrate deploy
npx prisma generate
npm run build
sudo systemctl restart coldmail-pro-dev
sudo systemctl restart coldmail-worker
```

### Important v2.0.0 upgrade checklist

- Confirm `.env` contains both `DATABASE_URL` and `SHADOW_DATABASE_URL`.
- Confirm both MariaDB databases exist: `coldmail` and `coldmail_shadow`.
- Run `npm ci` or `npm install` after pulling v2.0.0.
- Run `npx prisma migrate deploy`.
- Run `npm run build`.
- Restart both web and worker services.
- Open Settings and enable 2FA for admin users.
- Open MailStack and confirm the worker can run maintenance jobs.

---

## Troubleshooting

### Build fails because Tailwind class does not exist

Run:

```bash
npm run build
```

If Tailwind reports an unsupported opacity class, make sure `tailwind.config.ts` from v2.0.0 is deployed. It includes the opacity values used by the redesigned UI.

### Prisma cannot connect

Check `.env`:

```bash
grep DATABASE_URL .env
grep SHADOW_DATABASE_URL .env
```

Check MariaDB:

```bash
systemctl status mariadb --no-pager
mysql -u coldmail -p -h 127.0.0.1 -e "SHOW DATABASES;"
```

### Prisma migration complains about shadow database

Create `coldmail_shadow` and grant access:

```bash
mysql -u root -p <<'SQL'
CREATE DATABASE IF NOT EXISTS coldmail_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON coldmail_shadow.* TO 'coldmail'@'127.0.0.1';
GRANT ALL PRIVILEGES ON coldmail_shadow.* TO 'coldmail'@'localhost';
FLUSH PRIVILEGES;
SQL
```

### Worker is not processing jobs

```bash
systemctl status coldmail-worker --no-pager
journalctl -u coldmail-worker -f
```

Common causes:

- `.env` missing for worker process
- database connection failure
- Prisma client not generated
- worker build missing under `worker-dist`
- service running from wrong `WorkingDirectory`

### DNS check logs show complete but UI does not update

Restart both services after deploying v2.0.0/fixed75 or newer:

```bash
npm run build
sudo systemctl restart coldmail-pro-dev
sudo systemctl restart coldmail-worker
```

The DNS check flow now uses a status endpoint, preserves worker results, and refreshes the page after completion.

### Roundcube shows `ok` or downloads PHP

Run:

```bash
sudo scripts/mailstack-addon.sh roundcube-webfix
sudo systemctl restart nginx php-fpm
```

Then open:

```text
http://SERVER_IP/roundcube/
```

### Exim or Dovecot fails after update

Check logs:

```bash
journalctl -u exim -n 100 --no-pager
journalctl -u dovecot -n 100 --no-pager
```

Run MailStack repair/update command:

```bash
sudo scripts/mailstack-addon.sh server-update
```

### App is running but tracking links are wrong

Confirm:

```env
PUBLIC_APP_URL=https://your-real-app-domain.com
TRACKING_LINK_SECRET=your_secret
```

Rebuild and restart after changing `.env`.

---

## Security checklist

Before production use:

- Change the default admin password.
- Enable 2FA for admin accounts.
- Use strong `JWT_SECRET`, `ENCRYPTION_KEY`, and `TRACKING_LINK_SECRET`.
- Never commit `.env`.
- Restrict server SSH access.
- Put the app behind HTTPS.
- Use a narrow sudo allowlist if worker runs MailStack scripts.
- Keep MailStack server packages updated.
- Use Cloudflare tokens with only required DNS permissions.
- Regularly back up MariaDB.
- Monitor Logs and Settings → System incidents.

Backup example:

```bash
mysqldump -u root -p coldmail > coldmail-backup-$(date +%F).sql
```

Restore example:

```bash
mysql -u root -p coldmail < coldmail-backup-YYYY-MM-DD.sql
```

---

## v2.0.0 release notes

ColdMailPro v2.0.0 is the full redesigned command-center release.

### Product redesign

- Redesigned Dashboard into a command-center workspace.
- Redesigned Campaigns and campaign inner pages.
- Redesigned Leads and enrichment modal.
- Redesigned Mailboxes, pools, and warmup pages.
- Redesigned Domains and domain detail DNS cockpit.
- Redesigned Replies into a shared inbox studio.
- Redesigned Analytics into a mission-control page.
- Redesigned Logs into an observability cockpit.
- Redesigned MailStack into an infrastructure control center.
- Redesigned Settings into an admin control center.

### MailStack improvements

- Added live server maintenance modal with stages and logs.
- Added server software update workflow.
- Added selected Roundcube build update flow.
- Added upstream Roundcube stable/custom version installer.
- Added Roundcube web route and PHP-FPM repair command.
- Improved service restart order and Prisma reconnect handling after updates.

### Domain and DNS improvements

- Improved DNS detail layout and fixed overlap/alignment problems.
- Added live DNS check status flow.
- Preserved DNS result storage after worker completion.
- Improved Cloudflare DNS cockpit.
- Improved DKIM rotation UI.
- Improved SPF/DKIM/DMARC/MX visibility.

### Lead enrichment improvements

- Rebuilt enrichment modal into Discover → Verify → Import flow.
- Added valid-only import after verification.
- Added cleaner grouping for website emails, AI suggestions, manual additions, and generated patterns.

### Production improvements

- Added Tailwind opacity support used by the new UI.
- Preserved executable deployment scripts.
- Added MariaDB instructions for both main and shadow database.
- Updated version to `2.0.0`.

---

## Patch history

This section summarizes the important patch line that led to v2.0.0.

### v1.75 foundation

- Stabilized campaign, lead, warmup, mailbox, domain, reply, log, and settings workflows.
- Added stronger worker job handling and operational logs.
- Added security hardening for tracking links, CSRF checks, encryption key support, and log retention.
- Added richer settings, 2FA, sessions, team, audit log, webhooks, API keys, incidents, and autofix.

### fixed56 to fixed63: MailStack and Roundcube operations

- Added automatic MailStack TLS issuance and renewal restart handling.
- Added server software update button and worker job flow.
- Added live update modal with progress stages and logs.
- Added safer restart/reconnect handling after package updates.
- Added Roundcube route repair and PHP-FPM detection.
- Added Roundcube build selector for upstream stable, custom version, or OS package.

### fixed64 to fixed65: Leads redesign

- Rebuilt lead enrichment modal.
- Added valid-only import after verification.
- Redesigned Leads as a CRM-style command center.

### fixed66 to fixed71: redesign foundation and campaigns

- Added shared UI polish and command-center visual system.
- Corrected project folder packaging.
- Added Tailwind opacity support.
- Redesigned Dashboard and Campaigns.
- Fixed campaign inner hero imports.

### fixed72 to fixed75: mailboxes and domains

- Redesigned Mailboxes, pools, and warmup screens.
- Redesigned Domains and domain detail pages.
- Fixed domain detail alignment and overlap issues.
- Fixed DNS check live status/completion handling.

### fixed76 to fixed80: replies, analytics, logs, MailStack, settings

- Redesigned Replies shared inbox.
- Redesigned Analytics command center.
- Redesigned Logs observability cockpit.
- Redesigned MailStack control center and tenant pages.
- Redesigned Settings control center.

### v2.0.0 README refresh

- Reorganized README with installation first.
- Added professional production setup instructions.
- Added complete MariaDB + shadow database setup.
- Added MailStack, Roundcube, AI, verification, warmup, upgrade, troubleshooting, and release workflow documentation.

---

## GitHub release workflow

Use this flow to publish v2.0.0 on GitHub.

### 1. Build and commit

```bash
cd /root/coldmail-pro
npm ci
npm run build

git status
git add .
git commit -m "Release ColdMailPro v2.0.0"
```

### 2. Push to main

```bash
git fetch origin
git checkout main
git pull origin main
git push origin main
```

If you are working on a release branch:

```bash
git checkout -b release/v2.0.0
git push -u origin release/v2.0.0
```

Then create a pull request:

```text
release/v2.0.0 → main
```

### 3. Create tag

After `main` has the release:

```bash
git checkout main
git pull origin main
git tag -a v2.0.0 -m "ColdMailPro v2.0.0 - full redesigned command center release"
git push origin v2.0.0
```

### 4. GitHub release title

```text
ColdMailPro v2.0.0 — Full Redesigned Command Center Release
```

Suggested release body:

```markdown
ColdMailPro v2.0.0 is a major full-app redesign and infrastructure operations release.

Highlights:
- Full command-center UI redesign
- Redesigned Dashboard, Campaigns, Leads, Mailboxes, Domains, Replies, Analytics, Logs, MailStack, and Settings
- Improved MailStack server updates
- Roundcube upstream stable/custom version selector
- Improved DNS check status and domain cockpit
- Improved lead enrichment and valid-only import
- Professional production install documentation
```

---

## Development quick start

For local development:

```bash
cp .env.example .env
npm install
npx prisma migrate deploy
npx prisma generate
npm run seed
npm run dev
```

In another terminal:

```bash
npm run worker:dev
```

Open:

```text
http://localhost:3000
```

---

## Useful commands

```bash
# Build app and worker
npm run build

# Generate Prisma client
npx prisma generate

# Apply migrations
npx prisma migrate deploy

# Run app locally
npm run dev

# Run worker locally
npm run worker:dev

# Run worker production build
npm run worker:prod

# Restart production services
sudo systemctl restart coldmail-pro-dev coldmail-worker

# Tail logs
journalctl -u coldmail-pro-dev -f
journalctl -u coldmail-worker -f
```

---

## License

**Proprietary (MTA). Not for redistribution or sale.**

This project is governed by the **ColdMailPro Proprietary License (MTA)** in `LICENSE`. You may not redistribute, publish, resell, sublicense, or host this software for third parties unless explicitly permitted under an executed Master Terms Agreement.

---

## Disclaimer

ColdMailPro is not affiliated with Instantly.ai, Mailgun, Roundcube, Cloudflare, Google, OpenAI, or any mail provider. Product names are used only to describe integrations or workflow compatibility.
