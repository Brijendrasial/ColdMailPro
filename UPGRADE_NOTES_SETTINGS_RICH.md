# Upgrade Notes — Rich Settings + Sessions

This patch adds:
- Rich `/app/settings` tabs (Account, Security, Sessions, Notifications, Deliverability, Team, Integrations, Developer).
- Two-Factor Authentication (TOTP) is already included (from previous patch).
- Device/session tracking (`UserSession` table) + revoke + sign-out everywhere.
- Workspace/user JSON settings storage (`settingsJson`).

## Required DB migration
Run Prisma migrations before starting the app, otherwise auth will fail because sessions are validated in the database.

```bash
npx prisma migrate deploy
npx prisma generate
```

Then restart the Next.js app / worker.

## Notes
- `settingsJson` is a JSON blob (Option A) so you can expand settings without schema changes.
- Session "last seen" updates are throttled (best-effort).
