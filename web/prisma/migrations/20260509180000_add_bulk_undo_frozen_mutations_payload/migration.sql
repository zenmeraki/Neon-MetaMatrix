ALTER TABLE "BulkUndoTargetSnapshot"
ADD COLUMN IF NOT EXISTS "frozenMutations" JSONB;
