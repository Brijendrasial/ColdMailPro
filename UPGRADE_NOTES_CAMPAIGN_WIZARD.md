# Campaign Wizard: Autosave + Resume Draft

This update adds:

1. **Autosave per step** in the campaign creation wizard (debounced ~800ms).
2. **Resume draft setup** banner on `/app/campaigns` that links back to the wizard.

## Required DB update (Prisma)

The Prisma schema adds 3 fields to `Campaign`:

- `setupStep Int @default(0)`
- `setupCompleted Boolean @default(false)`
- `draftLeadIds String?` (stores selected lead IDs in the wizard as JSON)

Run these after you replace the code:

```bash
npx prisma db push
npx prisma generate
```

## How it works

- When you edit a step (Senders / Schedule / Sequence / Leads), the wizard auto-saves in the background.
- If you leave the wizard mid-way, the campaign stays `status=draft` with `setupCompleted=false`.
- The Campaigns list shows a **Resume campaign setup** banner for the most recently updated unfinished draft.
- Clicking it opens `/app/campaigns/new?resume=<campaignId>` and the wizard restores your saved settings.
