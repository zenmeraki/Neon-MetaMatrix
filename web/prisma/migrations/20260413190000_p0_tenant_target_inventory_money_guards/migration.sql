DELETE FROM "SpreadsheetFile"
WHERE "shop" IS NULL
   OR "editHistoryId" IS NULL
   OR NOT EXISTS (
     SELECT 1 FROM "EditHistory"
     WHERE "EditHistory"."id" = "SpreadsheetFile"."editHistoryId"
       AND "EditHistory"."shop" = "SpreadsheetFile"."shop"
   );

ALTER TABLE "SpreadsheetFile"
  ALTER COLUMN "shop" SET NOT NULL,
  ALTER COLUMN "editHistoryId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "SpreadsheetFile_editHistoryId_idx"
  ON "SpreadsheetFile"("editHistoryId");

ALTER TABLE "SpreadsheetFile"
  ADD CONSTRAINT "SpreadsheetFile_editHistoryId_fkey"
  FOREIGN KEY ("editHistoryId")
  REFERENCES "EditHistory"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "totalInventoryAuthority" TEXT,
  ADD COLUMN IF NOT EXISTS "totalInventoryComputedAt" TIMESTAMP(3);

ALTER TABLE "Store"
  ALTER COLUMN "refEarnedPrice" TYPE DECIMAL(18, 6)
  USING "refEarnedPrice"::DECIMAL(18, 6);

ALTER TABLE "EditHistory"
  ALTER COLUMN "startedAt" DROP NOT NULL;

DROP TABLE IF EXISTS "TargetSnapshot";
