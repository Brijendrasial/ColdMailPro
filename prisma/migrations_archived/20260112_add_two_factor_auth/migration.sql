-- Add Two-Factor Authentication (TOTP) fields to User
ALTER TABLE `User`
  ADD COLUMN `twoFactorEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `twoFactorSecretEnc` LONGTEXT NULL,
  ADD COLUMN `twoFactorTempSecretEnc` LONGTEXT NULL,
  ADD COLUMN `twoFactorRecoveryCodesHash` LONGTEXT NULL,
  ADD COLUMN `twoFactorEnabledAt` DATETIME(3) NULL;
