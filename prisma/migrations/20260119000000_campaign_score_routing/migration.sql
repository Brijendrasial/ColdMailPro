-- Add mailboxMinIdleMinutes for score_idle routing strategy
-- Idempotent: only add the column if it doesn't already exist.

SET @__cm_col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'Campaign'
    AND COLUMN_NAME = 'mailboxMinIdleMinutes'
);

SET @__cm_sql := IF(
  @__cm_col_exists = 0,
  'ALTER TABLE `Campaign` ADD COLUMN `mailboxMinIdleMinutes` INTEGER NOT NULL DEFAULT 0',
  'SELECT 1'
);

PREPARE __cm_stmt FROM @__cm_sql;
EXECUTE __cm_stmt;
DEALLOCATE PREPARE __cm_stmt;
