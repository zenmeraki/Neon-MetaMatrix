-- SyncHistory is no longer the sync source of truth. SyncRun owns orchestration
-- state; SyncHistory is retained only for legacy compatibility reads/writes
-- until callers are fully migrated.
ALTER TABLE "SyncHistory"
  ADD COLUMN IF NOT EXISTS "supersededBySyncRunId" TEXT,
  ADD COLUMN IF NOT EXISTS "isLegacyCompatibilityOnly" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "deprecatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "deprecationReason" TEXT NOT NULL
    DEFAULT 'Superseded by SyncRun; retained only for legacy compatibility reads and writes';

UPDATE "SyncHistory" sh
SET "supersededBySyncRunId" = sr."id"
FROM "SyncRun" sr
WHERE sh."supersededBySyncRunId" IS NULL
  AND sh."bulkOperationId" IS NOT NULL
  AND sr."bulkOperationId" = sh."bulkOperationId";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'SyncHistory_supersededBySyncRunId_fkey'
  ) THEN
    ALTER TABLE "SyncHistory"
      ADD CONSTRAINT "SyncHistory_supersededBySyncRunId_fkey"
      FOREIGN KEY ("supersededBySyncRunId") REFERENCES "SyncRun"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "SyncHistory_supersededBySyncRunId_idx"
  ON "SyncHistory"("supersededBySyncRunId");

-- Keep ChangeRecord's public cuid primary key stable, but add a BigInt sequence
-- identity so the high-volume append-only change log has a numeric parent key
-- available for the next FK migration.
ALTER TABLE "ChangeRecord"
  ADD COLUMN IF NOT EXISTS "sequenceId" BIGINT;

CREATE SEQUENCE IF NOT EXISTS "ChangeRecord_sequenceId_seq";

ALTER SEQUENCE "ChangeRecord_sequenceId_seq"
  OWNED BY "ChangeRecord"."sequenceId";

ALTER TABLE "ChangeRecord"
  ALTER COLUMN "sequenceId" SET DEFAULT nextval('"ChangeRecord_sequenceId_seq"');

UPDATE "ChangeRecord" cr
SET "sequenceId" = nextval('"ChangeRecord_sequenceId_seq"')
WHERE cr."sequenceId" IS NULL;

SELECT setval(
  '"ChangeRecord_sequenceId_seq"',
  GREATEST(COALESCE((SELECT MAX("sequenceId") FROM "ChangeRecord"), 0), 1),
  true
);

ALTER TABLE "ChangeRecord"
  ALTER COLUMN "sequenceId" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ChangeRecord_sequenceId_key"
  ON "ChangeRecord"("sequenceId");
