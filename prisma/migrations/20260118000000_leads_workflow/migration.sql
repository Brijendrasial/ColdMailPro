-- Leads workflow + productivity features (v1.7)
SET NAMES utf8mb4;

-- Add workflow fields to Lead (idempotent for existing DBs)
-- NOTE: Prisma migrations are normally not meant to be edited after apply.
-- This project uses this guard so deploys don't fail when columns already exist.

SET @db := DATABASE();

-- stage
SET @has_stage := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'Lead' AND column_name = 'stage'
);
SET @sql := IF(
  @has_stage = 0,
  'ALTER TABLE `Lead` ADD COLUMN `stage` VARCHAR(191) NOT NULL DEFAULT \'new\' AFTER `status`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ownerUserId
SET @has_owner := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'Lead' AND column_name = 'ownerUserId'
);
SET @sql := IF(
  @has_owner = 0,
  'ALTER TABLE `Lead` ADD COLUMN `ownerUserId` VARCHAR(191) NULL AFTER `stage`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- listId
SET @has_list := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'Lead' AND column_name = 'listId'
);
SET @sql := IF(
  @has_list = 0,
  'ALTER TABLE `Lead` ADD COLUMN `listId` VARCHAR(191) NULL AFTER `ownerUserId`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Indexes (idempotent)
SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = @db AND table_name = 'Lead' AND index_name = 'Lead_workspaceId_stage_idx'
);
SET @sql := IF(
  @has_idx = 0,
  'CREATE INDEX `Lead_workspaceId_stage_idx` ON `Lead`(`workspaceId`,`stage`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = @db AND table_name = 'Lead' AND index_name = 'Lead_workspaceId_ownerUserId_idx'
);
SET @sql := IF(
  @has_idx = 0,
  'CREATE INDEX `Lead_workspaceId_ownerUserId_idx` ON `Lead`(`workspaceId`,`ownerUserId`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = @db AND table_name = 'Lead' AND index_name = 'Lead_workspaceId_listId_idx'
);
SET @sql := IF(
  @has_idx = 0,
  'CREATE INDEX `Lead_workspaceId_listId_idx` ON `Lead`(`workspaceId`,`listId`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- LeadList
CREATE TABLE IF NOT EXISTS `LeadList` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `LeadList_workspaceId_name_key` (`workspaceId`,`name`),
  KEY `LeadList_workspaceId_updatedAt_idx` (`workspaceId`,`updatedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- LeadNote (notes / call logs)
CREATE TABLE IF NOT EXISTS `LeadNote` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `leadId` VARCHAR(191) NOT NULL,
  `authorUserId` VARCHAR(191) NULL,
  `kind` VARCHAR(191) NOT NULL DEFAULT 'note',
  `body` LONGTEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `LeadNote_workspaceId_leadId_createdAt_idx` (`workspaceId`,`leadId`,`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- LeadTask (reminders)
CREATE TABLE IF NOT EXISTS `LeadTask` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `leadId` VARCHAR(191) NOT NULL,
  `createdByUserId` VARCHAR(191) NULL,
  `title` VARCHAR(191) NOT NULL,
  `dueAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `LeadTask_workspaceId_leadId_dueAt_idx` (`workspaceId`,`leadId`,`dueAt`),
  KEY `LeadTask_workspaceId_completedAt_idx` (`workspaceId`,`completedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- LeadActivity (timeline)
CREATE TABLE IF NOT EXISTS `LeadActivity` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `leadId` VARCHAR(191) NOT NULL,
  `actorUserId` VARCHAR(191) NULL,
  `type` VARCHAR(191) NOT NULL,
  `text` LONGTEXT NULL,
  `meta` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `LeadActivity_workspaceId_leadId_createdAt_idx` (`workspaceId`,`leadId`,`createdAt`),
  KEY `LeadActivity_workspaceId_type_idx` (`workspaceId`,`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Foreign keys
-- Foreign keys (idempotent)
SET @has_fk := (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE constraint_schema = @db AND table_name = 'Lead' AND constraint_name = 'Lead_ownerUserId_fkey'
);
SET @sql := IF(
  @has_fk = 0,
  'ALTER TABLE `Lead` ADD CONSTRAINT `Lead_ownerUserId_fkey` FOREIGN KEY (`ownerUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk := (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE constraint_schema = @db AND table_name = 'Lead' AND constraint_name = 'Lead_listId_fkey'
);
SET @sql := IF(
  @has_fk = 0,
  'ALTER TABLE `Lead` ADD CONSTRAINT `Lead_listId_fkey` FOREIGN KEY (`listId`) REFERENCES `LeadList`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk := (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE constraint_schema = @db AND table_name = 'LeadList' AND constraint_name = 'LeadList_workspaceId_fkey'
);
SET @sql := IF(
  @has_fk = 0,
  'ALTER TABLE `LeadList` ADD CONSTRAINT `LeadList_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk := (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE constraint_schema = @db AND table_name = 'LeadNote' AND constraint_name = 'LeadNote_workspaceId_fkey'
);
SET @sql := IF(
  @has_fk = 0,
  'ALTER TABLE `LeadNote` ADD CONSTRAINT `LeadNote_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk := (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE constraint_schema = @db AND table_name = 'LeadNote' AND constraint_name = 'LeadNote_leadId_fkey'
);
SET @sql := IF(
  @has_fk = 0,
  'ALTER TABLE `LeadNote` ADD CONSTRAINT `LeadNote_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk := (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE constraint_schema = @db AND table_name = 'LeadNote' AND constraint_name = 'LeadNote_authorUserId_fkey'
);
SET @sql := IF(
  @has_fk = 0,
  'ALTER TABLE `LeadNote` ADD CONSTRAINT `LeadNote_authorUserId_fkey` FOREIGN KEY (`authorUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk := (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE constraint_schema = @db AND table_name = 'LeadTask' AND constraint_name = 'LeadTask_workspaceId_fkey'
);
SET @sql := IF(
  @has_fk = 0,
  'ALTER TABLE `LeadTask` ADD CONSTRAINT `LeadTask_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk := (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE constraint_schema = @db AND table_name = 'LeadTask' AND constraint_name = 'LeadTask_leadId_fkey'
);
SET @sql := IF(
  @has_fk = 0,
  'ALTER TABLE `LeadTask` ADD CONSTRAINT `LeadTask_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk := (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE constraint_schema = @db AND table_name = 'LeadTask' AND constraint_name = 'LeadTask_createdByUserId_fkey'
);
SET @sql := IF(
  @has_fk = 0,
  'ALTER TABLE `LeadTask` ADD CONSTRAINT `LeadTask_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk := (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE constraint_schema = @db AND table_name = 'LeadActivity' AND constraint_name = 'LeadActivity_workspaceId_fkey'
);
SET @sql := IF(
  @has_fk = 0,
  'ALTER TABLE `LeadActivity` ADD CONSTRAINT `LeadActivity_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk := (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE constraint_schema = @db AND table_name = 'LeadActivity' AND constraint_name = 'LeadActivity_leadId_fkey'
);
SET @sql := IF(
  @has_fk = 0,
  'ALTER TABLE `LeadActivity` ADD CONSTRAINT `LeadActivity_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk := (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE constraint_schema = @db AND table_name = 'LeadActivity' AND constraint_name = 'LeadActivity_actorUserId_fkey'
);
SET @sql := IF(
  @has_fk = 0,
  'ALTER TABLE `LeadActivity` ADD CONSTRAINT `LeadActivity_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
