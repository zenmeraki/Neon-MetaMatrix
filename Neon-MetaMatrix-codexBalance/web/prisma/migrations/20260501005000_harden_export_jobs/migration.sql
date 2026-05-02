ALTER TABLE "ExportJob"
ADD COLUMN IF NOT EXISTS "executionKey" TEXT,
ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lockedBy" TEXT,
ADD COLUMN IF NOT EXISTS "queuedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "rowCursorOrdinal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "generatedRowCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "fileFinalizedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "fileExpiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ExportJob_shop_status_executionState_idx"
ON "ExportJob" ("shop", "status", "executionState");

CREATE INDEX IF NOT EXISTS "ExportJob_shop_executionState_lockedAt_idx"
ON "ExportJob" ("shop", "executionState", "lockedAt");

CREATE INDEX IF NOT EXISTS "ExportJob_shop_fileExpiresAt_idx"
ON "ExportJob" ("shop", "fileExpiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "export_job_shop_execution_key"
ON "ExportJob" ("shop", "executionKey")
WHERE "executionKey" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "export_job_shop_scheduled_run_key"
ON "ExportJob" ("shop", "scheduledExportRunId")
WHERE "scheduledExportRunId" IS NOT NULL;
