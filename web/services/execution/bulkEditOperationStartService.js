import { LOCK_NS } from "../../constants/lockNamespaces.js";
import { OPERATION_TYPES } from "../../constants/operationTypes.js";
import { prisma } from "../../config/database.js";
import { bulkEditHistoryRepository } from "../../repositories/bulkEditHistoryRepository.js";
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
import { operationService } from "../operationService.js";
import {
  acquireDomains,
  releaseDomains,
  resolveMutationDomains,
} from "../locking/domainWriteLockService.js";

const ENABLE_DOMAIN_WRITE_LOCKS =
  String(process.env.ENABLE_DOMAIN_WRITE_LOCKS || "true").toLowerCase() !== "false";
const ENABLE_GLOBAL_WRITE_LOCK_FALLBACK =
  String(process.env.ENABLE_GLOBAL_WRITE_LOCK_FALLBACK || "false").toLowerCase() === "true";

function buildDomainLockIntent(history) {
  const summaryIntent =
    history?.summary && typeof history.summary === "object"
      ? history.summary.bulkEditIntent || null
      : null;
  const fieldFromRules =
    Array.isArray(history?.rules) && history.rules[0]?.field
      ? history.rules[0].field
      : null;

  const field = summaryIntent?.operation?.field || fieldFromRules || null;

  return {
    operation: {
      field,
    },
    rules: Array.isArray(history?.rules)
      ? history.rules.map((rule) => ({ field: rule?.field || null }))
      : [],
  };
}

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
  const existing = await prisma.merchantOperation.findFirst({
    where: {
      shop: history.shop,
      idempotencyKey,
    },
  });

  if (existing) {
    await onStarted?.(existing);
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

  const fallbackNamespaces = [
    LOCK_NS.WRITE_CATALOG,
    operationType === OPERATION_TYPES.BULK_EDIT
      ? LOCK_NS.BULK_EDIT_WRITE
      : LOCK_NS.SCHEDULED_EDIT,
  ];

  const domainIntent = buildDomainLockIntent(history);
  const mutationDomains = resolveMutationDomains(domainIntent);

  let lockResult;
  if (ENABLE_DOMAIN_WRITE_LOCKS) {
    try {
      const domainLock = await acquireDomains({
        shop: history.shop,
        operationId: history.operationId || history.id,
        domains: mutationDomains,
      });
      lockResult = {
        acquired: true,
        locks: domainLock.locks,
        mode: "domain",
        domains: mutationDomains,
      };
    } catch (error) {
      if (!ENABLE_GLOBAL_WRITE_LOCK_FALLBACK) {
        throw error;
      }
      lockResult = await acquireShopLocks(history.shop, fallbackNamespaces);
      lockResult.mode = "global_fallback";
    }
  } else {
    lockResult = await acquireShopLocks(history.shop, fallbackNamespaces);
    lockResult.mode = "global";
  }

  if (!lockResult.acquired) {
    const error = new Error("Another operation is already running.");
    error.code = "LOCK_HELD";
    throw error;
  }

  let operation = null;

  try {
    const now = new Date();
    operation = await operationService.createOperation({
      shop: history.shop,
      type: operationType === OPERATION_TYPES.SCHEDULED_EDIT ? "SCHEDULED_EDIT" : "BULK_EDIT",
      title: history.type || "Bulk edit",
      source,
      idempotencyKey,
      targetHash: resolvedTargetHash || null,
      totalItems: Number(history.targetSnapshotCount || history.totalItems || 0),
      startedAt: now,
    }, prisma);

    await operationService.transitionOperation(
      {
        shop: history.shop,
        operationId: operation.id,
        from: operation.status,
        to: "SNAPSHOTTING",
        data: {
          startedAt: now,
        },
      },
      prisma,
    );

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
      type: "PREFLIGHT_PASSED",
      payload: {
        operationType,
        editHistoryId: history.id,
      },
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

    await bulkEditHistoryRepository.applyProjectionUpdate({
      where: {
        id: history.id,
        shop: history.shop,
      },
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

    await operationService.transitionOperation(
      {
        shop: history.shop,
        operationId: operation.id,
        from: "SNAPSHOTTING",
        to: "SNAPSHOTTED",
      },
      prisma,
    );

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
      const current = await prisma.merchantOperation.findFirst({
        where: { id: operation.id, shop: history.shop },
        select: { status: true },
      });
      if (current && current.status !== "FAILED" && current.status !== "CANCELLED") {
        await operationService.transitionOperation(
          {
            shop: history.shop,
            operationId: operation.id,
            from: current.status,
            to: "FAILED",
            data: {
              failedAt: new Date(),
              errorCode: error.code || "BULK_EDIT_START_FAILED",
              errorMessage: error.message,
            },
          },
          prisma,
        );
      }

      await storeOperationalStateRepository.clearActiveWrite(history.shop, operation.id);
    }

    throw error;
  } finally {
    if (lockResult?.mode === "domain") {
      await releaseDomains({ locks: lockResult.locks }).catch(() => {});
    } else {
      await releaseShopLocks(lockResult.locks).catch(() => {});
    }
  }
}
