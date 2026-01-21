# Leads: Saved Views (DB-backed)

This upgrade adds **workspace-level saved Views** to the Leads tab.

## 1) Update DB schema

Run one of the following:

### Option A (recommended for dev)

```bash
npx prisma migrate dev --name lead_views
```

### Option B (quick / no migration files)

```bash
npx prisma db push
```

## 2) Regenerate Prisma client

```bash
npx prisma generate
```

## 3) Restart

```bash
npm run dev
# or
npm run worker:dev
```

## What changed

- Prisma: new model `LeadView` (shared per workspace)
- Leads UI: preset chips + **Saved views** (create/update/delete)
- Leads UI: import wizard, suppression manager, duplicate finder + merge
- New API routes under `/api/leads/views`, `/api/leads/import-wizard`, `/api/leads/export`, `/api/leads/duplicates`, `/api/leads/merge`, `/api/suppressions/*`, `/api/campaigns/list`
