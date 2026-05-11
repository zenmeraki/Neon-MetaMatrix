ALTER TABLE "BulkUndoTargetSnapshot"
ADD COLUMN IF NOT EXISTS "changeRecordIds" JSONB;
