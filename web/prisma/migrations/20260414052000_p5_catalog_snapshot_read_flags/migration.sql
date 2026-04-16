ALTER TABLE "Store"
  ADD COLUMN IF NOT EXISTS "catalogSnapshotReadEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "catalogSnapshotExecutionEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "catalogSnapshotSchedulerEnabled" BOOLEAN NOT NULL DEFAULT false;
