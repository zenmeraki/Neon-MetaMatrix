ALTER TABLE "Collection"
ADD COLUMN IF NOT EXISTS "collectionType" TEXT;

CREATE INDEX IF NOT EXISTS "Collection_shop_mirrorBatchId_collectionType_idx"
ON "Collection"("shop", "mirrorBatchId", "collectionType");
