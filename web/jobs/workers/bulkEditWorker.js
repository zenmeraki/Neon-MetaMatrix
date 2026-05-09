import { Worker } from "bullmq";
import { connection } from "../../config/redis.js";
import { getCurrentBulkOperationStatus } from "../../modules/bulkOperations/bulkOperationHelper.js";
import ProductBulkService from "../../services/productService/productBulkEditService.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { logWorkerError } from "../../utils/errorLogUtils.js";
import { finalizeRecurringRunFromHistory } from "../../services/recurringEditExecutionService.js";
import { finalizeAutomaticProductRuleRunFromHistory } from "../../services/automaticProductRuleExecutionService.js";
import { prisma } from "../../config/database.js";
import { recordMirrorAnomaly } from "../../services/mirrorAnomalyService.js";
import { storeOperationalStateRepository } from "../../repositories/storeOperationalStateRepository.js";
import {
  acquireExclusiveShopWork,
  releaseExclusiveShopWork,
} from "../../services/shopWorkLeaseService.js";
import {
  getJobAttempt,
  isRetryExhausted,
  recordRetryExhausted,
} from "../../utils/workerTelemetry.js";
import { addDeadLetterJob } from "../queues/deadLetterQueue.js";
import { OPERATION_QUEUE_NAMES } from "../queues/operationQueueRegistry.js";
import { operationEventRepository } from "../../repositories/operationEventRepository.js";
import { requireJobData } from "../../utils/jobPayloadValidation.js";
import { assertShopMatch } from "../../utils/assertShopMatch.js";
import { getSession } from "../../utils/sessionHandler.js";
import logger from "../../utils/loggerUtils.js";
import { LOCK_NS } from "../../constants/lockNamespaces.js";
import {
  acquireShopLocks,
  releaseShopLocks,
} from "../../services/execution/storeMultiLockService.js";
import {
  BULK_EDIT_EXECUTION_STATES,
  appendExecutionError,
  buildExecutionError,
  isTerminalExecutionState,
} from "../../services/bulkEditExecutionStateService.js";
import { toUnrecoverableIfNonRetryable } from "../../utils/nonRetryableJobCodes.js";
import { getFrozenTargetSnapshotSummary } from "../../services/productService/productTargetingService.js";
import { stableHash } from "../../utils/idempotencyKey.js";
import { bulkEditHistoryRepository } from "../../repositories/bulkEditHistoryRepository.js";
import { transitionOperation } from "../../services/operationTransitionService.js";
import { mapLegacyExecutionStateToCanonical } from "../../services/merchantOperationStateService.js";
import { claimExecutionPlanForDispatch } from "../../services/bulkExecution/executionPlanService.js";
import { operationLeaseService } from "../../services/execution/operationLeaseService.js";
import { assertEditExecutionUsesFrozenTargets } from "../../services/execution/frozenTargetInvariantService.js";

const QUEUE_NAME =
  process.env.EDIT_QUEUE || OPERATION_QUEUE_NAMES.BULK_EDIT_EXECUTE;

const WORKER_NAME = "bulkEditWorker";
const WORKER_ID = `${WORKER_NAME}:${process.pid}`;
const LEASE_RENEW_MS = 10_000;
const LEASE_TTL_MS = 30_000;
const STALE_DISPATCH_MS = 20 * 60 * 1000;

class RetryableBulkEditError extends Error {
  constructor(message, code = "retryable_bulk_edit") {
    super(message);
    this.name = "RetryableBulkEditError";
    this.retryable = true;
    this.code = code;
  }
}

function isRetryableError(error) {
  return Boolean(error?.retryable);
}

function isStaleDispatch(batch) {
  const startedAt = batch?.dispatchStartedAt;
  if (!startedAt) return false;

  const startedTs = new Date(startedAt).getTime();
  if (Number.isNaN(startedTs)) return false;

  return Date.now() - startedTs > STALE_DISPATCH_MS;
}

async function claimHistoryExecution(historyId, shop, executionId, jobId, attempt) {
  const history = await prisma.editHistory.findFirst({
    where: { id: historyId, shop },
    select: {
      id: true,
      shop: true,
      status: true,
      executionState: true,
      rules: true,
      batch: true,
      targetSnapshotCount: true,
      executionIdentity: true,
      bulkOperationId: true,
      error: true,
      completedAt: true,
      summary: true,
    },
  });

  if (!history) {
    throw new Error("Edit history not found");
  }

  if (
    executionId &&
    history.executionIdentity &&
    executionId !== history.executionIdentity
  ) {
    throw new Error("Bulk edit execution identity mismatch");
  }

  if (
    isTerminalExecutionState(history.executionState) ||
    ["completed", "failed", "cancelled", "partial"].includes(history.status)
  ) {
    return { state: "terminal", history };
  }

  if (
    history.executionState === BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY &&
    history.bulkOperationId
  ) {
    return { state: "awaiting_shopify", history };
  }

  if (history.executionState === BULK_EDIT_EXECUTION_STATES.FINALIZING) {
    return { state: "finalizing", history };
  }

  const batch =
    history.batch && typeof history.batch === "object" ? history.batch : {};

  if (history.executionState === BULK_EDIT_EXECUTION_STATES.DISPATCHING) {
    if (!history.bulkOperationId && isStaleDispatch(batch)) {
      const structuredError = buildExecutionError({
        code: "dispatch_stalled",
        stage: "dispatch",
        message: "Bulk edit dispatch stalled before Shopify mutation confirmation",
        retryable: false,
        details: {
          dispatchStartedAt: batch.dispatchStartedAt,
          dispatchJobId: batch.dispatchJobId || null,
          dispatchAttempt: batch.dispatchAttempt || null,
        },
      });

      await bulkEditHistoryRepository.applyProjectionUpdate({
        where: {
          id: historyId,
          shop,
          executionState: BULK_EDIT_EXECUTION_STATES.DISPATCHING,
          bulkOperationId: null,
        },
        data: {
          status: "failed",
          executionState: BULK_EDIT_EXECUTION_STATES.FAILED,
          failureStage: "dispatch_timeout",
          error: appendExecutionError(history.error, structuredError),
          completedAt: new Date(),
        },
      });

      return { state: "stale_dispatch_failed", history };
    }

    return { state: "already_running", history };
  }

  const nextBatch = {
    ...batch,
    dispatchStartedAt: new Date().toISOString(),
    dispatchJobId: jobId,
    dispatchAttempt: attempt,
    activeExecutionId: history.executionIdentity,
  };

  const updated = await bulkEditHistoryRepository.applyProjectionUpdate({
    where: {
      id: historyId,
      shop,
      bulkOperationId: null,
      executionState: {
        in: [
          BULK_EDIT_EXECUTION_STATES.PLANNED,
          BULK_EDIT_EXECUTION_STATES.QUEUED,
          BULK_EDIT_EXECUTION_STATES.FAILED,
        ],
      },
      status: { notIn: ["completed", "failed", "cancelled", "partial"] },
    },
    data: {
      status: "processing",
      executionState: BULK_EDIT_EXECUTION_STATES.DISPATCHING,
      error: null,
      failureStage: null,
      batch: nextBatch,
    },
  });

  if (!updated.count) {
    return { state: "not_claimed", history };
  }

  const claimedHistory = await prisma.editHistory.findFirst({
    where: { id: historyId, shop },
    select: {
      id: true,
      shop: true,
      rules: true,
      batch: true,
      summary: true,
      targetSnapshotCount: true,
      executionIdentity: true,
      executionState: true,
    },
  });

  return { state: "claimed", history: claimedHistory };
}

async function markHistoryRetryable(historyId, shop, error, attempt, details = {}) {
  const history = await prisma.editHistory.findFirst({
    where: { id: historyId, shop },
    select: {
      error: true,
      batch: true,
    },
  });

  if (!history) return;

  const batch =
    history.batch && typeof history.batch === "object" ? history.batch : {};

  await bulkEditHistoryRepository.applyProjectionUpdate({
    where: {
      id: historyId,
      shop,
      executionState: BULK_EDIT_EXECUTION_STATES.DISPATCHING,
      bulkOperationId: null,
    },
    data: {
      status: "pending",
      executionState: BULK_EDIT_EXECUTION_STATES.QUEUED,
      failureStage: error.code || "retryable",
      error: appendExecutionError(
        history.error,
        buildExecutionError({
          code: error.code || "retryable_execution",
          stage: "dispatch",
          message: error.message,
          retryable: true,
          details: {
            ...details,
            attempt,
          },
        }),
      ),
      batch: {
        ...batch,
        lastRetryableErrorAt: new Date().toISOString(),
        lastRetryableErrorCode: error.code || "retryable_execution",
      },
    },
  });

  const operationId = history?.batch?.operationId || null;
  if (operationId) {
    await transitionOperation({
      shop,
      operationId,
      from: "DISPATCHING",
      to: "SNAPSHOTTED",
      data: {
        errorCode: error.code || "retryable_execution",
        errorMessage: error.message,
      },
    });
  }
}

async function markHistoryFailure(historyId, shop, error, attempt, executionId, source) {
  const history = await prisma.editHistory.findFirst({
    where: { id: historyId, shop },
    select: {
      error: true,
      batch: true,
    },
  });

  await bulkEditHistoryRepository
    .applyProjectionUpdate({
      where: { id: historyId, shop },
      data: {
        status: "failed",
        executionState: BULK_EDIT_EXECUTION_STATES.FAILED,
        failureStage: "queue_execution",
        completedAt: new Date(),
        error: appendExecutionError(
          history?.error,
          buildExecutionError({
            code: error.code || "bulk_edit_worker_failure",
            stage: "queue_execution",
            message: error.message,
            retryable: false,
            details: {
              stack: error.stack || null,
              attempt,
              source,
              executionId,
            },
          }),
        ),
      },
    })
    .catch(() => {});

  const operationId = history?.batch?.operationId || null;
  if (operationId) {
    await transitionOperation({
      shop,
      operationId,
      from: "DISPATCHING",
      to: "FAILED",
      data: {
        failedAt: new Date(),
        errorCode: error.code || "bulk_edit_worker_failure",
        errorMessage: error.message,
      },
    });
  }
}

function resolveMutationFields(rules) {
  return Array.isArray(rules)
    ? rules.map((rule) => rule?.field).filter(Boolean)
    : [];
}

function buildSubmissionErrorPayload(error) {
  return {
    code: error?.code || null,
    message: error?.message || "Unknown bulk mutation submission failure",
    name: error?.name || null,
  };
}

async function recoverAcceptedSubmissionAfterCrash({
  session,
  shop,
  operationId,
  historyId,
  batchId,
  dispatchJobId,
  dispatchAttempt,
  currentSubmission,
}) {
  if (!currentSubmission) return null;
  if (currentSubmission.bulkOperationId || currentSubmission.shopifyBulkOperationId) {
    return {
      bulkOperationId:
        currentSubmission.bulkOperationId || currentSubmission.shopifyBulkOperationId,
      stagedUploadPath: currentSubmission.stagedUploadPath || null,
    };
  }

  if (!["SUBMITTING", "SUBMITTED"].includes(currentSubmission.status)) {
    return null;
  }

  const currentBulk = await getCurrentBulkOperationStatus(session, "MUTATION");
  const bulkOperationId =
    currentBulk?.status === "RUNNING" && currentBulk?.id ? currentBulk.id : null;

  if (!bulkOperationId) {
    return null;
  }

  await prisma.operationSubmission.updateMany({
    where: {
      shop,
      merchantOperationId: operationId,
      dispatchJobId,
      dispatchAttempt,
      status: "SUBMITTED",
      bulkOperationId: null,
    },
    data: {
      status: "AWAITING_SHOPIFY",
      bulkOperationId,
      submittedAt: new Date(),
    },
  });

  const refreshed = await prisma.operationSubmission.findFirst({
    where: {
      shop,
      merchantOperationId: operationId,
      dispatchJobId,
      dispatchAttempt,
    },
    select: {
      status: true,
      bulkOperationId: true,
      stagedUploadPath: true,
    },
  });

  if (refreshed?.bulkOperationId) {
    return {
      bulkOperationId: refreshed.bulkOperationId,
      stagedUploadPath: refreshed.stagedUploadPath || null,
    };
  }

  return null;
}

function chunkArray(items, size = 1000) {
  const source = Array.isArray(items) ? items : [];
  const chunkSize = Math.max(1, Number(size) || 1000);
  const chunks = [];
  for (let index = 0; index < source.length; index += chunkSize) {
    chunks.push(source.slice(index, index + chunkSize));
  }
  return chunks;
}

function toNormalizedChangeRecordRows({
  shop,
  historyId,
  operationId,
  batchId,
  changes,
}) {
  const rows = [];
  const list = Array.isArray(changes) ? changes : [];

  for (const change of list) {
    const productId = change?.productId;
    if (!productId) continue;

    const base = {
      editHistoryId: historyId,
      operationId,
      productId,
      shop,
      image: change?.image || null,
      title: change?.title || "",
      batchId,
      status: "submitted",
      options: Array.isArray(change?.options) ? change.options : null,
    };

    const productFieldChanges = Array.isArray(change?.productFieldChanges)
      ? change.productFieldChanges
      : [];
    for (const fieldChange of productFieldChanges) {
      if (!fieldChange?.field) continue;
      rows.push({
        ...base,
        scope: "product",
        entityType: "PRODUCT",
        entityId: productId,
        field: fieldChange.field,
        variantId: null,
        beforeValue: fieldChange.oldValue ?? null,
        afterValue: fieldChange.newValue ?? null,
        oldValue: fieldChange.oldValue ?? null,
        newValue: fieldChange.newValue ?? null,
        productFieldChanges: [fieldChange],
        variantFieldChanges: null,
      });
    }

    const variantFieldChanges = Array.isArray(change?.variantFieldChanges)
      ? change.variantFieldChanges
      : [];
    for (const variantChange of variantFieldChanges) {
      const variantId = variantChange?.variantId || null;
      if (!variantId) continue;
      const fieldChanges = Array.isArray(variantChange?.changes)
        ? variantChange.changes
        : [];
      for (const fieldChange of fieldChanges) {
        if (!fieldChange?.field) continue;
        rows.push({
          ...base,
          scope: "variant",
          entityType: "VARIANT",
          entityId: variantId,
          field: fieldChange.field,
          variantId,
          beforeValue: fieldChange.oldValue ?? null,
          afterValue: fieldChange.newValue ?? null,
          oldValue: fieldChange.oldValue ?? null,
          newValue: fieldChange.newValue ?? null,
          productFieldChanges: null,
          variantFieldChanges: [
            {
              variantId,
              variantTitle: variantChange?.variantTitle || null,
              selectedOptions: Array.isArray(variantChange?.selectedOptions)
                ? variantChange.selectedOptions
                : [],
              changes: [fieldChange],
            },
          ],
        });
      }
    }
  }

  return rows;
}

async function assertSnapshotFingerprintMatch(history) {
  const batch = history?.batch && typeof history.batch === "object" ? history.batch : {};
  const previewFingerprint =
    typeof batch.previewSnapshotFingerprint === "string"
      ? batch.previewSnapshotFingerprint
      : null;

  if (!previewFingerprint) return;

  const summary = await getFrozenTargetSnapshotSummary({
    ownerType: "EDIT_HISTORY",
    ownerId: history.id,
    shop: history.shop,
  });

  const executionFingerprint = stableHash({
    shop: history.shop,
    mirrorBatchId: summary.mirrorBatchId || null,
    targetCount: Number(summary.count || 0),
    targetSnapshotId:
      typeof batch.sourceTargetSnapshotId === "string"
        ? batch.sourceTargetSnapshotId
        : null,
    filterParams: [],
  });

  const authoritativeFingerprint =
    typeof summary?.plannerFingerprint === "string" && summary.plannerFingerprint.trim()
      ? summary.plannerFingerprint.trim()
      : executionFingerprint;

  if (authoritativeFingerprint !== previewFingerprint) {
    const error = new Error("SNAPSHOT_FINGERPRINT_MISMATCH");
    error.code = "SNAPSHOT_FINGERPRINT_MISMATCH";
    throw error;
  }
}

async function processBulkEdit(job) {
  const data = requireJobData(
    job,
    ["historyId", "shop", "operationId", "executionId", "intentId"],
    "bulk edit",
  );
  const {
    historyId,
    shop,
    source = "bulk-edit",
    executionId,
    operationId,
    intentId,
    executionPlanId = null,
  } = data;

  const attempt = getJobAttempt(job);

  let shopLockKey = null;
  let activeOperationId = operationId;
  let leaseRenewal = null;
  let executionWriteLocks = null;
  let activeBatchId = null;

  try {
    if (!executionPlanId) {
      const error = new Error("BULK_EDIT_NON_PLAN_BYPASS_BLOCKED");
      error.code = "BULK_EDIT_NON_PLAN_BYPASS_BLOCKED";
      throw error;
    }

    const forbiddenKeys = ["filters", "filterParams", "field", "action", "value"];
    const hasForbiddenPayload = forbiddenKeys.some((key) => key in data);
    if (hasForbiddenPayload) {
      const error = new Error("WORKER_REJECTS_LEGACY_MUTATION_PAYLOAD");
      error.code = "WORKER_REJECTS_LEGACY_MUTATION_PAYLOAD";
      throw error;
    }
    await claimExecutionPlanForDispatch({ executionPlanId, shop });

    const session = await getSession(shop);

    if (!session?.shop) {
      throw new Error("Shop session not available for bulk edit execution");
    }
    assertShopMatch({
      jobShop: shop,
      dbShop: session.shop,
      context: "bulk_edit_session",
      jobId: job?.id || null,
      entityType: "editHistory",
      entityId: historyId,
    });

    const lock = await acquireExclusiveShopWork({
      shop,
      activity: "bulk_edit_execution",
      worker: WORKER_NAME,
      queue: QUEUE_NAME,
      jobId: job.id,
      entityType: "editHistory",
      entityId: historyId,
      executionId,
    });

    if (!lock.acquired) {
      throw new RetryableBulkEditError(
        "Another heavy job is already running for this shop",
        "shop_work_conflict",
      );
    }

    shopLockKey = lock.lockKey;
    if (typeof activeOperationId !== "string" || !activeOperationId.trim()) {
      const error = new Error("OPERATION_ID_REQUIRED_FOR_BULK_EDIT_JOB");
      error.code = "OPERATION_ID_REQUIRED_FOR_BULK_EDIT_JOB";
      throw error;
    }

    const lease = await operationLeaseService.acquire({
      operationId: activeOperationId,
      workerId: WORKER_ID,
      ttlMs: LEASE_TTL_MS,
    });

    if (!lease.acquired) {
      throw new RetryableBulkEditError(
        "Bulk edit operation lease is held by another worker",
        "operation_lease_held",
      );
    }

    leaseRenewal = setInterval(() => {
      operationLeaseService
        .renew({
          operationId: activeOperationId,
          workerId: WORKER_ID,
          ttlMs: LEASE_TTL_MS,
        })
        .catch(() => {});
    }, LEASE_RENEW_MS);

    leaseRenewal.unref?.();

    await transitionOperation({
      shop,
      operationId: activeOperationId,
      from: "SNAPSHOTTED",
      to: "DISPATCHING",
    }).catch(() => {});

    const claimResult = await claimHistoryExecution(
      historyId,
      shop,
      executionId,
      job.id,
      attempt,
    );

    if (
      [
        "terminal",
        "awaiting_shopify",
        "finalizing",
        "already_running",
        "not_claimed",
        "stale_dispatch_failed",
      ].includes(claimResult.state)
    ) {
      return {
        skipped: true,
        reason: claimResult.state,
        shop,
        historyId,
      };
    }

    const history = claimResult.history;
    await assertEditExecutionUsesFrozenTargets({
      shop,
      historyId,
      phase: "bulk_edit_execute_worker",
    });
    const storedIntent = history?.summary?.bulkEditIntent || null;
    const storedIntentId =
      (typeof history?.summary?.intentId === "string" && history.summary.intentId) ||
      (typeof history?.batch?.intentId === "string" && history.batch.intentId) ||
      (storedIntent ? stableHash(storedIntent) : null);
    if (!storedIntent || !storedIntentId || storedIntentId !== intentId) {
      const error = new Error("BULK_EDIT_INTENT_REQUIRED");
      error.code = "BULK_EDIT_INTENT_REQUIRED";
      throw error;
    }
    if (activeOperationId) {
      const from = mapLegacyExecutionStateToCanonical(history.executionState);
      await transitionOperation({
        shop,
        operationId: activeOperationId,
        from,
        to: "DISPATCHING",
      });
    }
    await assertSnapshotFingerprintMatch(history);
    const dispatchJobId = history?.batch?.dispatchJobId || null;
    if (dispatchJobId && dispatchJobId !== job.id) {
      const error = new Error("OPERATION_JOB_ID_MISMATCH");
      error.code = "OPERATION_JOB_ID_MISMATCH";
      throw error;
    }
    const historyOperationId = history?.batch?.operationId || null;
    if (historyOperationId && historyOperationId !== activeOperationId) {
      const error = new Error("OPERATION_ID_MISMATCH");
      error.code = "OPERATION_ID_MISMATCH";
      throw error;
    }

    const { status } = await getCurrentBulkOperationStatus(session);
    if (status === "RUNNING") {
      const activeSubmission = await prisma.operationSubmission.findFirst({
        where: {
          shop,
          merchantOperationId: activeOperationId,
          status: { in: ["SUBMITTED", "AWAITING_SHOPIFY"] },
        },
        select: { id: true },
      });

      if (!activeSubmission) {
        throw new RetryableBulkEditError(
          "Another Shopify bulk operation is already running",
          "shopify_bulk_busy",
        );
      }
    }

    await clearKeyCaches(`${shop}:fetchHistories`);
    await clearKeyCaches(`${shop}:historyDetails:${historyId}`);

    const service = new ProductBulkService(session);
    executionWriteLocks = await acquireShopLocks(shop, [
      LOCK_NS.WRITE_CATALOG,
      LOCK_NS.BULK_EDIT_WRITE,
    ]);
    if (!executionWriteLocks.acquired) {
      throw new RetryableBulkEditError(
        "Execution write lock is held by another operation",
        "execution_write_lock_held",
      );
    }

    const {
      formattedProducts,
      changes,
      hasMore,
      lastProductId,
      lastOrdinal,
      batchId,
      batchTargetCount,
      batchVariantCount,
    } = await service._preparingBulkOperation({ historyId });
    activeBatchId = batchId || null;

    if (!Array.isArray(formattedProducts)) {
      throw new Error(
        `INVALID_PREPARATION_OUTPUT: expected formattedProducts array, got ${typeof formattedProducts}`,
      );
    }

    const safeChanges = Array.isArray(changes) ? changes : [];

    if (formattedProducts.length === 0 && history.targetSnapshotCount > 0) {
      const error = new Error("EMPTY_BULK_MUTATION_JSONL_PAYLOAD");
      error.code = "EMPTY_BULK_MUTATION_JSONL_PAYLOAD";
      throw error;
    }

    if (formattedProducts.length === 0) {
      const error = new Error("EMPTY_BULK_MUTATION_JSONL_PAYLOAD");
      error.code = "EMPTY_BULK_MUTATION_JSONL_PAYLOAD";
      throw error;
    }

    const mutationFields = resolveMutationFields(history.rules);

    const executableProducts = formattedProducts;
    const executableChanges = safeChanges;

    await bulkEditHistoryRepository.applyProjectionUpdate({
      where: {
        id: historyId,
        shop,
        executionState: BULK_EDIT_EXECUTION_STATES.DISPATCHING,
        bulkOperationId: null,
      },
      data: {
        processingBatchId: batchId,
        batch: {
          ...(history.batch || {}),
          currentBatchId: batchId,
          currentBatchTargetCount: batchTargetCount,
          currentBatchCount: executableChanges.length,
          dispatchPreparedAt: new Date().toISOString(),
        },
      },
    });

    let submission = await prisma.operationSubmission.findFirst({
      where: {
        shop,
        merchantOperationId: activeOperationId,
        dispatchJobId: job.id,
        dispatchAttempt: attempt,
      },
      select: {
        status: true,
        bulkOperationId: true,
        stagedUploadPath: true,
      },
    });

    if (!submission) {
      submission = await prisma.operationSubmission.create({
        data: {
          shop,
          merchantOperationId: activeOperationId,
          type: "SHOPIFY_BULK_MUTATION",
          provider: "SHOPIFY",
          dispatchJobId: job.id,
          dispatchAttempt: attempt,
          status: "PLANNED",
          metadata: { historyId, batchId },
        },
        select: {
          status: true,
          bulkOperationId: true,
          stagedUploadPath: true,
        },
      });
    } else if (submission.status === "FAILED") {
      await prisma.operationSubmission.updateMany({
        where: {
          shop,
          merchantOperationId: activeOperationId,
          dispatchJobId: job.id,
          dispatchAttempt: attempt,
          status: "FAILED",
        },
        data: {
          status: "PLANNED",
          stagedUploadPath: null,
          stagedUploadUrl: null,
          bulkOperationId: null,
          resultUrl: null,
          errorCode: null,
          errorMessage: null,
        },
      });
      submission = {
        status: "PLANNED",
        bulkOperationId: null,
        stagedUploadPath: null,
      };
    }

    if (batchId) {
      await prisma.changeRecord.deleteMany({
        where: {
          editHistoryId: historyId,
          shop,
          batchId,
          status: "pending",
        },
      });
    }

    await clearKeyCaches(`${shop}:historyChanges:${historyId}`);

    const mutationRows = executableChanges.flatMap((change) => {
      const productChanges = Array.isArray(change.productFieldChanges)
        ? change.productFieldChanges
        : [];

      const variantChanges = Array.isArray(change.variantFieldChanges)
        ? change.variantFieldChanges.flatMap((variantChange) =>
            Array.isArray(variantChange.changes)
              ? variantChange.changes.map((fieldChange) => ({
                  entityId: variantChange.variantId,
                  field: fieldChange.field,
                }))
              : [],
          )
        : [];

      return [
        ...productChanges.map((fieldChange) => ({
          entityId: change.productId,
          entityType: "PRODUCT",
          field: fieldChange.field,
        })),
        ...variantChanges,
      ].map((row) => ({
        shop,
        operationId: activeOperationId,
        entityId: row.entityId,
        entityType: row.entityType || "VARIANT",
        field: row.field,
        batchId,
        status: "PREPARED",
      }));
    });

    let shopifyBulkOperationId = submission?.bulkOperationId || null;
    let stagedUploadPath = submission?.stagedUploadPath || null;

    if (!shopifyBulkOperationId) {
      const submissionClaim = await prisma.operationSubmission.updateMany({
        where: {
          shop,
          merchantOperationId: activeOperationId,
          dispatchJobId: job.id,
          dispatchAttempt: attempt,
          status: "PLANNED",
        },
        data: {
          status: "SUBMITTED",
          dispatchJobId: job.id,
          dispatchAttempt: attempt,
          errorCode: null,
          errorMessage: null,
        },
      });
      if (submissionClaim.count !== 1) {
        const currentSubmission = await prisma.operationSubmission.findFirst({
          where: {
            shop,
            merchantOperationId: activeOperationId,
            dispatchJobId: job.id,
            dispatchAttempt: attempt,
          },
          select: {
            status: true,
            bulkOperationId: true,
            stagedUploadPath: true,
          },
        });

        if (
          currentSubmission?.status === "AWAITING_SHOPIFY" &&
          currentSubmission.bulkOperationId
        ) {
          shopifyBulkOperationId = currentSubmission.bulkOperationId;
          stagedUploadPath = currentSubmission.stagedUploadPath || null;
        } else {
          const recovered = await recoverAcceptedSubmissionAfterCrash({
            session,
            shop,
            operationId: activeOperationId,
            historyId,
            batchId,
            dispatchJobId: job.id,
            dispatchAttempt: attempt,
            currentSubmission,
          });

          if (recovered?.bulkOperationId) {
            shopifyBulkOperationId = recovered.bulkOperationId;
            stagedUploadPath = recovered.stagedUploadPath || null;
          } else {
            throw new RetryableBulkEditError(
              "Bulk mutation submission is already in progress",
              "submission_in_progress",
            );
          }
        }
      } else {
        await prisma.operationSubmission.updateMany({
          where: {
            shop,
            merchantOperationId: activeOperationId,
            dispatchJobId: job.id,
            dispatchAttempt: attempt,
          },
          data: {
            status: "STAGED",
          },
        });
        const result = await service._bulkOperationHelper({
          formattedProducts: executableProducts,
          field: history.rules?.[0]?.field || "",
          fields: mutationFields,
        });
        stagedUploadPath = result?.stagedUploadPath || null;
        shopifyBulkOperationId = result?.bulkOperation?.id || null;

        if (!shopifyBulkOperationId) {
          throw new Error("Missing bulkOperationId in Shopify response");
        }
        await prisma.operationSubmission.updateMany({
          where: {
            shop,
            merchantOperationId: activeOperationId,
            dispatchJobId: job.id,
            dispatchAttempt: attempt,
          },
          data: {
            status: "SUBMITTED",
            stagedUploadPath,
            stagedUploadUrl: stagedUploadPath,
            bulkOperationId: shopifyBulkOperationId,
            submittedAt: new Date(),
          },
        });
      }
    }

    if (
      String(process.env.CHAOS_CRASH_AFTER_SHOPIFY_ACCEPT || "").toLowerCase() === "true" &&
      String(process.env.CHAOS_OPERATION_ID || "") === String(activeOperationId)
    ) {
      const error = new Error("CHAOS_CRASH_AFTER_SHOPIFY_ACCEPT");
      error.code = "CHAOS_CRASH_AFTER_SHOPIFY_ACCEPT";
      throw error;
    }

    if (!shopifyBulkOperationId) {
      throw new Error("Missing bulkOperationId in submission state");
    }

    if (mutationRows.length > 0) {
      const mutationChunks = chunkArray(mutationRows, 1000);
      for (const chunk of mutationChunks) {
        await prisma.operationMutation.createMany({
          data: chunk.map((row) => ({
            ...row,
            status: "SUBMITTED",
            shopifyBulkOperationId,
          })),
          skipDuplicates: true,
        });
      }
    }

    const existingBatch = history.batch ?? {};
    const updatedBatch = {
      ...existingBatch,
      lastProductId,
      lastOrdinal,
      hasMore,
      currentBatchCount: executableChanges.length,
      currentBatchTargetCount: batchTargetCount,
      currentBatchId: batchId,
      dispatchCompletedAt: new Date().toISOString(),
      lastSubmittedBulkOperationId: shopifyBulkOperationId,
    };

    const updated = await prisma.$transaction(async (tx) => {
      const submissionPersisted = await tx.operationSubmission.updateMany({
        where: {
          shop,
          merchantOperationId: activeOperationId,
          dispatchJobId: job.id,
          dispatchAttempt: attempt,
          OR: [
            {
              status: {
                in: ["SUBMITTED", "STAGED", "AWAITING_SHOPIFY"],
              },
            },
            {
              status: "AWAITING_SHOPIFY",
              bulkOperationId: shopifyBulkOperationId,
            },
          ],
        },
        data: {
          status: "AWAITING_SHOPIFY",
          stagedUploadPath,
          stagedUploadUrl: stagedUploadPath,
          bulkOperationId: shopifyBulkOperationId,
          dispatchJobId: job.id,
          dispatchAttempt: attempt,
          errorCode: null,
          errorMessage: null,
          submittedAt: new Date(),
        },
      });
      if (submissionPersisted.count !== 1) {
        throw new Error("Operation submission acceptance marker could not be persisted");
      }

      if (executableChanges.length > 0) {
        const normalizedRows = toNormalizedChangeRecordRows({
          shop,
          historyId,
          operationId: activeOperationId,
          batchId,
          changes: executableChanges,
        });
        const normalizedChunks = chunkArray(normalizedRows, 1000);
        for (const chunk of normalizedChunks) {
          await tx.changeRecord.createMany({
            data: chunk,
            skipDuplicates: true,
          });
        }
      }

      const projection = await bulkEditHistoryRepository.applyProjectionUpdate({
        where: {
          id: historyId,
          shop,
          bulkOperationId: null,
          executionState: BULK_EDIT_EXECUTION_STATES.DISPATCHING,
        },
        data: {
          bulkOperationId: shopifyBulkOperationId,
          batch: updatedBatch,
          processingBatchId: batchId,
          failureStage: null,
          executionState: BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY,
        },
      }, tx);

      if (projection.count === 1 && activeOperationId) {
        await transitionOperation({
          shop,
          operationId: activeOperationId,
          from: "DISPATCHING",
          to: "AWAITING_SHOPIFY",
        }, tx);
      }
      return projection;
    });

    if (!updated.count) {
      throw new Error("Bulk edit dispatch state could not be persisted safely");
    }

    if (activeOperationId) {
      await storeOperationalStateRepository.markAwaitingShopify(
        shop,
        activeOperationId,
      );
    }

    await operationEventRepository.emit({
      shop,
      operationId: activeOperationId,
      type: "BATCH_DISPATCHED",
      payload: {
        batchId,
        targetCount: batchTargetCount,
        variantCount: batchVariantCount ?? null,
        changeCount: executableChanges.length,
        bulkOperationId: shopifyBulkOperationId,
      },
    });

    await operationEventRepository.emit({
      shop,
      operationId: activeOperationId,
      type: "SUBMITTED_TO_SHOPIFY",
      payload: {
        historyId,
        batchId,
        bulkOperationId: shopifyBulkOperationId,
        dispatchJobId: job.id,
        dispatchAttempt: attempt,
      },
    });

    logger.info("Bulk edit worker queued Shopify bulk mutation", {
      worker: WORKER_NAME,
      queue: QUEUE_NAME,
      shop,
      jobId: job.id,
      historyId,
      executionId: executionId || history.executionIdentity || null,
      attempt,
      source,
      batchId,
      targetCount: batchTargetCount,
      variantCount: batchVariantCount ?? null,
      changeCount: executableChanges.length,
      bulkOperationId: shopifyBulkOperationId,
    });

    return {
      success: true,
      shop,
      historyId,
      bulkOperationId: shopifyBulkOperationId,
      attempt,
    };
  } catch (err) {
    if (shop && activeOperationId && activeBatchId) {
      await prisma.operationSubmission
        .updateMany({
          where: {
            shop,
            merchantOperationId: activeOperationId,
            dispatchJobId: job?.id || null,
            dispatchAttempt: attempt,
            status: {
              in: ["PLANNED", "STAGED", "SUBMITTED"],
            },
          },
          data: {
            status: "FAILED",
            errorCode: err?.code || "BULK_EDIT_SUBMISSION_FAILED",
            errorMessage: err?.message || "Bulk edit submission failed",
            completedAt: new Date(),
            metadata: {
              historyId,
              batchId: activeBatchId,
              error: buildSubmissionErrorPayload(err),
            },
          },
        })
        .catch(() => {});
    }

    if (isRetryableError(err)) {
      await markHistoryRetryable(historyId, shop, err, attempt, {
        source,
        worker: WORKER_NAME,
        queue: QUEUE_NAME,
        jobId: job?.id || null,
      }).catch(() => {});
    } else {
      if (activeOperationId && err.code === "OPERATION_CIRCUIT_OPEN") {
        const current = await prisma.merchantOperation.findFirst({
          where: { id: activeOperationId, shop },
          select: { status: true, processedItems: true, failedItems: true },
        });
        if (current && current.status !== "FAILED" && current.status !== "CANCELLED") {
          await transitionOperation({
            shop,
            operationId: activeOperationId,
            from: current.status,
            to: "FAILED",
            data: {
              failedAt: new Date(),
              errorCode: err.code,
              errorMessage: err.message,
              processedItems: Number(current.processedItems || 0),
              failedItems: Number(current.failedItems || 0),
            },
          }).catch(() => {});
        }
      }

      await markHistoryFailure(historyId, shop, err, attempt, executionId, source);

      await finalizeRecurringRunFromHistory({
        historyId,
        status: "FAILED",
        errorMessage: err.message,
      }).catch(() => {});

      await finalizeAutomaticProductRuleRunFromHistory({
        historyId,
        status: "FAILED",
        errorMessage: err.message,
      }).catch(() => {});

      await recordMirrorAnomaly({
        shop: shop || "unknown",
        severity: "high",
        type: "bulk_edit_worker_failure",
        entityType: "editHistory",
        entityId: historyId,
        message: err.message,
        details: {
          stage: "queue_execution",
          worker: WORKER_NAME,
          queue: QUEUE_NAME,
          jobId: job?.id || null,
          attempt,
          source,
          executionId,
        },
      }).catch(() => {});
    }

    await clearKeyCaches(`${shop}:fetchHistories`);
    await clearKeyCaches(`${shop}:historyDetails:${historyId}`);

    await logWorkerError({
      shop,
      err,
      source: "BulkEditWorker",
      metadata: {
        queue: QUEUE_NAME,
        worker: WORKER_NAME,
        jobId: job?.id || null,
        historyId,
        executionId,
        attempt,
        source,
        retryable: isRetryableError(err),
      },
    });

    if (activeOperationId && !isRetryableError(err)) {
      const current = await prisma.merchantOperation.findFirst({
        where: { id: activeOperationId, shop },
        select: { status: true },
      });
      if (current && current.status !== "FAILED" && current.status !== "CANCELLED") {
        await transitionOperation({
          shop,
          operationId: activeOperationId,
          from: current.status,
          to: "FAILED",
          data: {
            failedAt: new Date(),
            errorCode: err.code || "BULK_EDIT_FAILED",
            errorMessage: err.message,
          },
        }).catch(() => {});
      }

      await storeOperationalStateRepository.markWriteFailed(
        shop,
        activeOperationId,
      );
    }

    throw toUnrecoverableIfNonRetryable(err);
  } finally {
    if (leaseRenewal) {
      clearInterval(leaseRenewal);
    }
    if (activeOperationId) {
      await operationLeaseService
        .release({ operationId: activeOperationId, workerId: WORKER_ID })
        .catch(() => {});
    }
    if (executionWriteLocks?.locks) {
      await releaseShopLocks(executionWriteLocks.locks).catch(() => {});
    }

    await releaseExclusiveShopWork(shopLockKey);
  }
}

const bulkEditWorker = new Worker(QUEUE_NAME, processBulkEdit, {
  connection,
  concurrency: 1,
});

bulkEditWorker.on("completed", (job, result) => {
  logger.info("Bulk edit worker completed job", {
    worker: WORKER_NAME,
    queue: QUEUE_NAME,
    jobId: job?.id,
    shop: job?.data?.shop,
    historyId: job?.data?.historyId,
    executionId: job?.data?.executionId || null,
    attempt: getJobAttempt(job),
    result,
  });
});

bulkEditWorker.on("failed", async (job, error) => {
  const shop = job?.data?.shop;
  const historyId = job?.data?.historyId;
  const executionId = job?.data?.executionId || null;

  logger.error("Bulk edit worker failed", {
    worker: WORKER_NAME,
    queue: QUEUE_NAME,
    jobId: job?.id,
    shop,
    historyId,
    executionId,
    attempt: getJobAttempt(job),
    message: error.message,
  });

  if (isRetryExhausted(job)) {
    await addDeadLetterJob("bulk_edit_failed", {
      job,
      error,
      reason: "bulk_edit_retries_exhausted",
    }).catch(() => {});

    await recordRetryExhausted({
      job,
      shop,
      worker: WORKER_NAME,
      queue: QUEUE_NAME,
      entityType: "editHistory",
      entityId: historyId,
      executionId,
      message: "Bulk edit worker exhausted retries",
      details: {
        source: job?.data?.source || null,
      },
    });
  }
});

export default bulkEditWorker;
