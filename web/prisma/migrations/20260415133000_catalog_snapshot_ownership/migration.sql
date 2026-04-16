ALTER TABLE "CatalogSnapshot"
ADD COLUMN IF NOT EXISTS "syncRunId" TEXT,
ADD COLUMN IF NOT EXISTS "schemaVersion" TEXT NOT NULL DEFAULT 'catalog-snapshot-v1';

CREATE INDEX IF NOT EXISTS "CatalogSnapshot_syncRunId_idx"
ON "CatalogSnapshot"("syncRunId");

CREATE INDEX IF NOT EXISTS "CatalogSnapshot_schemaVersion_idx"
ON "CatalogSnapshot"("schemaVersion");

DROP INDEX IF EXISTS "ActiveCatalogSnapshot_productMirrorBatchId_idx";

ALTER TABLE "ActiveCatalogSnapshot"
DROP COLUMN IF EXISTS "productMirrorBatchId";
