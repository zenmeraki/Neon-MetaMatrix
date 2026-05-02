ALTER TABLE "AutomaticProductRule"
ADD COLUMN IF NOT EXISTS "scope" JSONB,
ADD COLUMN IF NOT EXISTS "executionMode" TEXT NOT NULL DEFAULT 'REALTIME',
ADD COLUMN IF NOT EXISTS "conflictStrategy" TEXT NOT NULL DEFAULT 'PRIORITY_WINS',
ADD COLUMN IF NOT EXISTS "maxExecutionsPerHour" INTEGER;

CREATE INDEX IF NOT EXISTS "AutomaticProductRule_shop_executionMode_status_idx"
ON "AutomaticProductRule"("shop", "executionMode", "status");

ALTER TYPE "AutomaticProductRuleRunTriggerSource" ADD VALUE IF NOT EXISTS 'DRY_RUN';
