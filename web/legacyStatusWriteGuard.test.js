import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(process.cwd(), "web");

const ALLOWLIST = new Set([
  path.resolve(ROOT, "services/merchantOperationStateService.js"),
  path.resolve(ROOT, "services/operationProjectionService.js"),
  path.resolve(ROOT, "repositories/bulkEditHistoryRepository.js"),
  path.resolve(ROOT, "repositories/exportJobRepository.js"),
  path.resolve(ROOT, "repositories/bulkUndoExecutionRepository.js"),
  path.resolve(ROOT, "repositories/storeOperationRepository.js"),
]);

const TARGET_FILES = [
  "jobs/workers/bulkEditWorker.js",
  "jobs/workers/bulkImportEditWorker.js",
  "jobs/workers/bulkUndoWorker.js",
  "jobs/workers/bulkExportWorker.js",
  "jobs/workers/staleStoreOperationRepairWorker.js",
  "jobs/cron/scheduledEdit.js",
  "helpers/webhookHelpers/bulkOperations/bulkEdit.js",
  "services/productService/productBulkUndoService.js",
  "services/scheduledExportExecutionService.js",
  "services/recurringEditExecutionService.js",
  "services/automaticProductRuleExecutionService.js",
  "services/shopUninstallCleanupService.js",
  "services/execution/bulkEditOperationStartService.js",
  "repositories/storeOperationRepository.js",
  "controllers/productExportController.js",
  "controllers/productImportController.js",
  "controllers/productBulkEditController.js",
  "services/scheduledExportExecutionService.js",
  "services/productService/productSyncRepository.js",
];

function hasLegacyStatusMutation(source) {
  const risky = [
    /editHistory\.updateMany?\([\s\S]{0,1200}data:\s*\{[^}]{0,500}executionState/s,
    /editHistory\.updateMany?\([\s\S]{0,1200}data:\s*\{[^}]{0,500}status:\s*"((pending)|(completed)|(failed))"/s,
    /exportJob\.updateMany?\([\s\S]{0,1200}data:\s*\{[^}]{0,500}(executionState|status)\s*:/s,
    /bulkUndoExecution\.updateMany?\([\s\S]{0,1200}data:\s*\{[^}]{0,500}state\s*:/s,
    /storeOperation\.updateMany?\([\s\S]{0,1200}data:\s*\{[^}]{0,500}status\s*:/s,
    /bulkMutationSubmission\.updateMany?\([\s\S]{0,1200}data:\s*\{[^}]{0,500}status\s*:/s,
  ];
  return risky.some((pattern) => pattern.test(source));
}

test("critical flows do not directly mutate edit history status/execution state", () => {
  const violations = [];
  for (const relative of TARGET_FILES) {
    const abs = path.resolve(ROOT, relative);
    if (ALLOWLIST.has(abs)) continue;
    const src = fs.readFileSync(abs, "utf8");
    if (hasLegacyStatusMutation(src)) {
      violations.push(relative);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `Legacy direct edit history state writes found in: ${violations.join(", ")}`,
  );
});

test("critical flows do not use deprecated orchestration tables as authority", () => {
  const forbidden = /\bprisma\.(storeOperation|bulkMutationSubmission|bulkUndoExecution)\b/;
  const violations = [];

  for (const relative of TARGET_FILES) {
    const abs = path.resolve(ROOT, relative);
    const src = fs.readFileSync(abs, "utf8");
    if (forbidden.test(src)) {
      violations.push(relative);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Deprecated orchestration table usage found in: ${violations.join(", ")}`,
  );
});

test("critical runtime flows do not directly write legacy authority tables", () => {
  const forbiddenWrites = /\bprisma\.(editHistory|storeOperation|bulkUndoExecution|exportJob)\.(update|updateMany|upsert)\b/;
  const violations = [];

  for (const relative of TARGET_FILES) {
    const abs = path.resolve(ROOT, relative);
    if (ALLOWLIST.has(abs)) continue;
    const src = fs.readFileSync(abs, "utf8");
    if (forbiddenWrites.test(src)) {
      violations.push(relative);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Direct legacy table writes found in runtime files: ${violations.join(", ")}`,
  );
});
