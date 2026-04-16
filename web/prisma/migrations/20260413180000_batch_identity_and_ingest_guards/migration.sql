DELETE FROM "Collection"
WHERE "shop" IS NULL
   OR "shopifyId" IS NULL
   OR "mirrorBatchId" IS NULL;

ALTER TABLE "Collection"
  ALTER COLUMN "shop" SET NOT NULL,
  ALTER COLUMN "shopifyId" SET NOT NULL,
  ALTER COLUMN "mirrorBatchId" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Collection_shop_mirrorBatchId_shopifyId_key"
  ON "Collection"("shop", "mirrorBatchId", "shopifyId");

ALTER TABLE "VariantInventoryLevel"
  ADD COLUMN IF NOT EXISTS "sourceUpdatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sourceEventAt" TIMESTAMP(3);

ALTER TABLE "ProductTrackedMetafield"
  ADD COLUMN IF NOT EXISTS "sourceUpdatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sourceEventAt" TIMESTAMP(3);

ALTER TABLE "VariantTrackedMetafield"
  ADD COLUMN IF NOT EXISTS "sourceUpdatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sourceEventAt" TIMESTAMP(3);

DROP INDEX IF EXISTS "Product_shop_vendor_idx";
DROP INDEX IF EXISTS "Product_shop_productType_idx";
DROP INDEX IF EXISTS "Product_shop_categoryName_idx";
DROP INDEX IF EXISTS "Product_shop_googleShoppingCategory_idx";
DROP INDEX IF EXISTS "Product_shop_googleShoppingGender_idx";
DROP INDEX IF EXISTS "Product_shop_googleShoppingAgeGroup_idx";
DROP INDEX IF EXISTS "Product_shop_categoryColor_idx";
DROP INDEX IF EXISTS "Product_shop_categorySize_idx";
DROP INDEX IF EXISTS "Product_shop_categoryTargetGender_idx";
DROP INDEX IF EXISTS "Product_shop_option1Name_idx";
DROP INDEX IF EXISTS "Product_shop_option2Name_idx";
DROP INDEX IF EXISTS "Product_shop_option3Name_idx";

DROP INDEX IF EXISTS "Variant_shop_price_idx";
DROP INDEX IF EXISTS "Variant_shop_compareAtPrice_idx";
DROP INDEX IF EXISTS "Variant_shop_cost_idx";
DROP INDEX IF EXISTS "Variant_shop_weight_idx";
DROP INDEX IF EXISTS "Variant_shop_profitMargin_idx";

CREATE INDEX IF NOT EXISTS "Variant_shop_mirrorBatchId_price_idx"
  ON "Variant"("shop", "mirrorBatchId", "price");
CREATE INDEX IF NOT EXISTS "Variant_shop_mirrorBatchId_compareAtPrice_idx"
  ON "Variant"("shop", "mirrorBatchId", "compareAtPrice");
CREATE INDEX IF NOT EXISTS "Variant_shop_mirrorBatchId_cost_idx"
  ON "Variant"("shop", "mirrorBatchId", "cost");
CREATE INDEX IF NOT EXISTS "Variant_shop_mirrorBatchId_weight_idx"
  ON "Variant"("shop", "mirrorBatchId", "weight");
CREATE INDEX IF NOT EXISTS "Variant_shop_mirrorBatchId_profitMargin_idx"
  ON "Variant"("shop", "mirrorBatchId", "profitMargin");
