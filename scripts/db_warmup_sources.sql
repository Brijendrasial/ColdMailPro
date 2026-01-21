-- Manual SQL to apply warmup source columns (MySQL)
ALTER TABLE `WarmupSeedInbox` ADD COLUMN `source` VARCHAR(191) NOT NULL DEFAULT 'manual';
ALTER TABLE `WarmupTemplate` ADD COLUMN `source` VARCHAR(191) NOT NULL DEFAULT 'manual';
CREATE INDEX `WarmupSeedInbox_workspaceId_source_idx` ON `WarmupSeedInbox` (`workspaceId`, `source`);
CREATE INDEX `WarmupTemplate_workspaceId_source_idx` ON `WarmupTemplate` (`workspaceId`, `source`);
UPDATE `WarmupTemplate` SET `source`='system' WHERE `name` IN ('Short intro','Friendly hello','Simple reply','Ack') AND `source`='manual';
