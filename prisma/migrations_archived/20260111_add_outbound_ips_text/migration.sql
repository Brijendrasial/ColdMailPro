-- Add outbound IPs text field to store sending IP pool for SPF suggestions
ALTER TABLE `MailstackConfig`
  ADD COLUMN `outboundIpsText` LONGTEXT NULL;
