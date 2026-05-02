CREATE TABLE IF NOT EXISTS "Rule" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 50,
  "scopeType" TEXT NOT NULL,
  "scopeRefId" TEXT,
  "filterDsl" JSONB NOT NULL,
  "actionDsl" JSONB NOT NULL,
  "conflictStrategy" TEXT NOT NULL,
  "allowDestructive" BOOLEAN NOT NULL DEFAULT false,
  "cooldownSeconds" INTEGER NOT NULL DEFAULT 0,
  "maxRunsPerHour" INTEGER,
  "lastRunAt" TIMESTAMP(3),
  "lastRunHash" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "parentRuleId" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RuleVersion" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "filterDsl" JSONB NOT NULL,
  "actionDsl" JSONB NOT NULL,
  "snapshotNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RuleVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RuleRun" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "operationId" TEXT,
  "triggerType" TEXT NOT NULL,
  "triggerEventId" TEXT,
  "status" TEXT NOT NULL,
  "catalogBatchId" TEXT NOT NULL,
  "targetCount" INTEGER,
  "affectedCount" INTEGER,
  "failureCount" INTEGER,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RuleRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RuleExecution" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "ruleRunId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RuleExecution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RuleFailure" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "ruleRunId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "errorCode" TEXT NOT NULL,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RuleFailure_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Rule_shopId_status_idx" ON "Rule"("shopId", "status");
CREATE INDEX IF NOT EXISTS "Rule_shopId_priority_idx" ON "Rule"("shopId", "priority");

CREATE UNIQUE INDEX IF NOT EXISTS "RuleVersion_ruleId_version_key" ON "RuleVersion"("ruleId", "version");
CREATE INDEX IF NOT EXISTS "RuleVersion_shopId_ruleId_idx" ON "RuleVersion"("shopId", "ruleId");

CREATE UNIQUE INDEX IF NOT EXISTS "RuleRun_shopId_ruleId_triggerEventId_key"
ON "RuleRun"("shopId", "ruleId", "triggerEventId");
CREATE INDEX IF NOT EXISTS "RuleRun_shopId_status_idx" ON "RuleRun"("shopId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "RuleExecution_ruleRunId_entityType_entityId_key"
ON "RuleExecution"("ruleRunId", "entityType", "entityId");
CREATE INDEX IF NOT EXISTS "RuleExecution_shopId_ruleRunId_idx" ON "RuleExecution"("shopId", "ruleRunId");

CREATE INDEX IF NOT EXISTS "RuleFailure_shopId_ruleRunId_idx" ON "RuleFailure"("shopId", "ruleRunId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RuleVersion_ruleId_fkey'
  ) THEN
    ALTER TABLE "RuleVersion"
    ADD CONSTRAINT "RuleVersion_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RuleRun_ruleId_fkey'
  ) THEN
    ALTER TABLE "RuleRun"
    ADD CONSTRAINT "RuleRun_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RuleExecution_ruleRunId_fkey'
  ) THEN
    ALTER TABLE "RuleExecution"
    ADD CONSTRAINT "RuleExecution_ruleRunId_fkey"
    FOREIGN KEY ("ruleRunId") REFERENCES "RuleRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RuleFailure_ruleRunId_fkey'
  ) THEN
    ALTER TABLE "RuleFailure"
    ADD CONSTRAINT "RuleFailure_ruleRunId_fkey"
    FOREIGN KEY ("ruleRunId") REFERENCES "RuleRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
