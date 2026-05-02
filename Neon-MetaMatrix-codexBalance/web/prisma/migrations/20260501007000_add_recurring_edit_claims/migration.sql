ALTER TABLE "RecurringEdit"
ADD COLUMN IF NOT EXISTS "lastRunId" TEXT,
ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lockedBy" TEXT,
ADD COLUMN IF NOT EXISTS "lockExpiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "RecurringEdit_shop_status_isDeleted_nextRunAt_lockExpiresAt_idx"
ON "RecurringEdit" ("shop", "status", "isDeleted", "nextRunAt", "lockExpiresAt");

CREATE INDEX IF NOT EXISTS "RecurringEdit_shop_lockedBy_idx"
ON "RecurringEdit" ("shop", "lockedBy");
