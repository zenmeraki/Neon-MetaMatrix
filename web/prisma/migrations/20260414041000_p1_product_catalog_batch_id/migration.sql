ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "catalogBatchId" TEXT;

-- For large production tables, run index creation concurrently if your
-- migration execution path is non-transactional and supports it.
CREATE INDEX IF NOT EXISTS "Product_shop_catalogBatchId_idx"
  ON "Product"("shop", "catalogBatchId");

CREATE INDEX IF NOT EXISTS "Product_shop_catalogBatchId_status_idx"
  ON "Product"("shop", "catalogBatchId", "status");

CREATE INDEX IF NOT EXISTS "Product_shop_catalogBatchId_vendor_idx"
  ON "Product"("shop", "catalogBatchId", "vendor");

CREATE INDEX IF NOT EXISTS "Product_shop_catalogBatchId_productType_idx"
  ON "Product"("shop", "catalogBatchId", "productType");

CREATE INDEX IF NOT EXISTS "Product_shop_catalogBatchId_title_idx"
  ON "Product"("shop", "catalogBatchId", "title");

CREATE INDEX IF NOT EXISTS "Product_shop_catalogBatchId_handle_idx"
  ON "Product"("shop", "catalogBatchId", "handle");

CREATE INDEX IF NOT EXISTS "Product_shop_catalogBatchId_categoryName_idx"
  ON "Product"("shop", "catalogBatchId", "categoryName");

CREATE INDEX IF NOT EXISTS "Product_shop_catalogBatchId_option1Name_idx"
  ON "Product"("shop", "catalogBatchId", "option1Name");

CREATE INDEX IF NOT EXISTS "Product_shop_catalogBatchId_option2Name_idx"
  ON "Product"("shop", "catalogBatchId", "option2Name");

CREATE INDEX IF NOT EXISTS "Product_shop_catalogBatchId_option3Name_idx"
  ON "Product"("shop", "catalogBatchId", "option3Name");

CREATE INDEX IF NOT EXISTS "Product_shop_catalogBatchId_variantCount_idx"
  ON "Product"("shop", "catalogBatchId", "variantCount");

CREATE INDEX IF NOT EXISTS "Product_shop_catalogBatchId_visibleOnlineStore_idx"
  ON "Product"("shop", "catalogBatchId", "visibleOnlineStore");
