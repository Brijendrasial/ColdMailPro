-- Lead snooze (workflow productivity)
ALTER TABLE `Lead`
  ADD COLUMN `snoozeUntil` DATETIME(3) NULL,
  ADD COLUMN `snoozeReason` TEXT NULL;

CREATE INDEX `Lead_workspaceId_snoozeUntil_idx` ON `Lead`(`workspaceId`, `snoozeUntil`);
