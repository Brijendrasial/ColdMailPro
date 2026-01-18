-- Leads workflow + productivity features (v1.7)
SET NAMES utf8mb4;

-- Add workflow fields to Lead
ALTER TABLE `Lead`
  ADD COLUMN `stage` VARCHAR(191) NOT NULL DEFAULT 'new' AFTER `status`,
  ADD COLUMN `ownerUserId` VARCHAR(191) NULL AFTER `stage`,
  ADD COLUMN `listId` VARCHAR(191) NULL AFTER `ownerUserId`;

CREATE INDEX `Lead_workspaceId_stage_idx` ON `Lead`(`workspaceId`,`stage`);
CREATE INDEX `Lead_workspaceId_ownerUserId_idx` ON `Lead`(`workspaceId`,`ownerUserId`);
CREATE INDEX `Lead_workspaceId_listId_idx` ON `Lead`(`workspaceId`,`listId`);

-- LeadList
CREATE TABLE `LeadList` (
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
CREATE TABLE `LeadNote` (
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
CREATE TABLE `LeadTask` (
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
CREATE TABLE `LeadActivity` (
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
ALTER TABLE `Lead`
  ADD CONSTRAINT `Lead_ownerUserId_fkey` FOREIGN KEY (`ownerUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `Lead_listId_fkey` FOREIGN KEY (`listId`) REFERENCES `LeadList`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `LeadList`
  ADD CONSTRAINT `LeadList_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `LeadNote`
  ADD CONSTRAINT `LeadNote_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `LeadNote_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `LeadNote_authorUserId_fkey` FOREIGN KEY (`authorUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `LeadTask`
  ADD CONSTRAINT `LeadTask_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `LeadTask_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `LeadTask_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `LeadActivity`
  ADD CONSTRAINT `LeadActivity_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `LeadActivity_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `LeadActivity_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
