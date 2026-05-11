ALTER TABLE "OperationExecution"
ADD COLUMN IF NOT EXISTS "lockVersion" BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "OperationExecution_shop_leaseOwner_lockVersion_idx"
ON "OperationExecution"("shop", "leaseOwner", "lockVersion");
