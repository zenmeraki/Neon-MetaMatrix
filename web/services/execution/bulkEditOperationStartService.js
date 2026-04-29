import { LOCK_NS } from "../../constants/lockNamespaces.js";
import { OPERATION_TYPES } from "../../constants/operationTypes.js";
import { prisma } from "../../config/database.js";
import { storeOperationRepository } from "../../repositories/storeOperationRepository.js";
import { storeOperationalStateRepository } from "../../repositories/storeOperationalStateRepository.js";
import { targetSnapshotSetRepository } from "../../repositories/targetSnapshotSetRepository.js";
import {
  buildBulkEditIdempotencyKey,
  stableHash,
} from "../../utils/idempotencyKey.js";
import { storeExecutionPolicyService } from "./storeExecutionPolicyService.js";
import { operationEventRepository } from "../../repositories/operationEventRepository.js";
import {
  acquireShopLocks,
  releaseShopLocks,
} from "./storeMultiLockService.js";
import { assertWriteInvariant } from "./writeInvariantService.js";

export async function startBulkEditOperationForHistory({
  history,
  operationType = OPERATION_TYPES.BULK_EDIT,
  source = "MANUAL",
  userId = null,
  clientRequestId,
  targetHash,
  editPayload,
  onStarted,
}) {
  const resolvedTargetHash =
    targetHash ||
    stableHash({
      queryFilter: history.queryFilter,
      targetMirrorBatchId: history.targetMirrorBatchId,
      totalItems: history.totalItems,
      targetSnapshotCount: history.targetSnapshotCount,
      sourceTargetSnapshotId: history.batch?.sourceTargetSnapshotId || null,
    });
  const idempotencyKey = buildBulkEditIdempotencyKey({
    shop: history.shop,
    userId,
    targetHash: resolvedTargetHash,
    editPayload: editPayload || history.rules,
    clientRequestId: clientRequestId || history.id,
  });
  const existing = await storeOperationRepository.findByIdempotencyKey(idempotencyKey);

  if (existing) {
    return existing;
  }

  const policy = await storeExecutionPolicyService.canStartOperation({
    shop: history.shop,
    operationType,
  });

  if (!policy.allowed) {
    const error = new Error(policy.message);
    error.code = policy.reason;
    throw error;
  }

  const lockResult = await acquireShopLocks(history.shop, [
    LOCK_NS.WRITE_CATALOG,
    operationType === OPERATION_TYPES.BULK_EDIT
      ? LOCK_NS.BULK_EDIT_WRITE
      : LOCK_NS.SCHEDULED_EDIT,
  ]);

  if (!lockResult.acquired) {
    const error = new Error("Another operation is already running.");
    error.code = "LOCK_HELD";
    throw error;
  }

  let operation = null;

  try {
    const now = new Date();
    operation = await storeOperationRepository.create({
      shop: history.shop,
      type: operationType,
      status: "RUNNING",
      requestedBy: userId,
      source,
      lockKey: lockResult.locks?.map((lock) => lock.key).join(",") || null,
      idempotencyKey,
      editHistoryId: history.id,
      targetHash: resolvedTargetHash,
      catalogBatchId: history.targetMirrorBatchId,
      productBatchId: history.targetMirrorBatchId,
      variantBatchId: history.targetMirrorBatchId,
      collectionBatchId: history.targetMirrorBatchId,
      mirrorBatchId: history.targetMirrorBatchId,
      totalTargets: history.targetSnapshotCount || history.totalItems || null,
      startedAt: now,
      heartbeatAt: now,
    });

    await storeOperationalStateRepository.setActiveWrite(history.shop, operation.id);

    assertWriteInvariant({
      operation,
      lockResult,
      idempotencyKey,
      snapshotFrozen: Boolean(history.targetSnapshotCount || history.batch?.frozen),
    });

    await operationEventRepository.emit({
      shop: history.shop,
      operationId: operation.id,
      type: "OPERATION_STARTED",
      payload: {
        operationType,
        source,
        editHistoryId: history.id,
      },
    });

    await prisma.editHistory.update({
      where: { id: history.id },
      data: {
        batch: {
          ...(history.batch || {}),
          operationId: operation.id,
        },
      },
    });

    await targetSnapshotSetRepository.materializeFromEditHistory({
      operationId: operation.id,
      shop: history.shop,
      historyId: history.id,
    });

    await operationEventRepository.emit({
      shop: history.shop,
      operationId: operation.id,
      type: "TARGET_FROZEN",
      payload: {
        editHistoryId: history.id,
        targetCount: history.targetSnapshotCount || history.totalItems || null,
      },
    });

    await onStarted?.(operation);

    return operation;
  } catch (error) {
    if (operation?.id) {
      await storeOperationRepository.fail(operation.id, {
        errorCode: error.code || "BULK_EDIT_START_FAILED",
        errorMessage: error.message,
      });

      await storeOperationalStateRepository.clearActiveWrite(history.shop, operation.id);
    }

    throw error;
  } finally {
    await releaseShopLocks(lockResult.locks);
  }
}
