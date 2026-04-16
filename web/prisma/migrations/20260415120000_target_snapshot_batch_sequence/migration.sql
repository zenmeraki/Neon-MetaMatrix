ALTER TABLE "TargetSnapshotItem"
ADD COLUMN IF NOT EXISTS "batchSequenceNumber" INTEGER;

CREATE INDEX IF NOT EXISTS "TargetSnapshotItem_targetSnapshotSetId_batchSequenceNumber_idx"
ON "TargetSnapshotItem"("targetSnapshotSetId", "batchSequenceNumber");
