DROP INDEX IF EXISTS "BulkUndoTargetSnapshot_shop_executionIdentity_productId_key";
DROP INDEX IF EXISTS "BulkUndoTargetSnapshot_shop_executionIdentity_ordinal_key";
DROP INDEX IF EXISTS "BulkUndoTargetSnapshot_shop_executionIdentity_ordinal_idx";
DROP INDEX IF EXISTS "BulkUndoTargetSnapshot_shop_historyId_idx";

ALTER TABLE "BulkUndoTargetSnapshot" DROP COLUMN IF EXISTS "changeHash";
ALTER TABLE "BulkUndoTargetSnapshot" ADD COLUMN IF NOT EXISTS "changeRecordId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "BulkUndoTargetSnapshot" ADD COLUMN IF NOT EXISTS "variantId" TEXT;
ALTER TABLE "BulkUndoTargetSnapshot" ADD COLUMN IF NOT EXISTS "scope" TEXT NOT NULL DEFAULT 'PRODUCT';
ALTER TABLE "BulkUndoTargetSnapshot" ADD COLUMN IF NOT EXISTS "field" TEXT NOT NULL DEFAULT '';
ALTER TABLE "BulkUndoTargetSnapshot" ADD COLUMN IF NOT EXISTS "previousValue" JSONB NOT NULL DEFAULT 'null'::jsonb;
ALTER TABLE "BulkUndoTargetSnapshot" ADD COLUMN IF NOT EXISTS "currentValue" JSONB;
ALTER TABLE "BulkUndoTargetSnapshot" ADD COLUMN IF NOT EXISTS "targetHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "BulkUndoTargetSnapshot" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'FROZEN';
ALTER TABLE "BulkUndoTargetSnapshot" ADD COLUMN IF NOT EXISTS "errorCode" TEXT;
ALTER TABLE "BulkUndoTargetSnapshot" ADD COLUMN IF NOT EXISTS "errorMessage" TEXT;
ALTER TABLE "BulkUndoTargetSnapshot" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "BulkUndoTargetSnapshot_shop_executionIdentity_changeRecordId_scope_field_productId_variantId_key"
  ON "BulkUndoTargetSnapshot"("shop", "executionIdentity", "changeRecordId", "scope", "field", "productId", "variantId");

CREATE UNIQUE INDEX IF NOT EXISTS "BulkUndoTargetSnapshot_shop_executionIdentity_ordinal_key"
  ON "BulkUndoTargetSnapshot"("shop", "executionIdentity", "ordinal");

CREATE INDEX IF NOT EXISTS "BulkUndoTargetSnapshot_shop_executionIdentity_ordinal_idx"
  ON "BulkUndoTargetSnapshot"("shop", "executionIdentity", "ordinal");

CREATE INDEX IF NOT EXISTS "BulkUndoTargetSnapshot_shop_executionIdentity_status_idx"
  ON "BulkUndoTargetSnapshot"("shop", "executionIdentity", "status");

CREATE INDEX IF NOT EXISTS "BulkUndoTargetSnapshot_shop_historyId_idx"
  ON "BulkUndoTargetSnapshot"("shop", "historyId");

CREATE INDEX IF NOT EXISTS "BulkUndoTargetSnapshot_shop_productId_idx"
  ON "BulkUndoTargetSnapshot"("shop", "productId");

CREATE INDEX IF NOT EXISTS "BulkUndoTargetSnapshot_shop_variantId_idx"
  ON "BulkUndoTargetSnapshot"("shop", "variantId");
