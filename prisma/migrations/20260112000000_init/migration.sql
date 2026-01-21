-- Auto-generated init migration for ColdMail Pro (MySQL)
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS=0;

CREATE TABLE `User` (
  `id` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NULL,
  `passwordHash` VARCHAR(191) NOT NULL,
  `settingsJson` JSON NULL,
  `twoFactorEnabled` BOOLEAN NOT NULL DEFAULT 0,
  `twoFactorSecretEnc` LONGTEXT NULL,
  `twoFactorTempSecretEnc` LONGTEXT NULL,
  `twoFactorRecoveryCodesHash` LONGTEXT NULL,
  `twoFactorEnabledAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `User_email_key` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Workspace` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `settingsJson` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Membership` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `role` VARCHAR(191) NOT NULL DEFAULT 'owner',
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Membership_userId_workspaceId_key` (`userId`,`workspaceId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `WorkspaceInvite` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `role` VARCHAR(191) NOT NULL DEFAULT 'member',
  `tokenHash` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL,
  `usedAt` DATETIME(3) NULL,
  `createdByUserId` VARCHAR(191) NULL,
  `usedByUserId` VARCHAR(191) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `WorkspaceInvite_tokenHash_key` (`tokenHash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Domain` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `dkimSelector` VARCHAR(191) NOT NULL DEFAULT 'cm',
  `dkimPrivate` LONGTEXT NULL,
  `dkimPublic` LONGTEXT NULL,
  `pendingDkimSelector` VARCHAR(191) NULL,
  `pendingDkimPublic` LONGTEXT NULL,
  `pendingDkimCreatedAt` DATETIME(3) NULL,
  `trackingSubdomain` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Domain_workspaceId_name_key` (`workspaceId`,`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Mailbox` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `fromEmail` VARCHAR(191) NOT NULL,
  `replyTo` VARCHAR(191) NULL,
  `smtpHost` VARCHAR(191) NOT NULL,
  `smtpPort` INT NOT NULL,
  `smtpSecure` BOOLEAN NOT NULL DEFAULT 0,
  `smtpUser` VARCHAR(191) NOT NULL,
  `smtpPassEnc` LONGTEXT NOT NULL,
  `imapHost` VARCHAR(191) NULL,
  `imapPort` INT NOT NULL DEFAULT 993,
  `imapSecure` BOOLEAN NOT NULL DEFAULT 1,
  `imapTlsSkipVerify` BOOLEAN NOT NULL DEFAULT 0,
  `imapUser` VARCHAR(191) NULL,
  `imapPassEnc` LONGTEXT NULL,
  `imapLastUid` INT NOT NULL DEFAULT 0,
  `localAddress` VARCHAR(191) NULL,
  `dailyLimit` INT NOT NULL DEFAULT 50,
  `warmupEnabled` BOOLEAN NOT NULL DEFAULT 0,
  `isActive` BOOLEAN NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `CampaignMailbox` (
  `id` VARCHAR(191) NOT NULL,
  `campaignId` VARCHAR(191) NOT NULL,
  `mailboxId` VARCHAR(191) NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `CampaignMailbox_campaignId_mailboxId_key` (`campaignId`,`mailboxId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `MailboxThrottle` (
  `id` VARCHAR(191) NOT NULL,
  `campaignId` VARCHAR(191) NOT NULL,
  `mailboxId` VARCHAR(191) NOT NULL,
  `until` DATETIME(3) NOT NULL,
  `reason` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `MailboxThrottle_campaignId_mailboxId_key` (`campaignId`,`mailboxId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `MailboxPool` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `settingsJson` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `MailboxPool_workspaceId_name_key` (`workspaceId`,`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `MailboxPoolMember` (
  `id` VARCHAR(191) NOT NULL,
  `poolId` VARCHAR(191) NOT NULL,
  `mailboxId` VARCHAR(191) NOT NULL,
  `weight` INT NOT NULL DEFAULT 1,
  `isActive` BOOLEAN NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `MailboxPoolMember_poolId_mailboxId_key` (`poolId`,`mailboxId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Lead` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `firstName` VARCHAR(191) NULL,
  `lastName` VARCHAR(191) NULL,
  `company` VARCHAR(191) NULL,
  `website` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'active',
  `tags` LONGTEXT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Lead_workspaceId_email_key` (`workspaceId`,`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ReplyLeadState` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `leadId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'open',
  `snoozeUntil` DATETIME(3) NULL,
  `isPinned` BOOLEAN NOT NULL DEFAULT 0,
  `isStarred` BOOLEAN NOT NULL DEFAULT 0,
  `lastReadAt` DATETIME(3) NULL,
  `labels` JSON NULL,
  `assignedToUserId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `ReplyLeadState_workspaceId_leadId_key` (`workspaceId`,`leadId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Campaign` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
  `archivedAt` DATETIME(3) NULL,
  `setupStep` INT NOT NULL DEFAULT 0,
  `setupCompleted` BOOLEAN NOT NULL DEFAULT 0,
  `draftLeadIds` LONGTEXT NULL,
  `startAt` DATETIME(3) NULL,
  `endAt` DATETIME(3) NULL,
  `timezone` VARCHAR(191) NOT NULL DEFAULT 'Asia/Kolkata',
  `sendingWindow` VARCHAR(191) NOT NULL DEFAULT '09:00-18:00',
  `daysOfWeek` TEXT NULL,
  `dailySendLimit` INT NOT NULL DEFAULT 200,
  `rampEnabled` BOOLEAN NOT NULL DEFAULT 0,
  `rampStartLimit` INT NOT NULL DEFAULT 20,
  `rampDailyIncrease` INT NOT NULL DEFAULT 20,
  `rampMaxLimit` INT NOT NULL DEFAULT 200,
  `perMailboxPerMinute` INT NOT NULL DEFAULT 20,
  `domainDailyCap` INT NOT NULL DEFAULT 25,
  `domainCaps` TEXT NULL,
  `guardEnabled` BOOLEAN NOT NULL DEFAULT 1,
  `guardWindowHours` INT NOT NULL DEFAULT 24,
  `guardMinSent` INT NOT NULL DEFAULT 50,
  `guardMaxHardBounceRate` DOUBLE NOT NULL DEFAULT 0.05,
  `guardMaxBounceRate` DOUBLE NOT NULL DEFAULT 0.08,
  `guardMaxUnsubRate` DOUBLE NOT NULL DEFAULT 0.02,
  `pausedReason` TEXT NULL,
  `autoThrottleEnabled` BOOLEAN NOT NULL DEFAULT 1,
  `autoThrottleWindowMinutes` INT NOT NULL DEFAULT 60,
  `autoThrottleMinSent` INT NOT NULL DEFAULT 20,
  `autoThrottleMaxHardBounceRate` DOUBLE NOT NULL DEFAULT 0.08,
  `autoThrottleMaxBounceRate` DOUBLE NOT NULL DEFAULT 0.12,
  `autoThrottleCooldownMinutes` INT NOT NULL DEFAULT 120,
  `mailboxStrategy` VARCHAR(191) NOT NULL DEFAULT 'round_robin',
  `mailboxPoolId` VARCHAR(191) NULL,
  `stopOnReply` BOOLEAN NOT NULL DEFAULT 1,
  `stopOnBounce` BOOLEAN NOT NULL DEFAULT 1,
  `stopOnUnsubscribe` BOOLEAN NOT NULL DEFAULT 1,
  `stopOnOOO` BOOLEAN NOT NULL DEFAULT 1,
  `stopKeywords` LONGTEXT NULL,
  `notInterestedKeywords` LONGTEXT NULL,
  `oooKeywords` LONGTEXT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `SequenceStep` (
  `id` VARCHAR(191) NOT NULL,
  `campaignId` VARCHAR(191) NOT NULL,
  `stepNumber` INT NOT NULL,
  `delayDays` INT NOT NULL DEFAULT 0,
  `subjectTpl` LONGTEXT NOT NULL,
  `bodyTpl` LONGTEXT NOT NULL,
  `isReply` BOOLEAN NOT NULL DEFAULT 0,
  `abEnabled` BOOLEAN NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `SequenceStep_campaignId_stepNumber_key` (`campaignId`,`stepNumber`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `StepVariant` (
  `id` VARCHAR(191) NOT NULL,
  `stepId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `subjectTpl` LONGTEXT NOT NULL,
  `bodyTpl` LONGTEXT NOT NULL,
  `weight` INT NOT NULL DEFAULT 50,
  `isActive` BOOLEAN NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `StepVariant_stepId_name_key` (`stepId`,`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Enrollment` (
  `id` VARCHAR(191) NOT NULL,
  `campaignId` VARCHAR(191) NOT NULL,
  `leadId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'queued',
  `currentStep` INT NOT NULL DEFAULT 1,
  `nextRunAt` DATETIME(3) NOT NULL,
  `threadId` VARCHAR(191) NULL,
  `stopReason` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `Enrollment_campaignId_leadId_key` (`campaignId`,`leadId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Message` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `campaignId` VARCHAR(191) NULL,
  `mailboxId` VARCHAR(191) NULL,
  `leadId` VARCHAR(191) NULL,
  `stepNumber` INT NULL,
  `stepVariantId` VARCHAR(191) NULL,
  `subject` LONGTEXT NULL,
  `bodyHtml` LONGTEXT NULL,
  `bodyText` LONGTEXT NULL,
  `messageId` VARCHAR(191) NULL,
  `inReplyTo` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'queued',
  `error` LONGTEXT NULL,
  `smtpCode` INT NULL,
  `bounceType` VARCHAR(191) NULL,
  `sentAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Event` (
  `id` VARCHAR(191) NOT NULL,
  `messageId` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL,
  `meta` LONGTEXT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Suppression` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `reason` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Suppression_workspaceId_email_key` (`workspaceId`,`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `LeadView` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `settingsJson` JSON NULL,
  `payload` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `LeadView_workspaceId_name_key` (`workspaceId`,`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `WebhookEndpoint` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `url` VARCHAR(191) NOT NULL,
  `secret` VARCHAR(191) NOT NULL,
  `events` VARCHAR(191) NOT NULL DEFAULT 'sent,open,click,bounce,reply,unsubscribe',
  `isActive` BOOLEAN NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ApiKey` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `keyHash` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ApiKey_keyHash_key` (`keyHash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Job` (
  `id` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL,
  `payload` LONGTEXT NOT NULL,
  `runAt` DATETIME(3) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'queued',
  `attempts` INT NOT NULL DEFAULT 0,
  `lastError` LONGTEXT NULL,
  `lockedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `MailstackConfig` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `cloudflareTokenEnc` LONGTEXT NULL,
  `serverIp` VARCHAR(191) NULL,
  `outboundIpsText` LONGTEXT NULL,
  `heloTemplate` VARCHAR(191) NOT NULL DEFAULT 'mail.%d',
  `dmarcPolicy` VARCHAR(191) NOT NULL DEFAULT 'none',
  `dmarcRuaTemplate` VARCHAR(191) NOT NULL DEFAULT 'dmarc@%d',
  `createdAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `MailstackConfig_workspaceId_key` (`workspaceId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `MailstackTenant` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `serverIp` VARCHAR(191) NOT NULL,
  `heloTemplate` VARCHAR(191) NOT NULL DEFAULT 'mail.%d',
  `dmarcPolicy` VARCHAR(191) NOT NULL DEFAULT 'none',
  `dmarcRuaTemplate` VARCHAR(191) NOT NULL DEFAULT 'dmarc@%d',
  `createZones` BOOLEAN NOT NULL DEFAULT 1,
  `status` VARCHAR(191) NOT NULL DEFAULT 'active',
  `lastJobId` VARCHAR(191) NULL,
  `lastJobStatus` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `MailstackTenant_workspaceId_name_key` (`workspaceId`,`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `MailstackTenantDomain` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `domainName` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `MailstackTenantDomain_tenantId_domainName_key` (`tenantId`,`domainName`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `MailstackTenantIp` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `ip` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `MailstackTenantIp_tenantId_ip_key` (`tenantId`,`ip`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `MailstackTenantUser` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `MailstackTenantUser_tenantId_email_key` (`tenantId`,`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `MailstackMailbox` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `passwordEnc` LONGTEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `MailstackMailbox_tenantId_email_key` (`tenantId`,`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `JobLog` (
  `id` VARCHAR(191) NOT NULL,
  `jobId` VARCHAR(191) NOT NULL,
  `line` LONGTEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `AppLog` (
  `id` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  `workspaceId` VARCHAR(191) NULL,
  `userId` VARCHAR(191) NULL,
  `level` VARCHAR(191) NOT NULL DEFAULT 'info',
  `category` VARCHAR(191) NOT NULL DEFAULT 'app',
  `event` VARCHAR(191) NOT NULL DEFAULT 'event',
  `message` LONGTEXT NULL,
  `data` JSON NULL,
  `requestId` VARCHAR(191) NULL,
  `ip` VARCHAR(191) NULL,
  `userAgent` VARCHAR(191) NULL,
  `entityType` VARCHAR(191) NULL,
  `entityId` VARCHAR(191) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `WarmupProfile` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `mailboxId` VARCHAR(191) NOT NULL,
  `mode` ENUM('internal','seeds','hybrid') NOT NULL DEFAULT 'hybrid',
  `startPerDay` INT NOT NULL DEFAULT 2,
  `increasePerDay` INT NOT NULL DEFAULT 1,
  `maxPerDay` INT NOT NULL DEFAULT 10,
  `timezone` VARCHAR(191) NOT NULL DEFAULT 'UTC',
  `windowStartMin` INT NOT NULL DEFAULT 540,
  `windowEndMin` INT NOT NULL DEFAULT 1020,
  `weekdaysOnly` BOOLEAN NOT NULL DEFAULT 1,
  `isActive` BOOLEAN NOT NULL DEFAULT 1,
  `startedAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `WarmupProfile_mailboxId_key` (`mailboxId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `WarmupSeedInbox` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `source` VARCHAR(191) NOT NULL DEFAULT 'manual',
  `name` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `imapHost` VARCHAR(191) NOT NULL,
  `imapPort` INT NOT NULL DEFAULT 993,
  `imapSecure` BOOLEAN NOT NULL DEFAULT 1,
  `imapUser` VARCHAR(191) NOT NULL,
  `imapPassEnc` LONGTEXT NOT NULL,
  `smtpHost` VARCHAR(191) NULL,
  `smtpPort` INT NULL,
  `smtpSecure` BOOLEAN NOT NULL DEFAULT 0,
  `smtpUser` VARCHAR(191) NULL,
  `smtpPassEnc` LONGTEXT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT 1,
  `lastCheckedAt` DATETIME(3) NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `WarmupSeedInbox_workspaceId_email_key` (`workspaceId`,`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `WarmupTemplate` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `source` VARCHAR(191) NOT NULL DEFAULT 'manual',
  `type` ENUM('initial','reply') NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `subject` VARCHAR(191) NOT NULL,
  `text` LONGTEXT NOT NULL,
  `html` LONGTEXT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT 1,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `WarmupThread` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `fromMailboxId` VARCHAR(191) NOT NULL,
  `toMailboxId` VARCHAR(191) NULL,
  `toSeedInboxId` VARCHAR(191) NULL,
  `subject` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'open',
  `lastActivityAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `WarmupMessage` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `mailboxId` VARCHAR(191) NOT NULL,
  `threadId` VARCHAR(191) NOT NULL,
  `direction` VARCHAR(191) NOT NULL,
  `fromEmail` VARCHAR(191) NOT NULL,
  `toEmail` VARCHAR(191) NOT NULL,
  `subject` VARCHAR(191) NOT NULL,
  `text` LONGTEXT NOT NULL,
  `html` LONGTEXT NULL,
  `messageId` VARCHAR(191) NULL,
  `inReplyTo` VARCHAR(191) NULL,
  `references` VARCHAR(191) NULL,
  `sentAt` DATETIME(3) NULL,
  `receivedAt` DATETIME(3) NULL,
  `placement` ENUM('inbox','spam','unknown') NOT NULL DEFAULT 'unknown',
  `placementFolder` VARCHAR(191) NULL,
  `openedAt` DATETIME(3) NULL,
  `starredAt` DATETIME(3) NULL,
  `rescuedToInboxAt` DATETIME(3) NULL,
  `archivedAt` DATETIME(3) NULL,
  `seedInboxId` VARCHAR(191) NULL,
  `error` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `UserSession` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `ip` VARCHAR(191) NULL,
  `userAgent` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL,
  `lastSeenAt` DATETIME(3) NOT NULL,
  `revokedAt` DATETIME(3) NULL,
  `revokedReason` VARCHAR(191) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;



CREATE INDEX `Membership_workspaceId_idx` ON `Membership` (`workspaceId`);

CREATE INDEX `WorkspaceInvite_workspaceId_email_idx` ON `WorkspaceInvite` (`workspaceId`,`email`);
CREATE INDEX `WorkspaceInvite_workspaceId_usedAt_idx` ON `WorkspaceInvite` (`workspaceId`,`usedAt`);
CREATE INDEX `WorkspaceInvite_createdByUserId_idx` ON `WorkspaceInvite` (`createdByUserId`);
CREATE INDEX `WorkspaceInvite_usedByUserId_idx` ON `WorkspaceInvite` (`usedByUserId`);

CREATE INDEX `AuditLog_workspaceId_createdAt_idx` ON `AuditLog` (`workspaceId`,`createdAt`);
CREATE INDEX `AuditLog_workspaceId_action_idx` ON `AuditLog` (`workspaceId`,`action`);
CREATE INDEX `AuditLog_actorUserId_idx` ON `AuditLog` (`actorUserId`);


CREATE INDEX `Mailbox_workspaceId_idx` ON `Mailbox` (`workspaceId`);

CREATE INDEX `CampaignMailbox_campaignId_isActive_idx` ON `CampaignMailbox` (`campaignId`,`isActive`);
CREATE INDEX `CampaignMailbox_mailboxId_idx` ON `CampaignMailbox` (`mailboxId`);

CREATE INDEX `MailboxThrottle_campaignId_until_idx` ON `MailboxThrottle` (`campaignId`,`until`);
CREATE INDEX `MailboxThrottle_mailboxId_until_idx` ON `MailboxThrottle` (`mailboxId`,`until`);

CREATE INDEX `MailboxPool_workspaceId_updatedAt_idx` ON `MailboxPool` (`workspaceId`,`updatedAt`);

CREATE INDEX `MailboxPoolMember_poolId_isActive_idx` ON `MailboxPoolMember` (`poolId`,`isActive`);
CREATE INDEX `MailboxPoolMember_mailboxId_isActive_idx` ON `MailboxPoolMember` (`mailboxId`,`isActive`);


CREATE INDEX `ReplyLeadState_workspaceId_status_idx` ON `ReplyLeadState` (`workspaceId`,`status`);
CREATE INDEX `ReplyLeadState_workspaceId_isPinned_isStarred_idx` ON `ReplyLeadState` (`workspaceId`,`isPinned`,`isStarred`);
CREATE INDEX `ReplyLeadState_workspaceId_snoozeUntil_idx` ON `ReplyLeadState` (`workspaceId`,`snoozeUntil`);
CREATE INDEX `ReplyLeadState_leadId_idx` ON `ReplyLeadState` (`leadId`);
CREATE INDEX `ReplyLeadState_assignedToUserId_idx` ON `ReplyLeadState` (`assignedToUserId`);

CREATE INDEX `Campaign_mailboxPoolId_idx` ON `Campaign` (`mailboxPoolId`);
CREATE INDEX `Campaign_workspaceId_idx` ON `Campaign` (`workspaceId`);


CREATE INDEX `StepVariant_stepId_isActive_idx` ON `StepVariant` (`stepId`,`isActive`);

CREATE INDEX `Enrollment_leadId_idx` ON `Enrollment` (`leadId`);

CREATE INDEX `Message_workspaceId_idx` ON `Message` (`workspaceId`);
CREATE INDEX `Message_campaignId_idx` ON `Message` (`campaignId`);
CREATE INDEX `Message_mailboxId_idx` ON `Message` (`mailboxId`);
CREATE INDEX `Message_leadId_idx` ON `Message` (`leadId`);
CREATE INDEX `Message_stepVariantId_idx` ON `Message` (`stepVariantId`);

CREATE INDEX `Event_messageId_type_createdAt_idx` ON `Event` (`messageId`,`type`,`createdAt`);


CREATE INDEX `LeadView_workspaceId_updatedAt_idx` ON `LeadView` (`workspaceId`,`updatedAt`);

CREATE INDEX `WebhookEndpoint_workspaceId_idx` ON `WebhookEndpoint` (`workspaceId`);

CREATE INDEX `ApiKey_userId_idx` ON `ApiKey` (`userId`);

CREATE INDEX `Job_status_runAt_idx` ON `Job` (`status`,`runAt`);
CREATE INDEX `Job_type_status_runAt_idx` ON `Job` (`type`,`status`,`runAt`);







CREATE INDEX `JobLog_jobId_createdAt_idx` ON `JobLog` (`jobId`,`createdAt`);

CREATE INDEX `AppLog_workspaceId_createdAt_idx` ON `AppLog` (`workspaceId`,`createdAt`);
CREATE INDEX `AppLog_level_createdAt_idx` ON `AppLog` (`level`,`createdAt`);
CREATE INDEX `AppLog_category_createdAt_idx` ON `AppLog` (`category`,`createdAt`);
CREATE INDEX `AppLog_requestId_createdAt_idx` ON `AppLog` (`requestId`,`createdAt`);
CREATE INDEX `AppLog_entityType_entityId_idx` ON `AppLog` (`entityType`,`entityId`);
CREATE INDEX `AppLog_userId_idx` ON `AppLog` (`userId`);

CREATE INDEX `WarmupProfile_workspaceId_isActive_idx` ON `WarmupProfile` (`workspaceId`,`isActive`);

CREATE INDEX `WarmupSeedInbox_workspaceId_isActive_idx` ON `WarmupSeedInbox` (`workspaceId`,`isActive`);
CREATE INDEX `WarmupSeedInbox_workspaceId_source_idx` ON `WarmupSeedInbox` (`workspaceId`,`source`);

CREATE INDEX `WarmupTemplate_workspaceId_type_isActive_idx` ON `WarmupTemplate` (`workspaceId`,`type`,`isActive`);
CREATE INDEX `WarmupTemplate_workspaceId_source_idx` ON `WarmupTemplate` (`workspaceId`,`source`);

CREATE INDEX `WarmupThread_workspaceId_lastActivityAt_idx` ON `WarmupThread` (`workspaceId`,`lastActivityAt`);
CREATE INDEX `WarmupThread_fromMailboxId_lastActivityAt_idx` ON `WarmupThread` (`fromMailboxId`,`lastActivityAt`);
CREATE INDEX `WarmupThread_toMailboxId_idx` ON `WarmupThread` (`toMailboxId`);
CREATE INDEX `WarmupThread_toSeedInboxId_idx` ON `WarmupThread` (`toSeedInboxId`);

CREATE INDEX `WarmupMessage_workspaceId_mailboxId_sentAt_idx` ON `WarmupMessage` (`workspaceId`,`mailboxId`,`sentAt`);
CREATE INDEX `WarmupMessage_workspaceId_placement_receivedAt_idx` ON `WarmupMessage` (`workspaceId`,`placement`,`receivedAt`);
CREATE INDEX `WarmupMessage_seedInboxId_receivedAt_idx` ON `WarmupMessage` (`seedInboxId`,`receivedAt`);
CREATE INDEX `WarmupMessage_mailboxId_idx` ON `WarmupMessage` (`mailboxId`);
CREATE INDEX `WarmupMessage_threadId_idx` ON `WarmupMessage` (`threadId`);

CREATE INDEX `UserSession_userId_workspaceId_idx` ON `UserSession` (`userId`,`workspaceId`);
CREATE INDEX `UserSession_revokedAt_idx` ON `UserSession` (`revokedAt`);
CREATE INDEX `UserSession_workspaceId_idx` ON `UserSession` (`workspaceId`);



ALTER TABLE `Membership` ADD CONSTRAINT `Membership_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Membership` ADD CONSTRAINT `Membership_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `WorkspaceInvite` ADD CONSTRAINT `WorkspaceInvite_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `WorkspaceInvite` ADD CONSTRAINT `WorkspaceInvite_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `WorkspaceInvite` ADD CONSTRAINT `WorkspaceInvite_usedByUserId_fkey` FOREIGN KEY (`usedByUserId`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Domain` ADD CONSTRAINT `Domain_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Mailbox` ADD CONSTRAINT `Mailbox_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `CampaignMailbox` ADD CONSTRAINT `CampaignMailbox_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `Campaign` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CampaignMailbox` ADD CONSTRAINT `CampaignMailbox_mailboxId_fkey` FOREIGN KEY (`mailboxId`) REFERENCES `Mailbox` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `MailboxThrottle` ADD CONSTRAINT `MailboxThrottle_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `Campaign` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `MailboxThrottle` ADD CONSTRAINT `MailboxThrottle_mailboxId_fkey` FOREIGN KEY (`mailboxId`) REFERENCES `Mailbox` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `MailboxPool` ADD CONSTRAINT `MailboxPool_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `MailboxPoolMember` ADD CONSTRAINT `MailboxPoolMember_poolId_fkey` FOREIGN KEY (`poolId`) REFERENCES `MailboxPool` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `MailboxPoolMember` ADD CONSTRAINT `MailboxPoolMember_mailboxId_fkey` FOREIGN KEY (`mailboxId`) REFERENCES `Mailbox` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Lead` ADD CONSTRAINT `Lead_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ReplyLeadState` ADD CONSTRAINT `ReplyLeadState_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ReplyLeadState` ADD CONSTRAINT `ReplyLeadState_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ReplyLeadState` ADD CONSTRAINT `ReplyLeadState_assignedToUserId_fkey` FOREIGN KEY (`assignedToUserId`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Campaign` ADD CONSTRAINT `Campaign_mailboxPoolId_fkey` FOREIGN KEY (`mailboxPoolId`) REFERENCES `MailboxPool` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Campaign` ADD CONSTRAINT `Campaign_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `SequenceStep` ADD CONSTRAINT `SequenceStep_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `Campaign` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `StepVariant` ADD CONSTRAINT `StepVariant_stepId_fkey` FOREIGN KEY (`stepId`) REFERENCES `SequenceStep` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Enrollment` ADD CONSTRAINT `Enrollment_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `Campaign` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Enrollment` ADD CONSTRAINT `Enrollment_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Message` ADD CONSTRAINT `Message_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Message` ADD CONSTRAINT `Message_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `Campaign` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Message` ADD CONSTRAINT `Message_mailboxId_fkey` FOREIGN KEY (`mailboxId`) REFERENCES `Mailbox` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Message` ADD CONSTRAINT `Message_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Message` ADD CONSTRAINT `Message_stepVariantId_fkey` FOREIGN KEY (`stepVariantId`) REFERENCES `StepVariant` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Event` ADD CONSTRAINT `Event_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `Message` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Suppression` ADD CONSTRAINT `Suppression_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `LeadView` ADD CONSTRAINT `LeadView_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `WebhookEndpoint` ADD CONSTRAINT `WebhookEndpoint_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ApiKey` ADD CONSTRAINT `ApiKey_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE `MailstackConfig` ADD CONSTRAINT `MailstackConfig_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `MailstackTenant` ADD CONSTRAINT `MailstackTenant_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `MailstackTenantDomain` ADD CONSTRAINT `MailstackTenantDomain_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `MailstackTenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `MailstackTenantIp` ADD CONSTRAINT `MailstackTenantIp_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `MailstackTenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `MailstackTenantUser` ADD CONSTRAINT `MailstackTenantUser_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `MailstackTenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `MailstackMailbox` ADD CONSTRAINT `MailstackMailbox_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `MailstackTenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE `AppLog` ADD CONSTRAINT `AppLog_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AppLog` ADD CONSTRAINT `AppLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `WarmupProfile` ADD CONSTRAINT `WarmupProfile_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `WarmupProfile` ADD CONSTRAINT `WarmupProfile_mailboxId_fkey` FOREIGN KEY (`mailboxId`) REFERENCES `Mailbox` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `WarmupSeedInbox` ADD CONSTRAINT `WarmupSeedInbox_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `WarmupTemplate` ADD CONSTRAINT `WarmupTemplate_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `WarmupThread` ADD CONSTRAINT `WarmupThread_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `WarmupThread` ADD CONSTRAINT `WarmupThread_fromMailboxId_fkey` FOREIGN KEY (`fromMailboxId`) REFERENCES `Mailbox` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `WarmupThread` ADD CONSTRAINT `WarmupThread_toMailboxId_fkey` FOREIGN KEY (`toMailboxId`) REFERENCES `Mailbox` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `WarmupThread` ADD CONSTRAINT `WarmupThread_toSeedInboxId_fkey` FOREIGN KEY (`toSeedInboxId`) REFERENCES `WarmupSeedInbox` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `WarmupMessage` ADD CONSTRAINT `WarmupMessage_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `WarmupMessage` ADD CONSTRAINT `WarmupMessage_mailboxId_fkey` FOREIGN KEY (`mailboxId`) REFERENCES `Mailbox` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `WarmupMessage` ADD CONSTRAINT `WarmupMessage_threadId_fkey` FOREIGN KEY (`threadId`) REFERENCES `WarmupThread` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `WarmupMessage` ADD CONSTRAINT `WarmupMessage_seedInboxId_fkey` FOREIGN KEY (`seedInboxId`) REFERENCES `WarmupSeedInbox` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `UserSession` ADD CONSTRAINT `UserSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `UserSession` ADD CONSTRAINT `UserSession_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS=1;