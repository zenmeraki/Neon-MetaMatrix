ALTER TABLE "Variant"
  ADD COLUMN IF NOT EXISTS "catalogBatchId" TEXT;

-- For large production tables, run index creation concurrently if your
-- migration execution path is non-transactional and supports it.
CREATE INDEX IF NOT EXISTS "Variant_shop_catalogBatchId_idx"
  ON "Variant"("shop", "catalogBatchId");

CREATE INDEX IF NOT EXISTS "Variant_shop_productId_catalogBatchId_idx"
  ON "Variant"("shop", "productId", "catalogBatchId");

CREATE INDEX IF NOT EXISTS "Variant_shop_catalogBatchId_sku_idx"
  ON "Variant"("shop", "catalogBatchId", "sku");

CREATE INDEX IF NOT EXISTS "Variant_shop_catalogBatchId_barcode_idx"
  ON "Variant"("shop", "catalogBatchId", "barcode");

CREATE INDEX IF NOT EXISTS "Variant_shop_catalogBatchId_price_idx"
  ON "Variant"("shop", "catalogBatchId", "price");

CREATE INDEX IF NOT EXISTS "Variant_shop_catalogBatchId_compareAtPrice_idx"
  ON "Variant"("shop", "catalogBatchId", "compareAtPrice");

CREATE INDEX IF NOT EXISTS "Variant_shop_catalogBatchId_inventoryQuantity_idx"
  ON "Variant"("shop", "catalogBatchId", "inventoryQuantity");

CREATE INDEX IF NOT EXISTS "Variant_shop_catalogBatchId_inventoryPolicy_idx"
  ON "Variant"("shop", "catalogBatchId", "inventoryPolicy");

CREATE INDEX IF NOT EXISTS "Variant_shop_catalogBatchId_option1Value_idx"
  ON "Variant"("shop", "catalogBatchId", "option1Value");

CREATE INDEX IF NOT EXISTS "Variant_shop_catalogBatchId_option2Value_idx"
  ON "Variant"("shop", "catalogBatchId", "option2Value");

CREATE INDEX IF NOT EXISTS "Variant_shop_catalogBatchId_option3Value_idx"
  ON "Variant"("shop", "catalogBatchId", "option3Value");

CREATE TABLE IF NOT EXISTS "ActiveCatalogSnapshot" (
  "shop" TEXT NOT NULL,
  "catalogBatchId" TEXT NOT NULL,
  "snapshotId" TEXT,
  "isConsistent" BOOLEAN NOT NULL DEFAULT true,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActiveCatalogSnapshot_pkey" PRIMARY KEY ("shop")
);

CREATE INDEX IF NOT EXISTS "ActiveCatalogSnapshot_catalogBatchId_idx"
  ON "ActiveCatalogSnapshot"("catalogBatchId");

ALTER TABLE "CatalogSnapshot"
  ADD COLUMN IF NOT EXISTS "expectedProductCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "actualProductCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "expectedVariantCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "actualVariantCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "expectedCollectionMembershipCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "actualCollectionMembershipCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "expectedInventoryLevelCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "actualInventoryLevelCount" INTEGER;
