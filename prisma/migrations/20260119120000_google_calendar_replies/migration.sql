-- Google Calendar integration for Replies AI (meeting scheduling)

CREATE TABLE `GoogleCalendarAccount` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `connectedByUserId` VARCHAR(191) NOT NULL,
  `googleEmail` VARCHAR(191) NULL,
  `refreshTokenEnc` LONGTEXT NOT NULL,
  `scope` LONGTEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `GoogleCalendarAccount_workspaceId_key` (`workspaceId`),
  INDEX `GoogleCalendarAccount_workspaceId_idx` (`workspaceId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `GoogleCalendarAccount`
  ADD CONSTRAINT `GoogleCalendarAccount_workspaceId_fkey`
  FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `GoogleCalendarAccount`
  ADD CONSTRAINT `GoogleCalendarAccount_connectedByUserId_fkey`
  FOREIGN KEY (`connectedByUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Extend ReplyAiAction with optional scheduled meeting details
ALTER TABLE `ReplyAiAction`
  ADD COLUMN `scheduledProvider` VARCHAR(191) NULL,
  ADD COLUMN `scheduledEventId` VARCHAR(191) NULL,
  ADD COLUMN `scheduledMeetLink` VARCHAR(1024) NULL,
  ADD COLUMN `scheduledStart` DATETIME(3) NULL,
  ADD COLUMN `scheduledEnd` DATETIME(3) NULL,
  ADD COLUMN `scheduledConfidence` DOUBLE NULL;

CREATE INDEX `ReplyAiAction_workspaceId_scheduledStart_idx` ON `ReplyAiAction` (`workspaceId`, `scheduledStart`);
