# Unified Logs ("everything" logging)

This update adds a **single Logs page** that captures **everything that happens in the app**:

- **DB writes** (create/update/delete/upsert) via Prisma middleware
- **Slow queries** + **query errors**
- **Worker job output** (every `logJob()` line)
- **Email sends** (start / success / failure)
- **Webhook deliveries** (success / failure)
- **UI/runtime errors** (window.onerror + unhandled promise rejections)
- **HTTP requests** (via Next middleware → AppLog)

## 1) Apply the DB migration

A new Prisma model was added: `AppLog`.

Run:

```bash
cd /root/coldmail-pro
npx prisma migrate dev --name app_logs
# or in prod:
# npx prisma migrate deploy
```

Then regenerate:

```bash
npx prisma generate
```

## 2) Configure env

In your `.env`:

```bash
# required for middleware logging → /api/logs/ingest
INTERNAL_LOG_TOKEN=your-long-random-token

APPLOG_DB=1
APPLOG_LEVEL=info
PRISMA_SLOW_MS=150
PRISMA_LOG_WRITES=1
PRISMA_LOG_READS=0
LOG_RETENTION_DAYS=30
```

Restart `next` and the worker.

## 3) Optional log retention

Nothing auto-deletes yet.

You can periodically clean old logs:

```sql
DELETE FROM AppLog WHERE createdAt < (NOW() - INTERVAL 30 DAY);
```

(or implement a worker cron if desired).
