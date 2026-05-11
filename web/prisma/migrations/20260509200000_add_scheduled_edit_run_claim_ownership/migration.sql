ALTER TABLE "ScheduledEditRun"
  ADD COLUMN IF NOT EXISTS "claimedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "executionKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ScheduledEditRun_shop_executionKey_key"
  ON "ScheduledEditRun"("shop", "executionKey");

CREATE INDEX IF NOT EXISTS "ScheduledEditRun_shop_claimedBy_idx"
  ON "ScheduledEditRun"("shop", "claimedBy");
