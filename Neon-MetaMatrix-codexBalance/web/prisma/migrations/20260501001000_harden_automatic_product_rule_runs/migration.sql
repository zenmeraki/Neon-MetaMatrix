-- Add run lease and retry bookkeeping for deterministic claim/recovery paths.
ALTER TABLE "AutomaticProductRuleRun"
ADD COLUMN IF NOT EXISTS "processingLeaseUntil" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "processingLeaseOwner" TEXT,
ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "AutomaticProductRuleRun_shop_status_editHistoryId_createdAt_idx"
ON "AutomaticProductRuleRun" ("shop", "status", "editHistoryId", "createdAt");

CREATE INDEX IF NOT EXISTS "AutomaticProductRuleRun_shop_status_processingLeaseUntil_idx"
ON "AutomaticProductRuleRun" ("shop", "status", "processingLeaseUntil");
