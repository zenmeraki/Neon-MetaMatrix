ALTER TABLE "Collection" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Collection_shop_mirrorBatchId_deletedAt_title_idx"
  ON "Collection"("shop", "mirrorBatchId", "deletedAt", "title");
