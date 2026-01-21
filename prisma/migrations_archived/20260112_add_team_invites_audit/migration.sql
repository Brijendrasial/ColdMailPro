-- Team invites for onboarding
CREATE TABLE `WorkspaceInvite` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `role` VARCHAR(191) NOT NULL DEFAULT 'member',
  `tokenHash` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `usedAt` DATETIME(3) NULL,
  `createdByUserId` VARCHAR(191) NULL,
  `usedByUserId` VARCHAR(191) NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `WorkspaceInvite_tokenHash_key` (`tokenHash`),
  INDEX `WorkspaceInvite_workspaceId_email_idx` (`workspaceId`, `email`),
  INDEX `WorkspaceInvite_workspaceId_usedAt_idx` (`workspaceId`, `usedAt`),
  CONSTRAINT `WorkspaceInvite_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `WorkspaceInvite_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `WorkspaceInvite_usedByUserId_fkey` FOREIGN KEY (`usedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Audit trail for high-impact actions
CREATE TABLE `AuditLog` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `actorUserId` VARCHAR(191) NULL,
  `action` VARCHAR(191) NOT NULL,
  `targetType` VARCHAR(191) NULL,
  `targetId` VARCHAR(191) NULL,
  `ip` VARCHAR(191) NULL,
  `userAgent` LONGTEXT NULL,
  `meta` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `AuditLog_workspaceId_createdAt_idx` (`workspaceId`, `createdAt`),
  INDEX `AuditLog_workspaceId_action_idx` (`workspaceId`, `action`),
  CONSTRAINT `AuditLog_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `AuditLog_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
