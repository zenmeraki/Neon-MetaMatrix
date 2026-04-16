-- Raw Postgres indexes for bulk-editor product filtering.
-- These statements intentionally use CONCURRENTLY to avoid blocking writes while
-- the Product table is large. Do not wrap this migration in an explicit transaction.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP INDEX CONCURRENTLY IF EXISTS "Product_shop_mirrorBatchId_descriptionText_idx";
DROP INDEX CONCURRENTLY IF EXISTS "Product_descriptionText_fts_gin_idx";

CREATE INDEX CONCURRENTLY IF NOT EXISTS product_tags_gin
  ON "Product" USING GIN ("tags")
  WHERE "tags" IS NOT NULL
    AND cardinality("tags") > 0;

CREATE INDEX CONCURRENTLY IF NOT EXISTS product_description_text_trgm_gin
  ON "Product" USING GIN ("descriptionText" gin_trgm_ops)
  WHERE "descriptionText" IS NOT NULL
    AND "descriptionText" <> '';
