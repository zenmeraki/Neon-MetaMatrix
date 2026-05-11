ALTER TABLE "RecurringRuleRun"
ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "RecurringRuleRun"
ALTER COLUMN "status" TYPE "RecurringEditRunStatus"
USING "status"::"RecurringEditRunStatus";

ALTER TABLE "RecurringRuleRun"
ALTER COLUMN "status" SET DEFAULT 'PENDING'::"RecurringEditRunStatus";