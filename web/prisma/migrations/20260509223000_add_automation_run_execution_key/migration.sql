ALTER TABLE "AutomationRun"
ADD COLUMN "executionKey" TEXT,
ADD COLUMN "triggerReference" TEXT,
ADD COLUMN "workerJobId" TEXT,
ADD COLUMN "attempt" INTEGER;

CREATE UNIQUE INDEX "AutomationRun_shop_automationRuleId_executionKey_key"
ON "AutomationRun"("shop", "automationRuleId", "executionKey");
