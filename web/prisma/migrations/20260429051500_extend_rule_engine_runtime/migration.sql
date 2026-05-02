DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RuleStatus') THEN
    CREATE TYPE "RuleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DELETED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RuleMode') THEN
    CREATE TYPE "RuleMode" AS ENUM ('REALTIME', 'SCHEDULED', 'MANUAL', 'DRY_RUN');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RuleRunStatus') THEN
    CREATE TYPE "RuleRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RuleExecutionStatus') THEN
    CREATE TYPE "RuleExecutionStatus" AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED');
  END IF;
END $$;

ALTER TABLE "Rule"
ALTER COLUMN "status" TYPE "RuleStatus" USING "status"::"RuleStatus",
ALTER COLUMN "mode" TYPE "RuleMode" USING "mode"::"RuleMode";

ALTER TABLE "RuleRun"
ALTER COLUMN "status" TYPE "RuleRunStatus" USING "status"::"RuleRunStatus";

ALTER TABLE "RuleExecution"
ALTER COLUMN "status" TYPE "RuleExecutionStatus" USING "status"::"RuleExecutionStatus";

CREATE TABLE IF NOT EXISTS "RuleExecutionStat" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "runCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RuleExecutionStat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RuleSchedule" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "cron" TEXT NOT NULL,
  "nextRunAt" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RuleSchedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RuleEventDedup" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RuleEventDedup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RuleTargetSnapshot" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "ruleRunId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  CONSTRAINT "RuleTargetSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Rule_shopId_id_idx" ON "Rule"("shopId", "id");

CREATE INDEX IF NOT EXISTS "RuleRun_shopId_ruleId_idx" ON "RuleRun"("shopId", "ruleId");
CREATE INDEX IF NOT EXISTS "RuleRun_shopId_status_createdAt_idx" ON "RuleRun"("shopId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "RuleRun_shopId_catalogBatchId_idx" ON "RuleRun"("shopId", "catalogBatchId");

CREATE INDEX IF NOT EXISTS "RuleExecution_ruleRunId_entityId_idx" ON "RuleExecution"("ruleRunId", "entityId");

CREATE UNIQUE INDEX IF NOT EXISTS "RuleExecutionStat_shopId_ruleId_windowStart_key"
ON "RuleExecutionStat"("shopId", "ruleId", "windowStart");
CREATE INDEX IF NOT EXISTS "RuleExecutionStat_shopId_ruleId_idx" ON "RuleExecutionStat"("shopId", "ruleId");

CREATE INDEX IF NOT EXISTS "RuleSchedule_shopId_nextRunAt_idx" ON "RuleSchedule"("shopId", "nextRunAt");
CREATE INDEX IF NOT EXISTS "RuleSchedule_shopId_ruleId_idx" ON "RuleSchedule"("shopId", "ruleId");

CREATE UNIQUE INDEX IF NOT EXISTS "RuleEventDedup_shopId_ruleId_eventId_key"
ON "RuleEventDedup"("shopId", "ruleId", "eventId");
CREATE INDEX IF NOT EXISTS "RuleEventDedup_shopId_ruleId_idx" ON "RuleEventDedup"("shopId", "ruleId");

CREATE UNIQUE INDEX IF NOT EXISTS "RuleTargetSnapshot_ruleRunId_entityType_entityId_key"
ON "RuleTargetSnapshot"("ruleRunId", "entityType", "entityId");
CREATE INDEX IF NOT EXISTS "RuleTargetSnapshot_shopId_ruleRunId_idx" ON "RuleTargetSnapshot"("shopId", "ruleRunId");
CREATE INDEX IF NOT EXISTS "RuleTargetSnapshot_ruleRunId_entityId_idx" ON "RuleTargetSnapshot"("ruleRunId", "entityId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RuleExecutionStat_ruleId_fkey'
  ) THEN
    ALTER TABLE "RuleExecutionStat"
    ADD CONSTRAINT "RuleExecutionStat_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RuleSchedule_ruleId_fkey'
  ) THEN
    ALTER TABLE "RuleSchedule"
    ADD CONSTRAINT "RuleSchedule_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RuleEventDedup_ruleId_fkey'
  ) THEN
    ALTER TABLE "RuleEventDedup"
    ADD CONSTRAINT "RuleEventDedup_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RuleTargetSnapshot_ruleRunId_fkey'
  ) THEN
    ALTER TABLE "RuleTargetSnapshot"
    ADD CONSTRAINT "RuleTargetSnapshot_ruleRunId_fkey"
    FOREIGN KEY ("ruleRunId") REFERENCES "RuleRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
