ALTER TABLE "RecurringEditRun"
ADD COLUMN IF NOT EXISTS "processingLeaseUntil" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "processingLeaseOwner" TEXT,
ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "RecurringEditRun_shop_status_processingLeaseUntil_idx"
ON "RecurringEditRun" ("shop", "status", "processingLeaseUntil");

CREATE UNIQUE INDEX IF NOT EXISTS "recurring_run_shop_edit_scheduled_key"
ON "RecurringEditRun" ("shop", "recurringEditId", "scheduledFor");
