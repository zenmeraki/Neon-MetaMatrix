-- Mirror reads are scoped by the active batch; keep filter indexes batch-aware.
DROP INDEX IF EXISTS "Product_shop_status_idx";
DROP INDEX IF EXISTS "Product_shop_title_idx";
DROP INDEX IF EXISTS "Product_shop_handle_idx";
DROP INDEX IF EXISTS "Product_shop_createdAt_idx";
DROP INDEX IF EXISTS "Product_shop_updatedAt_idx";
DROP INDEX IF EXISTS "Product_shop_publishedAt_idx";
DROP INDEX IF EXISTS "Product_shop_googleShoppingEnabled_idx";
DROP INDEX IF EXISTS "Product_shop_googleShoppingCondition_idx";
DROP INDEX IF EXISTS "Product_shop_templateSuffix_idx";
DROP INDEX IF EXISTS "Product_shop_variantCount_idx";
DROP INDEX IF EXISTS "Product_shop_visibleOnlineStore_idx";
DROP INDEX IF EXISTS "Product_shop_lastReconciledAt_idx";
DROP INDEX IF EXISTS "Product_shop_lastSourceEventAt_idx";
DROP INDEX IF EXISTS "Product_shop_lastSourceKind_idx";
DROP INDEX IF EXISTS "Product_shop_lastSourceUpdatedAt_idx";

CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_status_idx"
  ON "Product"("shop", "mirrorBatchId", "status");
CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_title_idx"
  ON "Product"("shop", "mirrorBatchId", "title");
CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_handle_idx"
  ON "Product"("shop", "mirrorBatchId", "handle");
CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_createdAt_idx"
  ON "Product"("shop", "mirrorBatchId", "createdAt");
CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_updatedAt_idx"
  ON "Product"("shop", "mirrorBatchId", "updatedAt");
CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_publishedAt_idx"
  ON "Product"("shop", "mirrorBatchId", "publishedAt");
CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_googleShoppingEnabled_idx"
  ON "Product"("shop", "mirrorBatchId", "googleShoppingEnabled");
CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_googleShoppingCondition_idx"
  ON "Product"("shop", "mirrorBatchId", "googleShoppingCondition");
CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_templateSuffix_idx"
  ON "Product"("shop", "mirrorBatchId", "templateSuffix");
CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_variantCount_idx"
  ON "Product"("shop", "mirrorBatchId", "variantCount");
CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_visibleOnlineStore_idx"
  ON "Product"("shop", "mirrorBatchId", "visibleOnlineStore");
CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_lastReconciledAt_idx"
  ON "Product"("shop", "mirrorBatchId", "lastReconciledAt");
CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_lastSourceEventAt_idx"
  ON "Product"("shop", "mirrorBatchId", "lastSourceEventAt");
CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_lastSourceKind_idx"
  ON "Product"("shop", "mirrorBatchId", "lastSourceKind");
CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_lastSourceUpdatedAt_idx"
  ON "Product"("shop", "mirrorBatchId", "lastSourceUpdatedAt");

DROP INDEX IF EXISTS "Variant_shop_sku_idx";
DROP INDEX IF EXISTS "Variant_shop_productId_idx";
DROP INDEX IF EXISTS "Variant_shop_barcode_idx";
DROP INDEX IF EXISTS "Variant_shop_title_idx";
DROP INDEX IF EXISTS "Variant_shop_inventoryQuantity_idx";
DROP INDEX IF EXISTS "Variant_shop_inventoryPolicy_idx";
DROP INDEX IF EXISTS "Variant_shop_taxable_idx";
DROP INDEX IF EXISTS "Variant_shop_weightUnit_idx";
DROP INDEX IF EXISTS "Variant_shop_countryOfOrigin_idx";
DROP INDEX IF EXISTS "Variant_shop_hsTariffCode_idx";
DROP INDEX IF EXISTS "Variant_shop_option1Value_idx";
DROP INDEX IF EXISTS "Variant_shop_option2Value_idx";
DROP INDEX IF EXISTS "Variant_shop_option3Value_idx";
DROP INDEX IF EXISTS "Variant_shop_tracked_idx";
DROP INDEX IF EXISTS "Variant_shop_physicalProduct_idx";

CREATE INDEX IF NOT EXISTS "Variant_shop_mirrorBatchId_sku_idx"
  ON "Variant"("shop", "mirrorBatchId", "sku");
CREATE INDEX IF NOT EXISTS "Variant_shop_mirrorBatchId_productId_idx"
  ON "Variant"("shop", "mirrorBatchId", "productId");
CREATE INDEX IF NOT EXISTS "Variant_shop_mirrorBatchId_barcode_idx"
  ON "Variant"("shop", "mirrorBatchId", "barcode");
CREATE INDEX IF NOT EXISTS "Variant_shop_mirrorBatchId_title_idx"
  ON "Variant"("shop", "mirrorBatchId", "title");
CREATE INDEX IF NOT EXISTS "Variant_shop_mirrorBatchId_inventoryQuantity_idx"
  ON "Variant"("shop", "mirrorBatchId", "inventoryQuantity");
CREATE INDEX IF NOT EXISTS "Variant_shop_mirrorBatchId_hsTariffCode_idx"
  ON "Variant"("shop", "mirrorBatchId", "hsTariffCode");
CREATE INDEX IF NOT EXISTS "Variant_shop_mirrorBatchId_taxable_idx"
  ON "Variant"("shop", "mirrorBatchId", "taxable");
CREATE INDEX IF NOT EXISTS "Variant_shop_mirrorBatchId_tracked_idx"
  ON "Variant"("shop", "mirrorBatchId", "tracked");
CREATE INDEX IF NOT EXISTS "Variant_shop_mirrorBatchId_physicalProduct_idx"
  ON "Variant"("shop", "mirrorBatchId", "physicalProduct");

DROP INDEX IF EXISTS "Collection_shop_title_idx";

ALTER TABLE "ExportHistory"
  ALTER COLUMN "duration" DROP DEFAULT,
  ALTER COLUMN "duration" TYPE INTEGER
    USING CASE
      WHEN trim("duration") ~ '^[0-9]+$' THEN trim("duration")::INTEGER
      ELSE 0
    END,
  ALTER COLUMN "duration" SET DEFAULT 0,
  ALTER COLUMN "duration" SET NOT NULL;

ALTER TABLE "AffiliateUser"
  ALTER COLUMN "totalAmountEarned" TYPE DECIMAL(18, 6)
  USING "totalAmountEarned"::DECIMAL(18, 6),
  ALTER COLUMN "totalAmountEarned" SET DEFAULT 0;

DELETE FROM "FilterTrack"
WHERE "shop" IS NULL
   OR trim("shop") = '';

ALTER TABLE "FilterTrack"
  ALTER COLUMN "shop" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "ChangeRecordFieldChange" (
  "id" BIGSERIAL PRIMARY KEY,
  "changeRecordId" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "editHistoryId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "variantId" TEXT,
  "targetKey" TEXT,
  "scope" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "oldValue" JSONB,
  "newValue" JSONB,
  "revertValue" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChangeRecordFieldChange_changeRecordId_fkey"
    FOREIGN KEY ("changeRecordId") REFERENCES "ChangeRecord"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ChangeRecordFieldChange_changeRecordId_idx"
  ON "ChangeRecordFieldChange"("changeRecordId");
CREATE INDEX IF NOT EXISTS "ChangeRecordFieldChange_shop_field_idx"
  ON "ChangeRecordFieldChange"("shop", "field");
CREATE INDEX IF NOT EXISTS "ChangeRecordFieldChange_shop_editHistoryId_field_idx"
  ON "ChangeRecordFieldChange"("shop", "editHistoryId", "field");
CREATE INDEX IF NOT EXISTS "ChangeRecordFieldChange_shop_productId_field_idx"
  ON "ChangeRecordFieldChange"("shop", "productId", "field");
CREATE INDEX IF NOT EXISTS "ChangeRecordFieldChange_shop_variantId_field_idx"
  ON "ChangeRecordFieldChange"("shop", "variantId", "field");

CREATE OR REPLACE FUNCTION sync_change_record_field_changes()
RETURNS trigger AS $$
DECLARE
  product_change JSONB;
  variant_group JSONB;
  variant_change JSONB;
BEGIN
  DELETE FROM "ChangeRecordFieldChange"
  WHERE "changeRecordId" = NEW."id";

  IF NEW."productFieldChanges" IS NOT NULL
     AND jsonb_typeof(NEW."productFieldChanges"::jsonb) = 'array' THEN
    FOR product_change IN
      SELECT value FROM jsonb_array_elements(NEW."productFieldChanges"::jsonb)
    LOOP
      IF product_change ? 'field' THEN
        INSERT INTO "ChangeRecordFieldChange" (
          "changeRecordId",
          "shop",
          "editHistoryId",
          "productId",
          "variantId",
          "targetKey",
          "scope",
          "field",
          "oldValue",
          "newValue",
          "revertValue",
          "createdAt"
        ) VALUES (
          NEW."id",
          NEW."shop",
          NEW."editHistoryId",
          NEW."productId",
          NULL,
          NEW."targetKey",
          'PRODUCT',
          product_change->>'field',
          product_change->'oldValue',
          product_change->'newValue',
          product_change->'revertValue',
          NEW."createdAt"
        );
      END IF;
    END LOOP;
  END IF;

  IF NEW."variantFieldChanges" IS NOT NULL
     AND jsonb_typeof(NEW."variantFieldChanges"::jsonb) = 'array' THEN
    FOR variant_group IN
      SELECT value FROM jsonb_array_elements(NEW."variantFieldChanges"::jsonb)
    LOOP
      IF variant_group ? 'changes'
         AND jsonb_typeof(variant_group->'changes') = 'array' THEN
        FOR variant_change IN
          SELECT value FROM jsonb_array_elements(variant_group->'changes')
        LOOP
          IF variant_change ? 'field' THEN
            INSERT INTO "ChangeRecordFieldChange" (
              "changeRecordId",
              "shop",
              "editHistoryId",
              "productId",
              "variantId",
              "targetKey",
              "scope",
              "field",
              "oldValue",
              "newValue",
              "revertValue",
              "createdAt"
            ) VALUES (
              NEW."id",
              NEW."shop",
              NEW."editHistoryId",
              NEW."productId",
              COALESCE(variant_group->>'variantId', NEW."variantId"),
              NEW."targetKey",
              'VARIANT',
              variant_change->>'field',
              variant_change->'oldValue',
              variant_change->'newValue',
              variant_change->'revertValue',
              NEW."createdAt"
            );
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "ChangeRecord_sync_field_changes" ON "ChangeRecord";

CREATE TRIGGER "ChangeRecord_sync_field_changes"
AFTER INSERT OR UPDATE OF "productFieldChanges", "variantFieldChanges"
ON "ChangeRecord"
FOR EACH ROW
EXECUTE FUNCTION sync_change_record_field_changes();

INSERT INTO "ChangeRecordFieldChange" (
  "changeRecordId",
  "shop",
  "editHistoryId",
  "productId",
  "variantId",
  "targetKey",
  "scope",
  "field",
  "oldValue",
  "newValue",
  "revertValue",
  "createdAt"
)
SELECT
  cr."id",
  cr."shop",
  cr."editHistoryId",
  cr."productId",
  NULL,
  cr."targetKey",
  'PRODUCT',
  product_change.value->>'field',
  product_change.value->'oldValue',
  product_change.value->'newValue',
  product_change.value->'revertValue',
  cr."createdAt"
FROM "ChangeRecord" cr
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN cr."productFieldChanges" IS NOT NULL
     AND jsonb_typeof(cr."productFieldChanges"::jsonb) = 'array'
      THEN cr."productFieldChanges"::jsonb
    ELSE '[]'::jsonb
  END
) AS product_change(value)
WHERE cr."productFieldChanges" IS NOT NULL
  AND jsonb_typeof(cr."productFieldChanges"::jsonb) = 'array'
  AND product_change.value ? 'field';

INSERT INTO "ChangeRecordFieldChange" (
  "changeRecordId",
  "shop",
  "editHistoryId",
  "productId",
  "variantId",
  "targetKey",
  "scope",
  "field",
  "oldValue",
  "newValue",
  "revertValue",
  "createdAt"
)
SELECT
  cr."id",
  cr."shop",
  cr."editHistoryId",
  cr."productId",
  COALESCE(variant_group.value->>'variantId', cr."variantId"),
  cr."targetKey",
  'VARIANT',
  variant_change.value->>'field',
  variant_change.value->'oldValue',
  variant_change.value->'newValue',
  variant_change.value->'revertValue',
  cr."createdAt"
FROM "ChangeRecord" cr
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN cr."variantFieldChanges" IS NOT NULL
     AND jsonb_typeof(cr."variantFieldChanges"::jsonb) = 'array'
      THEN cr."variantFieldChanges"::jsonb
    ELSE '[]'::jsonb
  END
) AS variant_group(value)
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN variant_group.value ? 'changes'
     AND jsonb_typeof(variant_group.value->'changes') = 'array'
      THEN variant_group.value->'changes'
    ELSE '[]'::jsonb
  END
) AS variant_change(value)
WHERE cr."variantFieldChanges" IS NOT NULL
  AND jsonb_typeof(cr."variantFieldChanges"::jsonb) = 'array'
  AND variant_group.value ? 'changes'
  AND jsonb_typeof(variant_group.value->'changes') = 'array'
  AND variant_change.value ? 'field';
