ALTER TABLE "ProductTombstone"
  ADD COLUMN IF NOT EXISTS "sourceEventId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceSequence" BIGINT;

CREATE INDEX IF NOT EXISTS "ProductTombstone_shop_sourceEventId_idx"
  ON "ProductTombstone"("shop", "sourceEventId");

CREATE INDEX IF NOT EXISTS "ProductTombstone_shop_sourceSequence_idx"
  ON "ProductTombstone"("shop", "sourceSequence");
