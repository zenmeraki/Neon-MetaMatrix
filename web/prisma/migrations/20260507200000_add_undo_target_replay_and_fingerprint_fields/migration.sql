-- Backfill for environments where undo tables were introduced out-of-band
-- and are missing from the tracked migration chain used by shadow DB.
CREATE TABLE IF NOT EXISTS "UndoRequest" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "requestedBy" TEXT,
  "conflictCount" INTEGER NOT NULL DEFAULT 0,
  "safeCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UndoRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UndoRequest_shop_executionId_key"
  ON "UndoRequest"("shop", "executionId");
CREATE INDEX IF NOT EXISTS "UndoRequest_shop_status_idx"
  ON "UndoRequest"("shop", "status");

CREATE TABLE IF NOT EXISTS "UndoTarget" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "undoRequestId" TEXT NOT NULL,
  "changeRecordId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "variantId" TEXT,
  "field" TEXT NOT NULL,
  "beforeValueJson" JSONB NOT NULL,
  "afterValueJson" JSONB NOT NULL,
  "currentValueJson" JSONB,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "conflictReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UndoTarget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UndoTarget_shop_undoRequestId_changeRecordId_key"
  ON "UndoTarget"("shop", "undoRequestId", "changeRecordId");
CREATE INDEX IF NOT EXISTS "UndoTarget_shop_undoRequestId_idx"
  ON "UndoTarget"("shop", "undoRequestId");
CREATE INDEX IF NOT EXISTS "UndoTarget_shop_status_idx"
  ON "UndoTarget"("shop", "status");

CREATE TABLE IF NOT EXISTS "UndoExecutionPlan" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "undoRequestId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CREATED',
  "planHash" TEXT NOT NULL,
  "mutationCount" INTEGER NOT NULL,
  "planJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UndoExecutionPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UndoExecutionPlan_shop_undoRequestId_key"
  ON "UndoExecutionPlan"("shop", "undoRequestId");
CREATE INDEX IF NOT EXISTS "UndoExecutionPlan_shop_status_idx"
  ON "UndoExecutionPlan"("shop", "status");

ALTER TABLE "UndoTarget"
  ADD COLUMN IF NOT EXISTS "expectedAfterFingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "currentFingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "restoredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "undoMutationId" TEXT;

CREATE INDEX IF NOT EXISTS "UndoTarget_shop_restoredAt_idx"
  ON "UndoTarget"("shop", "restoredAt");
