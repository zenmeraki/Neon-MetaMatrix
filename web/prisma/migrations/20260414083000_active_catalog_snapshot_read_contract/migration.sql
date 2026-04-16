ALTER TABLE "ActiveCatalogSnapshot"
  ADD COLUMN IF NOT EXISTS "productMirrorBatchId" TEXT,
  ADD COLUMN IF NOT EXISTS "consistencyCheckedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "activatedAt" TIMESTAMP(3);

UPDATE "ActiveCatalogSnapshot"
SET
  "productMirrorBatchId" = COALESCE("productMirrorBatchId", "catalogBatchId"),
  "consistencyCheckedAt" = COALESCE("consistencyCheckedAt", "updatedAt"),
  "activatedAt" = COALESCE("activatedAt", "updatedAt", "createdAt", NOW())
WHERE
  "productMirrorBatchId" IS NULL
  OR "consistencyCheckedAt" IS NULL
  OR "activatedAt" IS NULL;

ALTER TABLE "ActiveCatalogSnapshot"
  ALTER COLUMN "productMirrorBatchId" SET NOT NULL,
  ALTER COLUMN "activatedAt" SET NOT NULL,
  ALTER COLUMN "isConsistent" SET DEFAULT false;

DROP INDEX IF EXISTS "ActiveCatalogSnapshot_mirrorBatchId_idx";

CREATE INDEX IF NOT EXISTS "ActiveCatalogSnapshot_productMirrorBatchId_idx"
  ON "ActiveCatalogSnapshot"("productMirrorBatchId");
