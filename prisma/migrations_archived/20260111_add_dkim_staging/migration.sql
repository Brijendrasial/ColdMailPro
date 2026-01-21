-- Add DKIM staging fields for zero-downtime rotations
ALTER TABLE `Domain`
  ADD COLUMN `pendingDkimSelector` VARCHAR(191) NULL,
  ADD COLUMN `pendingDkimPublic` LONGTEXT NULL,
  ADD COLUMN `pendingDkimCreatedAt` DATETIME(3) NULL;
