-- AI Replies: per-reply classification + draft/sent tracking

CREATE TABLE `ReplyAiAction` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `leadId` VARCHAR(191) NOT NULL,
  `replyEventId` VARCHAR(191) NOT NULL,
  `sentiment` VARCHAR(191) NOT NULL,
  `intent` VARCHAR(191) NULL,
  `confidence` DOUBLE NOT NULL DEFAULT 0,
  `action` VARCHAR(191) NOT NULL DEFAULT 'none',
  `draftSubject` VARCHAR(512) NULL,
  `draftBodyText` LONGTEXT NULL,
  `sentMessageId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ReplyAiAction_workspaceId_replyEventId_key` (`workspaceId`, `replyEventId`),
  INDEX `ReplyAiAction_workspaceId_leadId_createdAt_idx` (`workspaceId`, `leadId`, `createdAt`),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ReplyAiAction` ADD CONSTRAINT `ReplyAiAction_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ReplyAiAction` ADD CONSTRAINT `ReplyAiAction_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ReplyAiAction` ADD CONSTRAINT `ReplyAiAction_replyEventId_fkey` FOREIGN KEY (`replyEventId`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ReplyAiAction` ADD CONSTRAINT `ReplyAiAction_sentMessageId_fkey` FOREIGN KEY (`sentMessageId`) REFERENCES `Message`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
