ALTER TABLE "Variant"
  ADD COLUMN IF NOT EXISTS "priceDecimal" DECIMAL(18, 6),
  ADD COLUMN IF NOT EXISTS "compareAtPriceDecimal" DECIMAL(18, 6),
  ADD COLUMN IF NOT EXISTS "costDecimal" DECIMAL(18, 6),
  ADD COLUMN IF NOT EXISTS "weightDecimal" DECIMAL(18, 6),
  ADD COLUMN IF NOT EXISTS "profitMarginDecimal" DECIMAL(9, 4);

-- For large production tables, run index creation concurrently if your
-- migration execution path is non-transactional and supports it.
CREATE INDEX IF NOT EXISTS "Variant_shop_catalogBatchId_priceDecimal_idx"
  ON "Variant"("shop", "catalogBatchId", "priceDecimal");

CREATE INDEX IF NOT EXISTS "Variant_shop_catalogBatchId_compareAtPriceDecimal_idx"
  ON "Variant"("shop", "catalogBatchId", "compareAtPriceDecimal");

CREATE INDEX IF NOT EXISTS "Variant_shop_catalogBatchId_costDecimal_idx"
  ON "Variant"("shop", "catalogBatchId", "costDecimal");

CREATE INDEX IF NOT EXISTS "Variant_shop_catalogBatchId_weightDecimal_idx"
  ON "Variant"("shop", "catalogBatchId", "weightDecimal");

ALTER TABLE "ProductCollectionMembership"
  ADD COLUMN IF NOT EXISTS "sourceUpdatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sourceEventAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ProductCollectionMembership_shop_catalogBatchId_sourceUpdatedAt_idx"
  ON "ProductCollectionMembership"("shop", "catalogBatchId", "sourceUpdatedAt");

CREATE INDEX IF NOT EXISTS "VariantInventoryLevel_shop_catalogBatchId_sourceUpdatedAt_idx"
  ON "VariantInventoryLevel"("shop", "catalogBatchId", "sourceUpdatedAt");

CREATE INDEX IF NOT EXISTS "ProductTrackedMetafield_shop_catalogBatchId_sourceUpdatedAt_idx"
  ON "ProductTrackedMetafield"("shop", "catalogBatchId", "sourceUpdatedAt");

CREATE INDEX IF NOT EXISTS "VariantTrackedMetafield_shop_catalogBatchId_sourceUpdatedAt_idx"
  ON "VariantTrackedMetafield"("shop", "catalogBatchId", "sourceUpdatedAt");
