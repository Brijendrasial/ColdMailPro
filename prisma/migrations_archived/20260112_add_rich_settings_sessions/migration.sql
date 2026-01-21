-- Add JSON settings storage for User and Workspace
ALTER TABLE `User`
  ADD COLUMN `settingsJson` JSON NULL;

ALTER TABLE `Workspace`
  ADD COLUMN `settingsJson` JSON NULL;

-- Session tracking (devices) for account security
CREATE TABLE `UserSession` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `ip` VARCHAR(191) NULL,
  `userAgent` LONGTEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `revokedAt` DATETIME(3) NULL,
  `revokedReason` VARCHAR(191) NULL,

  PRIMARY KEY (`id`),
  INDEX `UserSession_userId_workspaceId_idx` (`userId`, `workspaceId`),
  INDEX `UserSession_revokedAt_idx` (`revokedAt`),
  CONSTRAINT `UserSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `UserSession_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
