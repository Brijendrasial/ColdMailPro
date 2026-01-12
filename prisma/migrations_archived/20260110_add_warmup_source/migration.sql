-- Add source columns to support bulk delete of manual warmup items

ALTER TABLE `WarmupSeedInbox`
  ADD COLUMN `source` VARCHAR(191) NOT NULL DEFAULT 'manual';

ALTER TABLE `WarmupTemplate`
  ADD COLUMN `source` VARCHAR(191) NOT NULL DEFAULT 'manual';

CREATE INDEX `WarmupSeedInbox_workspaceId_source_idx` ON `WarmupSeedInbox` (`workspaceId`, `source`);
CREATE INDEX `WarmupTemplate_workspaceId_source_idx` ON `WarmupTemplate` (`workspaceId`, `source`);

-- Best-effort: mark seeded defaults as system (only if names match)
UPDATE `WarmupTemplate`
  SET `source`='system'
  WHERE `name` IN ('Short intro','Friendly hello','Simple reply','Ack')
    AND `source`='manual';
