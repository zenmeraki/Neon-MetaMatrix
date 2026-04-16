-- Collection authority fix:
-- Collection rows and ProductCollectionMembership rows now share catalogBatchId
-- as the authoritative batch key. mirrorBatchId remains a compatibility alias.

ALTER TABLE "Collection"
  ADD COLUMN IF NOT EXISTS "catalogBatchId" TEXT;

UPDATE "Collection"
SET "catalogBatchId" = "mirrorBatchId"
WHERE "catalogBatchId" IS NULL
  AND "mirrorBatchId" IS NOT NULL;

ALTER TABLE "Collection"
  ALTER COLUMN "catalogBatchId" SET NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Collection_shop_catalogBatchId_shopifyId_key"
  ON "Collection" ("shop", "catalogBatchId", "shopifyId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Collection_shop_catalogBatchId_idx"
  ON "Collection" ("shop", "catalogBatchId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Collection_shop_catalogBatchId_title_idx"
  ON "Collection" ("shop", "catalogBatchId", "title");

ALTER TABLE "Collection"
  ADD CONSTRAINT "Collection_catalog_mirror_batch_match"
  CHECK ("mirrorBatchId" = "catalogBatchId") NOT VALID;

COMMENT ON COLUMN "Collection"."catalogBatchId" IS
  'Authoritative collection batch identity. Collection and ProductCollectionMembership must use the same catalogBatchId for read-plane trust.';

COMMENT ON COLUMN "Collection"."mirrorBatchId" IS
  'Legacy compatibility alias only; must match catalogBatchId while old callers drain.';
