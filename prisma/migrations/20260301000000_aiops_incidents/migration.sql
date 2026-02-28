-- CreateTable
CREATE TABLE `Incident` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NULL,
  `severity` VARCHAR(32) NOT NULL,
  `source` VARCHAR(64) NOT NULL,
  `signature` VARCHAR(191) NOT NULL,
  `summary` LONGTEXT NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'open',
  `evidenceJson` JSON NULL,
  `suggestedFixesJson` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `Incident_workspaceId_createdAt_idx` (`workspaceId`, `createdAt`),
  INDEX `Incident_signature_status_idx` (`signature`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IncidentAction` (
  `id` VARCHAR(191) NOT NULL,
  `incidentId` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(16) NOT NULL,
  `actionType` VARCHAR(64) NOT NULL,
  `argsJson` JSON NULL,
  `commandPreview` LONGTEXT NULL,
  `appliedAt` DATETIME(3) NULL,
  `outcome` VARCHAR(32) NULL,
  `logs` LONGTEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `IncidentAction_incidentId_createdAt_idx` (`incidentId`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Incident` ADD CONSTRAINT `Incident_workspaceId_fkey`
  FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IncidentAction` ADD CONSTRAINT `IncidentAction_incidentId_fkey`
  FOREIGN KEY (`incidentId`) REFERENCES `Incident`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
