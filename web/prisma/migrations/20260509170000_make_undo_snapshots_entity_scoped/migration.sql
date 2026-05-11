ALTER TABLE "BulkUndoTargetSnapshot"
ADD COLUMN IF NOT EXISTS "variantId" TEXT,
ADD COLUMN IF NOT EXISTS "field" TEXT,
ADD COLUMN IF NOT EXISTS "entityKey" TEXT;

UPDATE "BulkUndoTargetSnapshot"
SET "entityKey" = CONCAT("productId", ':', COALESCE("variantId", 'product'), ':', COALESCE("field", '*'))
WHERE "entityKey" IS NULL;

ALTER TABLE "BulkUndoTargetSnapshot"
ALTER COLUMN "entityKey" SET NOT NULL;

DROP INDEX IF EXISTS "BulkUndoTargetSnapshot_shop_executionIdentity_productId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "BulkUndoTargetSnapshot_shop_executionIdentity_entityKey_key"
  ON "BulkUndoTargetSnapshot"("shop", "executionIdentity", "entityKey");

CREATE INDEX IF NOT EXISTS "BulkUndoTargetSnapshot_shop_executionIdentity_productId_idx"
  ON "BulkUndoTargetSnapshot"("shop", "executionIdentity", "productId");

CREATE INDEX IF NOT EXISTS "BulkUndoTargetSnapshot_shop_executionIdentity_variantId_idx"
  ON "BulkUndoTargetSnapshot"("shop", "executionIdentity", "variantId");
