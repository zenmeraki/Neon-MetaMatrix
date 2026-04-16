-- EditHistory becomes the user-facing parent/link hub.
-- EditExecutionSummary owns execution state projection for history, undo, and replay.

CREATE TABLE IF NOT EXISTS "EditExecutionSummary" (
  "id" TEXT NOT NULL,
  "editHistoryId" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "executionState" TEXT NOT NULL DEFAULT 'planned',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "executionIdentity" TEXT,
  "targetSnapshotCount" INTEGER NOT NULL DEFAULT 0,
  "targetCatalogBatchId" TEXT,
  "targetMirrorBatchId" TEXT,
  "targetSnapshotSetId" TEXT,
  "targetLevel" TEXT,
  "bulkOperationId" TEXT,
  "failureStage" TEXT,
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "totalItems" INTEGER NOT NULL DEFAULT 0,
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "durationMs" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "scheduledAt" TIMESTAMP(3),
  "scheduledUndoAt" TIMESTAMP(3),
  "recurringEditId" TEXT,
  "recurringRunId" TEXT,
  "automaticProductRuleId" TEXT,
  "automaticProductRuleRunId" TEXT,
  "idempotencyKey" TEXT,
  "queryFilter" TEXT NOT NULL DEFAULT '',
  "rules" JSONB,
  "batch" JSONB,
  "undo" JSONB,
  "error" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EditExecutionSummary_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EditExecutionSummary_editHistoryId_key" UNIQUE ("editHistoryId")
);

INSERT INTO "EditExecutionSummary" (
  "id",
  "editHistoryId",
  "shop",
  "executionState",
  "status",
  "executionIdentity",
  "targetSnapshotCount",
  "targetCatalogBatchId",
  "targetMirrorBatchId",
  "targetSnapshotSetId",
  "targetLevel",
  "bulkOperationId",
  "failureStage",
  "processedCount",
  "totalItems",
  "totalRows",
  "durationMs",
  "startedAt",
  "completedAt",
  "scheduledAt",
  "scheduledUndoAt",
  "recurringEditId",
  "recurringRunId",
  "automaticProductRuleId",
  "automaticProductRuleRunId",
  "idempotencyKey",
  "queryFilter",
  "rules",
  "batch",
  "undo",
  "error",
  "createdAt",
  "updatedAt"
)
SELECT
  'ees_' || "id",
  "id",
  "shop",
  COALESCE("executionState", 'planned'),
  COALESCE("status", 'pending'),
  "executionIdentity",
  COALESCE("targetSnapshotCount", 0),
  "targetCatalogBatchId",
  "targetMirrorBatchId",
  "targetSnapshotSetId",
  "targetLevel",
  "bulkOperationId",
  "failureStage",
  COALESCE("processedCount", 0),
  COALESCE("totalItems", 0),
  COALESCE("totalRows", 0),
  COALESCE("durationMs", 0),
  "startedAt",
  "completedAt",
  "scheduledAt",
  "scheduledUndoAt",
  "recurringEditId",
  "recurringRunId",
  "automaticProductRuleId",
  "automaticProductRuleRunId",
  "idempotencyKey",
  COALESCE("queryFilter", ''),
  "rules",
  "batch",
  "undo",
  "error",
  "createdAt",
  "updatedAt"
FROM "EditHistory"
ON CONFLICT ("editHistoryId") DO UPDATE SET
  "shop" = EXCLUDED."shop",
  "executionState" = EXCLUDED."executionState",
  "status" = EXCLUDED."status",
  "executionIdentity" = EXCLUDED."executionIdentity",
  "targetSnapshotCount" = EXCLUDED."targetSnapshotCount",
  "targetCatalogBatchId" = EXCLUDED."targetCatalogBatchId",
  "targetMirrorBatchId" = EXCLUDED."targetMirrorBatchId",
  "targetSnapshotSetId" = EXCLUDED."targetSnapshotSetId",
  "targetLevel" = EXCLUDED."targetLevel",
  "bulkOperationId" = EXCLUDED."bulkOperationId",
  "failureStage" = EXCLUDED."failureStage",
  "processedCount" = EXCLUDED."processedCount",
  "totalItems" = EXCLUDED."totalItems",
  "totalRows" = EXCLUDED."totalRows",
  "durationMs" = EXCLUDED."durationMs",
  "startedAt" = EXCLUDED."startedAt",
  "completedAt" = EXCLUDED."completedAt",
  "scheduledAt" = EXCLUDED."scheduledAt",
  "scheduledUndoAt" = EXCLUDED."scheduledUndoAt",
  "recurringEditId" = EXCLUDED."recurringEditId",
  "recurringRunId" = EXCLUDED."recurringRunId",
  "automaticProductRuleId" = EXCLUDED."automaticProductRuleId",
  "automaticProductRuleRunId" = EXCLUDED."automaticProductRuleRunId",
  "idempotencyKey" = EXCLUDED."idempotencyKey",
  "queryFilter" = EXCLUDED."queryFilter",
  "rules" = EXCLUDED."rules",
  "batch" = EXCLUDED."batch",
  "undo" = EXCLUDED."undo",
  "error" = EXCLUDED."error",
  "updatedAt" = EXCLUDED."updatedAt";

CREATE UNIQUE INDEX IF NOT EXISTS "EditExecutionSummary_editHistoryId_key"
  ON "EditExecutionSummary" ("editHistoryId");
CREATE UNIQUE INDEX IF NOT EXISTS "EditExecutionSummary_executionIdentity_key"
  ON "EditExecutionSummary" ("executionIdentity");
CREATE UNIQUE INDEX IF NOT EXISTS "EditExecutionSummary_shop_idempotencyKey_key"
  ON "EditExecutionSummary" ("shop", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "EditExecutionSummary_shop_status_updatedAt_idx"
  ON "EditExecutionSummary" ("shop", "status", "updatedAt");
CREATE INDEX IF NOT EXISTS "EditExecutionSummary_shop_executionState_idx"
  ON "EditExecutionSummary" ("shop", "executionState");
CREATE INDEX IF NOT EXISTS "EditExecutionSummary_targetSnapshotSetId_idx"
  ON "EditExecutionSummary" ("targetSnapshotSetId");
CREATE INDEX IF NOT EXISTS "EditExecutionSummary_targetCatalogBatchId_idx"
  ON "EditExecutionSummary" ("targetCatalogBatchId");
CREATE INDEX IF NOT EXISTS "EditExecutionSummary_recurringEditId_idx"
  ON "EditExecutionSummary" ("recurringEditId");
CREATE INDEX IF NOT EXISTS "EditExecutionSummary_recurringRunId_idx"
  ON "EditExecutionSummary" ("recurringRunId");
CREATE INDEX IF NOT EXISTS "EditExecutionSummary_automaticProductRuleId_idx"
  ON "EditExecutionSummary" ("automaticProductRuleId");
CREATE INDEX IF NOT EXISTS "EditExecutionSummary_automaticProductRuleRunId_idx"
  ON "EditExecutionSummary" ("automaticProductRuleRunId");

ALTER TABLE "EditExecutionSummary"
  ADD CONSTRAINT "EditExecutionSummary_editHistoryId_fkey"
  FOREIGN KEY ("editHistoryId") REFERENCES "EditHistory"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION sync_edit_execution_summary_from_history()
RETURNS trigger AS $$
BEGIN
  INSERT INTO "EditExecutionSummary" (
    "id",
    "editHistoryId",
    "shop",
    "executionState",
    "status",
    "executionIdentity",
    "targetSnapshotCount",
    "targetCatalogBatchId",
    "targetMirrorBatchId",
    "targetSnapshotSetId",
    "targetLevel",
    "bulkOperationId",
    "failureStage",
    "processedCount",
    "totalItems",
    "totalRows",
    "durationMs",
    "startedAt",
    "completedAt",
    "scheduledAt",
    "scheduledUndoAt",
    "recurringEditId",
    "recurringRunId",
    "automaticProductRuleId",
    "automaticProductRuleRunId",
    "idempotencyKey",
    "queryFilter",
    "rules",
    "batch",
    "undo",
    "error",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    'ees_' || NEW."id",
    NEW."id",
    NEW."shop",
    COALESCE(NEW."executionState", 'planned'),
    COALESCE(NEW."status", 'pending'),
    NEW."executionIdentity",
    COALESCE(NEW."targetSnapshotCount", 0),
    NEW."targetCatalogBatchId",
    NEW."targetMirrorBatchId",
    NEW."targetSnapshotSetId",
    NEW."targetLevel",
    NEW."bulkOperationId",
    NEW."failureStage",
    COALESCE(NEW."processedCount", 0),
    COALESCE(NEW."totalItems", 0),
    COALESCE(NEW."totalRows", 0),
    COALESCE(NEW."durationMs", 0),
    NEW."startedAt",
    NEW."completedAt",
    NEW."scheduledAt",
    NEW."scheduledUndoAt",
    NEW."recurringEditId",
    NEW."recurringRunId",
    NEW."automaticProductRuleId",
    NEW."automaticProductRuleRunId",
    NEW."idempotencyKey",
    COALESCE(NEW."queryFilter", ''),
    NEW."rules",
    NEW."batch",
    NEW."undo",
    NEW."error",
    NEW."createdAt",
    NEW."updatedAt"
  )
  ON CONFLICT ("editHistoryId") DO UPDATE SET
    "shop" = EXCLUDED."shop",
    "executionState" = EXCLUDED."executionState",
    "status" = EXCLUDED."status",
    "executionIdentity" = EXCLUDED."executionIdentity",
    "targetSnapshotCount" = EXCLUDED."targetSnapshotCount",
    "targetCatalogBatchId" = EXCLUDED."targetCatalogBatchId",
    "targetMirrorBatchId" = EXCLUDED."targetMirrorBatchId",
    "targetSnapshotSetId" = EXCLUDED."targetSnapshotSetId",
    "targetLevel" = EXCLUDED."targetLevel",
    "bulkOperationId" = EXCLUDED."bulkOperationId",
    "failureStage" = EXCLUDED."failureStage",
    "processedCount" = EXCLUDED."processedCount",
    "totalItems" = EXCLUDED."totalItems",
    "totalRows" = EXCLUDED."totalRows",
    "durationMs" = EXCLUDED."durationMs",
    "startedAt" = EXCLUDED."startedAt",
    "completedAt" = EXCLUDED."completedAt",
    "scheduledAt" = EXCLUDED."scheduledAt",
    "scheduledUndoAt" = EXCLUDED."scheduledUndoAt",
    "recurringEditId" = EXCLUDED."recurringEditId",
    "recurringRunId" = EXCLUDED."recurringRunId",
    "automaticProductRuleId" = EXCLUDED."automaticProductRuleId",
    "automaticProductRuleRunId" = EXCLUDED."automaticProductRuleRunId",
    "idempotencyKey" = EXCLUDED."idempotencyKey",
    "queryFilter" = EXCLUDED."queryFilter",
    "rules" = EXCLUDED."rules",
    "batch" = EXCLUDED."batch",
    "undo" = EXCLUDED."undo",
    "error" = EXCLUDED."error",
    "updatedAt" = EXCLUDED."updatedAt";

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "EditHistory_sync_execution_summary_trg" ON "EditHistory";
CREATE TRIGGER "EditHistory_sync_execution_summary_trg"
AFTER INSERT OR UPDATE ON "EditHistory"
FOR EACH ROW
EXECUTE FUNCTION sync_edit_execution_summary_from_history();

COMMENT ON TABLE "EditHistory" IS
  'User-facing edit parent and link hub. Execution state, replay, scheduling, rules, idempotency, errors, and undo projection are compatibility fields mirrored into EditExecutionSummary while legacy callers drain.';
COMMENT ON TABLE "EditExecutionSummary" IS
  'Execution summary projection for EditHistory history, undo, and replay reads.';
