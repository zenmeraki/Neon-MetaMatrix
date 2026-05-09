import axios from "axios";
import { createInterface } from "node:readline";
import {
  getSession,
  getShopOwnerEmailAddress,
} from "../../../utils/sessionHandler.js";
import { productEditConfirmationEmailHTML } from "../../../config/templates/productEditConfirmationTemplate.js";
import { sendEmail } from "../../../utils/emailHelper.js";
import { addBulkUndoJob } from "../../../jobs/queues/bulkUndoJob.js";
import { addbulkEditJob } from "../../../jobs/queues/bulkEditJob.js";
import { addShopSyncJob } from "../../../jobs/queues/shopSyncJob.js";
import { clearKeyCaches } from "../../../utils/cacheUtils.js";
import { prisma } from "../../../config/database.js";
import { finalizeRecurringRunFromHistory } from "../../../services/recurringEditExecutionService.js";
import { finalizeAutomaticProductRuleRunFromHistory } from "../../../services/automaticProductRuleExecutionService.js";
import { storeOperationRepository } from "../../../repositories/storeOperationRepository.js";
import { storeOperationalStateRepository } from "../../../repositories/storeOperationalStateRepository.js";
import { transitionUndoRequestStatus } from "../../../services/undo/undoTransitionGuard.js";
import { operationFailureRepository } from "../../../repositories/operationFailureRepository.js";
import { operationEventRepository } from "../../../repositories/operationEventRepository.js";
import { assertOperationCircuitClosed } from "../../../services/execution/operationCircuitBreakerService.js";
import { adminGraphqlWithRetry } from "../../../utils/shopifyAdminApi.js";
import {
  BULK_EDIT_EXECUTION_STATES,
  BULK_UNDO_STATES,
  appendExecutionError,
  buildExecutionError,
  isTerminalExecutionState,
  isTerminalUndoState,
  normalizeUndoState,
} from "../../../services/bulkEditExecutionStateService.js";
import { bulkMutationFinalizerService } from "../../../services/productService/bulkMutationFinalizerService.js";
import { transitionOperation } from "../../../services/operationTransitionService.js";
import { bulkEditHistoryRepository } from "../../../repositories/bulkEditHistoryRepository.js";
import { assertEditExecutionUsesFrozenTargets } from "../../../services/execution/frozenTargetInvariantService.js";

const FINALIZER_LEASE_TTL_MS = 30_000;

async function acquireBulkOperationFinalizeLock(lockKey) {
  const rows = await prisma.$queryRaw`
    SELECT pg_try_advisory_lock(hashtext(${lockKey})) AS locked
  `;

  return Boolean(rows?.[0]?.locked);
}

async function releaseBulkOperationFinalizeLock(lockKey) {
  await prisma.$queryRaw`
    SELECT pg_advisory_unlock(hashtext(${lockKey}))
  `;
}

async function acquireOperationFinalizerLease(operationId, owner) {
  if (!operationId) return false;

  const lease = await storeOperationRepository.acquireLease(
    operationId,
    owner,
    new Date(Date.now() + FINALIZER_LEASE_TTL_MS),
  );

  return lease.count === 1;
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getHistoryOperationId(history) {
  return asObject(history?.batch).operationId || null;
}

async function transitionHistoryOperation(history, from, to, data = {}) {
  const operationId = getHistoryOperationId(history);
  if (!operationId) return;
  await transitionOperation({
    shop: history.shop,
    operationId,
    from,
    to,
    data,
  });
}

function getHistoryDispatchCorrelation(history) {
  const batch = asObject(history?.batch);
  const dispatchAttempt = Number.parseInt(batch.dispatchAttempt, 10);
  return {
    dispatchJobId:
      typeof batch.dispatchJobId === "string" && batch.dispatchJobId.trim()
        ? batch.dispatchJobId
        : null,
    dispatchAttempt: Number.isInteger(dispatchAttempt) ? dispatchAttempt : null,
  };
}

function hasValue(value) {
  return value !== undefined && value !== null;
}

function preferIncomingOrExisting(incoming, existing) {
  return hasValue(incoming) ? incoming : existing;
}

function preferNonEmptyStringOrExisting(incoming, existing) {
  if (typeof incoming === "string") {
    return incoming.trim() === "" ? existing : incoming;
  }
  return hasValue(incoming) ? incoming : existing;
}

function toNullableFloat(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toNullableInt(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isInteger(num) ? num : null;
}

function toNullableBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value == null || value === "") return null;
  return Boolean(value);
}

function normalizeCollections(entries) {
  return asArray(entries)
    .map((entry) => ({
      id: entry?.id ?? null,
      title: entry?.title ?? null,
      handle: entry?.handle ?? null,
      type:
        typeof entry?.type === "string" && entry.type.trim()
          ? entry.type.trim().toUpperCase()
          : null,
    }))
    .filter((entry) => entry.id || entry.title);
}

function mergeCollectionsJson(existing, incoming) {
  const existingEntries = normalizeCollections(existing);
  const incomingEntries = normalizeCollections(incoming);

  if (!incomingEntries.length) {
    return existingEntries.length ? existingEntries : null;
  }

  const existingByKey = new Map();
  for (const entry of existingEntries) {
    const key = entry.id || entry.title;
    if (!key) continue;
    existingByKey.set(key, entry);
  }

  return incomingEntries.map((entry) => {
    const key = entry.id || entry.title;
    const previous = key ? existingByKey.get(key) : null;
    return {
      ...entry,
      type: entry.type || previous?.type || null,
      handle: entry.handle || previous?.handle || null,
    };
  });
}

function calculateDurationMs(startedAt, completedAt = new Date()) {
  return Math.max(
    new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    0,
  );
}

function mergeProductForBulkMirror(existing, incoming) {
  return {
    shop: existing?.shop ?? incoming.shop,
    id: existing?.id ?? incoming.id,
    title: preferNonEmptyStringOrExisting(incoming.title, existing?.title ?? ""),
    handle: preferIncomingOrExisting(incoming.handle, existing?.handle ?? null),
    status: preferIncomingOrExisting(incoming.status, existing?.status ?? "ACTIVE"),
    productType: preferIncomingOrExisting(incoming.productType, existing?.productType ?? null),
    vendor: preferIncomingOrExisting(incoming.vendor, existing?.vendor ?? null),
    tags: Array.isArray(incoming.tags)
      ? incoming.tags
      : Array.isArray(existing?.tags)
        ? existing.tags
        : [],
    templateSuffix: preferIncomingOrExisting(incoming.templateSuffix, existing?.templateSuffix ?? null),
    descriptionHtml: preferIncomingOrExisting(incoming.descriptionHtml, existing?.descriptionHtml ?? null),
    descriptionText: preferIncomingOrExisting(incoming.descriptionText, existing?.descriptionText ?? null),

    createdAt: preferIncomingOrExisting(incoming.createdAt, existing?.createdAt ?? null),
    updatedAt: preferIncomingOrExisting(incoming.updatedAt, existing?.updatedAt ?? null),
    publishedAt: preferIncomingOrExisting(incoming.publishedAt, existing?.publishedAt ?? null),
    seoTitle: preferIncomingOrExisting(incoming.seoTitle, existing?.seoTitle ?? null),
    seoDescription: preferIncomingOrExisting(incoming.seoDescription, existing?.seoDescription ?? null),
    totalInventory: preferIncomingOrExisting(incoming.totalInventory, existing?.totalInventory ?? null),
    categoryId: preferIncomingOrExisting(incoming.categoryId, existing?.categoryId ?? null),
    categoryName: preferIncomingOrExisting(incoming.categoryName, existing?.categoryName ?? null),
    featuredImageUrl: preferIncomingOrExisting(incoming.featuredImageUrl, existing?.featuredImageUrl ?? null),
    featuredImageAltText: preferIncomingOrExisting(incoming.featuredImageAltText, existing?.featuredImageAltText ?? null),
    optionsJson: preferIncomingOrExisting(incoming.optionsJson, existing?.optionsJson ?? null),
    collectionsJson: mergeCollectionsJson(
      existing?.collectionsJson ?? null,
      incoming.collectionsJson,
    ),
    option1Name: preferIncomingOrExisting(incoming.option1Name, existing?.option1Name ?? null),
    option2Name: preferIncomingOrExisting(incoming.option2Name, existing?.option2Name ?? null),
    option3Name: preferIncomingOrExisting(incoming.option3Name, existing?.option3Name ?? null),
    variantCount: preferIncomingOrExisting(incoming.variantCount, existing?.variantCount ?? null),
    visibleOnlineStore: preferIncomingOrExisting(incoming.visibleOnlineStore, existing?.visibleOnlineStore ?? null),
  };
}

function toVariantNestedCreateInput(variant) {
  return {
    id: String(variant.id),
    title: variant.title ?? null,
    sku: variant.sku ?? null,
    barcode: variant.barcode ?? null,
    price: toNullableFloat(variant.price),
    compareAtPrice: toNullableFloat(variant.compareAtPrice),
    inventoryQuantity: toNullableInt(variant.inventoryQuantity),
    inventoryPolicy: variant.inventoryPolicy ?? null,
    taxable: toNullableBoolean(variant.taxable),
    taxCode: variant.taxCode ?? null,
    position: toNullableInt(variant.position),
    selectedOptionsJson: variant.selectedOptionsJson ?? null,
    cost: toNullableFloat(variant.cost),
    countryOfOrigin: variant.countryOfOrigin ?? null,
    hsTariffCode: variant.hsTariffCode ?? null,
    weight: toNullableFloat(variant.weight),
    weightUnit: variant.weightUnit ?? null,
    option1Value: variant.option1Value ?? null,
    option2Value: variant.option2Value ?? null,
    option3Value: variant.option3Value ?? null,
    physicalProduct: toNullableBoolean(variant.physicalProduct),
    profitMargin: toNullableFloat(variant.profitMargin),
    tracked: toNullableBoolean(variant.tracked),
  };
}

function toProductMirrorWriteInput(product, mirrorBatchId) {
  return {
    shop: String(product.shop),
    id: String(product.id),
    mirrorBatchId,
    title: product.title ?? "",
    handle: product.handle ?? null,
    status: product.status ?? "ACTIVE",
    productType: product.productType ?? null,
    vendor: product.vendor ?? null,
    tags: asArray(product.tags),
    templateSuffix: product.templateSuffix ?? null,
    descriptionHtml: product.descriptionHtml ?? null,
    descriptionText: product.descriptionText ?? null,
    createdAt: product.createdAt ?? null,
    updatedAt: product.updatedAt ?? null,
    publishedAt: product.publishedAt ?? null,
    seoTitle: product.seoTitle ?? null,
    seoDescription: product.seoDescription ?? null,
    totalInventory: toNullableInt(product.totalInventory),
    categoryId: product.categoryId ?? null,
    categoryName: product.categoryName ?? null,
    featuredImageUrl: product.featuredImageUrl ?? null,
    featuredImageAltText: product.featuredImageAltText ?? null,
    optionsJson: product.optionsJson ?? null,
    collectionsJson: product.collectionsJson ?? null,
    option1Name: product.option1Name ?? null,
    option2Name: product.option2Name ?? null,
    option3Name: product.option3Name ?? null,
    variantCount: toNullableInt(product.variantCount),
    visibleOnlineStore: toNullableBoolean(product.visibleOnlineStore),
  };
}

function buildBulkFailureError(history, bulkOperation, stage, message, retryable = false) {
  return appendExecutionError(
    history.error,
    buildExecutionError({
      code: bulkOperation?.errorCode || "shopify_bulk_failure",
      stage,
      message,
      retryable,
      details: {
        bulkOperationId: bulkOperation?.id || history.bulkOperationId || null,
        bulkStatus: bulkOperation?.status || null,
        partialDataUrl: bulkOperation?.partialDataUrl || null,
        objectCount: bulkOperation?.objectCount || bulkOperation?.rootObjectCount || null,
      },
    }),
  );
}

async function claimBulkEditFinalization(history) {
  const undo = normalizeUndoState(history.undo);

  if (
    history.executionState === BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY &&
    history.status === "processing"
  ) {
    const updated = await bulkEditHistoryRepository.applyProjectionUpdate({
      where: {
        id: history.id,
        shop: history.shop,
        bulkOperationId: history.bulkOperationId,
        executionState: BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY,
        status: "processing",
      },
      data: {
        executionState: BULK_EDIT_EXECUTION_STATES.FINALIZING,
      },
    });

    if (updated.count === 1) {
      await transitionHistoryOperation(
        history,
        "AWAITING_SHOPIFY",
        "APPLYING_RESULTS",
      );
    }

    return updated.count === 1 ? "edit" : null;
  }

  if (
    undo.status === "processing" &&
    undo.state === BULK_UNDO_STATES.AWAITING_SHOPIFY &&
    undo.bulkOperationId === history.bulkOperationId
  ) {
    const updated = await bulkEditHistoryRepository.applyProjectionUpdate({
      where: {
        id: history.id,
        shop: history.shop,
        bulkOperationId: history.bulkOperationId,
      },
      data: {
        undo: {
          ...undo,
          state: BULK_UNDO_STATES.FINALIZING,
        },
      },
    });

    return updated.count === 1 ? "undo" : null;
  }

  return null;
}

async function markHistoryFailure(history, bulkOperation, reason, stage, kind = "edit") {
  const undo = normalizeUndoState(history.undo);
  const completedAt = new Date();

  if (kind === "undo") {
    if (undo.executionIdentity) {
      const undoRequest = await prisma.undoRequest.findFirst({
        where: {
          shop: history.shop,
          executionId: undo.executionIdentity,
        },
        select: { id: true },
      });
      if (undoRequest?.id) {
        await prisma.undoTarget.updateMany({
          where: {
            shop: history.shop,
            undoRequestId: undoRequest.id,
            status: {
              in: ["PENDING", "SAFE", "DISPATCHED"],
            },
          },
          data: {
            status: "FAILED",
            conflictReason: "UNDO_EXECUTION_FAILED",
          },
        });
        await transitionUndoRequestStatus({
          shop: history.shop,
          undoRequestId: undoRequest.id,
          toStatus: "FAILED",
        });
      }
    }

    await bulkEditHistoryRepository.applyProjectionUpdate({
      where: {
        id: history.id,
        shop: history.shop,
      },
      data: {
        bulkOperationId: null,
        processingBatchId: null,
        undo: {
          ...undo,
          status: "failed",
          state:
            bulkOperation?.partialDataUrl ? BULK_UNDO_STATES.PARTIAL : BULK_UNDO_STATES.FAILED,
          completedAt,
          durationMs: calculateDurationMs(undo.startedAt || history.startedAt, completedAt),
          error: buildExecutionError({
            code: bulkOperation?.errorCode || "undo_bulk_failure",
            stage,
            message: reason,
            retryable: false,
            details: {
              bulkOperationId: bulkOperation?.id || history.bulkOperationId || null,
              bulkStatus: bulkOperation?.status || null,
              partialDataUrl: bulkOperation?.partialDataUrl || null,
            },
          }),
          bulkOperationId: null,
        },
      },
    });
    const operationId = getHistoryOperationId(history);
    if (operationId) {
      await storeOperationalStateRepository.markWriteFailed(history.shop, operationId);
    }
    return;
  }

  const operationId = getHistoryOperationId(history);
  const batchId = asObject(history.batch).currentBatchId || null;
  const { dispatchJobId, dispatchAttempt } = getHistoryDispatchCorrelation(history);
  if (operationId && batchId) {
    await prisma.operationMutation.updateMany({
      where: {
        shop: history.shop,
        operationId,
        batchId,
      },
      data: {
        status: "FAILED",
        shopifyBulkOperationId: bulkOperation?.id || history.bulkOperationId || null,
      },
    }).catch(() => {});

    await bulkMutationFinalizerService.markSubmissionFailed({
      shop: history.shop,
      operationId,
      batchId,
      bulkOperationId: bulkOperation?.id || history.bulkOperationId || null,
      editHistoryId: history.id,
      reason,
      dispatchJobId,
      dispatchAttempt,
    });
    if (dispatchJobId && Number.isInteger(dispatchAttempt)) {
      await bulkMutationFinalizerService.failWebhookSubmission({
        shop: history.shop,
        operationId,
        bulkOperationId: bulkOperation?.id || history.bulkOperationId || null,
        dispatchJobId,
        dispatchAttempt,
        errorCode: bulkOperation?.errorCode || "SHOPIFY_BULK_OPERATION_FAILED",
        errorMessage: reason,
      });
    }
  }

  await bulkEditHistoryRepository.applyProjectionUpdate({
    where: {
      id: history.id,
      shop: history.shop,
    },
    data: {
      status: bulkOperation?.partialDataUrl ? "partial" : "failed",
      executionState: bulkOperation?.partialDataUrl
        ? BULK_EDIT_EXECUTION_STATES.PARTIAL
        : BULK_EDIT_EXECUTION_STATES.FAILED,
      failureStage: stage,
      completedAt,
      durationMs: calculateDurationMs(history.startedAt, completedAt),
      processingBatchId: null,
      error: buildBulkFailureError(history, bulkOperation, stage, reason, false),
    },
  });

  await transitionHistoryOperation(
    history,
    "APPLYING_RESULTS",
    bulkOperation?.partialDataUrl ? "FAILED" : "FAILED",
    {
      failedAt: completedAt,
      errorCode: bulkOperation?.errorCode || "BULK_EDIT_FAILED",
      errorMessage: reason,
    },
  );

  const operationIdForFailure = getHistoryOperationId(history);
  if (operationIdForFailure) {
    const leaseOwner = `bulkEditFinalizer:${operationIdForFailure}`;
    const leaseAcquired = await acquireOperationFinalizerLease(operationIdForFailure, leaseOwner);
    if (!leaseAcquired) {
      throw new Error("Operation lease is held by another worker");
    }

    const failureCount = Number(
      bulkOperation?.objectCount || bulkOperation?.rootObjectCount || 0,
    );
    const processedCount = Number(history.processedCount || 0) + failureCount;

    if (bulkOperation?.partialDataUrl) {
      await storeOperationRepository.failPartialForLease(operationIdForFailure, leaseOwner, {
        errorCode: bulkOperation?.errorCode || "BULK_EDIT_FAILED_PARTIAL",
        errorMessage: reason,
        processedCount,
        successCount: Number(history.processedCount || 0),
        failureCount,
      });
    } else {
      await storeOperationRepository.failForLease(operationIdForFailure, leaseOwner, {
        errorCode: bulkOperation?.errorCode || "BULK_EDIT_FAILED",
        errorMessage: reason,
      });
    }

    await operationFailureRepository.create({
      shop: history.shop,
      operationId: operationIdForFailure,
      entityId: history.id,
      errorCode: bulkOperation?.errorCode || "BULK_EDIT_FAILED",
      errorMessage: reason,
    }).catch(() => {});

    await operationEventRepository.emit({
      shop: history.shop,
      operationId: operationIdForFailure,
      type: "OPERATION_FAILED",
      payload: {
        stage,
        reason,
        bulkOperationId: bulkOperation?.id || history.bulkOperationId || null,
      },
    }).catch(() => {});
    await operationEventRepository
      .emit({
        shop: history.shop,
        operationId: operationIdForFailure,
        type: bulkOperation?.partialDataUrl ? "FINALIZED_PARTIAL" : "FINALIZED_FAILED",
        payload: {
          historyId: history.id,
          stage,
          reason,
          bulkOperationId: bulkOperation?.id || history.bulkOperationId || null,
        },
      })
      .catch(() => {});

    await storeOperationalStateRepository.markWriteFailed(history.shop, operationIdForFailure);
  }
}

async function schedulePostWriteResync(shop, operationId) {
  if (!operationId) return;

  await storeOperationalStateRepository.markResyncRequired(shop, operationId);
  await addShopSyncJob(
    {
      shop,
      syncType: "product",
      reason: "post_write_resync_required",
    },
    {
      jobId: `post-write-resync:${shop}:${operationId}`,
    },
  );
}

async function markProcessingBatchStatus(batchId, status, shop = null) {
  if (!batchId) return;
  await prisma.changeRecord.updateMany({
    where: {
      batchId,
      ...(shop ? { shop } : {}),
    },
    data: { status },
  });
}

async function applyBulkMirrorUpdates(history, bulkOperation) {
  if (!bulkOperation?.url) {
    return;
  }

  const store = await prisma.store.findUnique({
    where: { shopUrl: history.shop },
    select: { activeMirrorBatchId: true },
  });
  const activeMirrorBatchId = store?.activeMirrorBatchId || null;

  let processedRecords = 0;
  for await (const records of streamBulkOperationDataChunks(
    bulkOperation.url,
    history.shop,
  )) {
    if (!records.length) continue;
    processedRecords += records.length;

    await prisma.$transaction(
      async (tx) => {
        for (const { product, variants, deletedProductId, errors } of records) {
      if (Array.isArray(errors) && errors.length > 0) {
        continue;
      }
      if (deletedProductId) {
        await tx.variant.deleteMany({
          where: {
            shop: history.shop,
            productId: deletedProductId,
            ...(activeMirrorBatchId ? { mirrorBatchId: activeMirrorBatchId } : {}),
          },
        });

        await tx.product.deleteMany({
          where: {
            shop: history.shop,
            id: deletedProductId,
            ...(activeMirrorBatchId ? { mirrorBatchId: activeMirrorBatchId } : {}),
          },
        });

        continue;
      }

      const existing = await tx.product.findFirst({
        where: {
          shop: product.shop,
          id: product.id,
          ...(activeMirrorBatchId ? { mirrorBatchId: activeMirrorBatchId } : {}),
        },
        select: {
          shop: true, id: true, title: true, handle: true, status: true,
          productType: true, vendor: true, tags: true, templateSuffix: true,
          descriptionHtml: true, descriptionText: true, createdAt: true,
          updatedAt: true, publishedAt: true, seoTitle: true, seoDescription: true,
          totalInventory: true, categoryId: true, categoryName: true,
          featuredImageUrl: true, featuredImageAltText: true, optionsJson: true,
          collectionsJson: true, option1Name: true, option2Name: true,
          option3Name: true, variantCount: true, visibleOnlineStore: true,
        },
      });

      const mergedProduct = mergeProductForBulkMirror(existing, product);
      const batchId = activeMirrorBatchId || "legacy";

      const productData = toProductMirrorWriteInput(mergedProduct, batchId);
      const productUpdateData = { ...productData };
      delete productUpdateData.shop;
      delete productUpdateData.id;
      delete productUpdateData.mirrorBatchId;

      await tx.product.upsert({
        where: {
          shop_id_mirrorBatchId: {
            shop: productData.shop,
            id: productData.id,
            mirrorBatchId: productData.mirrorBatchId,
          },
        },
        create: productData,
        update: productUpdateData,
      });

      for (const variant of variants) {
        const variantData = {
          ...toVariantNestedCreateInput(variant),
          shop: product.shop,
          productId: product.id,
          mirrorBatchId: batchId,
        };
        const variantUpdateData = { ...variantData };
        delete variantUpdateData.shop;
        delete variantUpdateData.id;
        delete variantUpdateData.mirrorBatchId;

        await tx.variant.upsert({
          where: {
            shop_id_mirrorBatchId: {
              shop: variantData.shop,
              id: variantData.id,
              mirrorBatchId: variantData.mirrorBatchId,
            },
          },
          create: variantData,
          update: variantUpdateData,
        });
      }
    }
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  }

  if (!processedRecords) {
    return;
  }

  await clearKeyCaches(`${history.shop}:ProductFetch`);
  await clearKeyCaches(`${history.shop}:productTypes:`);
}

async function finalizeEditSuccess(history) {
  await assertEditExecutionUsesFrozenTargets({
    shop: history.shop,
    historyId: history.id,
    phase: "bulk_edit_finalize_or_replay",
  });

  const session = await getSession(history.shop);
  const batch = asObject(history.batch);
  const batchTargetCount = Number(batch.currentBatchTargetCount || 0);
  const nextProcessedCount = Math.min(
    Number(history.processedCount || 0) + batchTargetCount,
    Number(history.targetSnapshotCount || Number(history.totalItems || 0)),
  );
  const hasMore = Boolean(batch.hasMore);

  await markProcessingBatchStatus(history.processingBatchId, "completed", history.shop);

  
  if (hasMore) {
    const updatedBatch = {
      ...batch,
      currentBatchId: null,
      currentBatchCount: 0,
      currentBatchTargetCount: 0,
      lastFinalizedAt: new Date().toISOString(),
    };

    await bulkEditHistoryRepository.applyProjectionUpdate({
      where: {
        id: history.id,
        shop: history.shop,
      },
      data: {
        processedCount: nextProcessedCount,
        durationMs: calculateDurationMs(history.startedAt),
        executionState: BULK_EDIT_EXECUTION_STATES.QUEUED,
        bulkOperationId: null,
        processingBatchId: null,
        batch: updatedBatch,
      },
    });

    const continuationOperationId = getHistoryOperationId(history);
    if (!continuationOperationId) {
      throw new Error("OPERATION_ID_REQUIRED_FOR_BULK_EDIT_JOB");
    }

    await addbulkEditJob({
      historyId: history.id,
      shop: history.shop,
      source: "bulk_edit_continuation",
      executionId: history.executionIdentity || history.id,
      operationId: continuationOperationId,
    });

    return { continued: true };
  }

  const completedAt = new Date();
  const { email, shopOwner } = await getShopOwnerEmailAddress(session);

  await sendEmail(
    email,
    "Your product edits are complete",
    productEditConfirmationEmailHTML(shopOwner, history.shop, history),
    true,
  );

  await bulkEditHistoryRepository.applyProjectionUpdate({
    where: {
      id: history.id,
      shop: history.shop,
    },
    data: {
      status: "completed",
      executionState: BULK_EDIT_EXECUTION_STATES.COMPLETED,
      completedAt,
      editTime: completedAt,
      processedCount: nextProcessedCount,
      durationMs: calculateDurationMs(history.startedAt, completedAt),
      processingBatchId: null,
      bulkOperationId: null,
      batch: {
        ...batch,
        lastProductId: null,
        hasMore: false,
        currentBatchId: null,
        currentBatchCount: 0,
        currentBatchTargetCount: 0,
        lastFinalizedAt: completedAt.toISOString(),
      },
    },
  });

  await transitionHistoryOperation(history, "APPLYING_RESULTS", "VERIFYING");
  await transitionHistoryOperation(history, "VERIFYING", "COMPLETED", {
    completedAt,
    processedItems: Number(nextProcessedCount || 0),
    totalItems: Number(history.totalItems || nextProcessedCount || 0),
    failedItems: 0,
  });

  const operationId = getHistoryOperationId(history);
  if (operationId) {
    const leaseOwner = `bulkEditFinalizer:${operationId}`;
    const leaseAcquired = await acquireOperationFinalizerLease(operationId, leaseOwner);
    if (!leaseAcquired) {
      throw new Error("Operation lease is held by another worker");
    }

    await storeOperationRepository.completeForLease(operationId, leaseOwner);
    await storeOperationRepository.updateById(operationId, {
      processedCount: nextProcessedCount,
      successCount: nextProcessedCount,
      failureCount: 0,
    });
    assertOperationCircuitClosed({
      processedCount: nextProcessedCount,
      failureCount: 0,
    });
    await operationEventRepository.emit({
      shop: history.shop,
      operationId,
      type: "OPERATION_COMPLETED",
      payload: {
        processedCount: nextProcessedCount,
      },
    });
    await operationEventRepository.emit({
      shop: history.shop,
      operationId,
      type: "FINALIZED_SUCCESS",
      payload: {
        historyId: history.id,
        processedCount: nextProcessedCount,
      },
    });
  }

  await finalizeRecurringRunFromHistory({
    historyId: history.id,
    status: "SUCCESS",
  });

  await finalizeAutomaticProductRuleRunFromHistory({
    historyId: history.id,
    status: "SUCCESS",
  });

  return { continued: false };
}

async function finalizeUndoSuccess(history) {
  await assertEditExecutionUsesFrozenTargets({
    shop: history.shop,
    historyId: history.id,
    phase: "bulk_undo_finalize_or_replay",
  });

  const undo = normalizeUndoState(history.undo);
  const batch = asObject(history.batch);
  const batchTargetCount = Number(batch.currentBatchTargetCount || 0);
  const nextProcessedCount = Number(undo.processedCount || 0) + batchTargetCount;
  const hasMore = Boolean(batch.hasMore);

  await markProcessingBatchStatus(history.processingBatchId, "undo completed", history.shop);

  if (hasMore) {
    await bulkEditHistoryRepository.applyProjectionUpdate({
      where: {
        id: history.id,
        shop: history.shop,
      },
      data: {
        bulkOperationId: null,
        processingBatchId: null,
        batch: {
          ...batch,
          currentBatchId: null,
          currentBatchCount: 0,
          currentBatchTargetCount: 0,
          lastUndoFinalizedAt: new Date().toISOString(),
        },
        undo: {
          ...undo,
          processedCount: nextProcessedCount,
          state: BULK_UNDO_STATES.QUEUED,
          bulkOperationId: null,
          durationMs: calculateDurationMs(undo.startedAt || history.startedAt),
        },
      },
    });

    const undoExecutionIdentity =
      undo.executionIdentity || history.executionIdentity || history.id;
    const undoRequest = await prisma.undoRequest.findFirst({
      where: {
        shop: history.shop,
        executionId: undoExecutionIdentity,
      },
      select: { id: true },
    });
    const undoPlan = undoRequest
      ? await prisma.undoExecutionPlan.findFirst({
          where: {
            shop: history.shop,
            undoRequestId: undoRequest.id,
          },
          select: { id: true },
        })
      : null;
    if (!undoPlan?.id) {
      throw new Error("UNDO_EXECUTION_PLAN_NOT_FOUND");
    }

    await addBulkUndoJob({
      shop: history.shop,
      undoRequestId: undoRequest.id,
      undoExecutionPlanId: undoPlan.id,
    });

    return { continued: true };
  }

  const completedAt = new Date();
  await bulkEditHistoryRepository.applyProjectionUpdate({
    where: {
      id: history.id,
      shop: history.shop,
    },
    data: {
      bulkOperationId: null,
      processingBatchId: null,
      batch: {
        ...batch,
        lastProductId: null,
        hasMore: false,
        currentBatchId: null,
        currentBatchCount: 0,
        currentBatchTargetCount: 0,
        lastUndoFinalizedAt: completedAt.toISOString(),
      },
      undo: {
        ...undo,
        status: "completed",
        state: BULK_UNDO_STATES.COMPLETED,
        allowed: false,
        completedAt,
        processedCount: nextProcessedCount,
        durationMs: calculateDurationMs(undo.startedAt || history.startedAt, completedAt),
        bulkOperationId: null,
      },
    },
  });

  await clearKeyCaches(`${history.shop}:historyChanges:${history.id}`);
  const operationId = getHistoryOperationId(history);
  if (operationId) {
    await operationEventRepository
      .emit({
        shop: history.shop,
        operationId,
        type: "UNDO_AVAILABLE",
        payload: {
          historyId: history.id,
          undoState: BULK_UNDO_STATES.COMPLETED,
        },
      })
      .catch(() => {});
  }
  return { continued: false };
}

export async function handleProductEditOperation({ bulkOperationId, shop = null }) {
  const finalizeLockKey = `bulk-operation-finalize:${bulkOperationId}`;
  const locked = await acquireBulkOperationFinalizeLock(finalizeLockKey);
  if (!locked) {
    return { success: true, skipped: true, reason: "finalizer_locked" };
  }

  try {
    const history = await prisma.editHistory.findFirst({
      where: {
        bulkOperationId,
        ...(shop ? { shop } : {}),
      },
    });

    if (!history) {
      return { success: false, reason: "history_not_found" };
    }

    const claimKind = await claimBulkEditFinalization(history);
    if (!claimKind) {
      const undo = normalizeUndoState(history.undo);
      if (
        isTerminalExecutionState(history.executionState) &&
        (!undo.state || isTerminalUndoState(undo.state))
      ) {
        return { success: true, skipped: true, reason: "already_finalized" };
      }

      return { success: true, skipped: true, reason: "not_claimable" };
    }

    const operationIdForState = getHistoryOperationId(history);
    if (operationIdForState) {
      await storeOperationalStateRepository.markFinalizing(
        history.shop,
        operationIdForState,
      );
    }

    const session = await getSession(history.shop);
    const bulkOperation = await fetchBulkOperationDetails(session, bulkOperationId);
    const bulkStatus = bulkOperation?.status || null;
    const operationId = getHistoryOperationId(history);
    const activeBatchId = asObject(history.batch).currentBatchId || null;
    const { dispatchJobId, dispatchAttempt } = getHistoryDispatchCorrelation(history);

    if (claimKind === "edit" && operationId && activeBatchId) {
      await bulkMutationFinalizerService.ensureBulkEditSubmissionCorrelation({
        shop: history.shop,
        operationId,
        batchId: activeBatchId,
        bulkOperationId: bulkOperation?.id || history.bulkOperationId || null,
        editHistoryId: history.id,
        dispatchJobId,
        dispatchAttempt,
      });
    }

    if (
      bulkStatus &&
      !["COMPLETED", "FAILED", "CANCELED", "CANCELING"].includes(bulkStatus)
    ) {
      return { success: true, skipped: true, reason: "bulk_operation_not_completed" };
    }

    if (claimKind === "edit" && operationId && dispatchJobId && Number.isInteger(dispatchAttempt)) {
      await bulkMutationFinalizerService.claimWebhookAwaitingSubmission({
        shop: history.shop,
        operationId,
        bulkOperationId: bulkOperation?.id || history.bulkOperationId || null,
        dispatchJobId,
        dispatchAttempt,
      });
    }

    const hasFailure =
      bulkOperation?.errorCode ||
      ["FAILED", "CANCELED", "CANCELING"].includes(bulkOperation?.status);

    if (hasFailure) {
      if (claimKind === "undo") {
        const undo = normalizeUndoState(history.undo);
        if (undo.executionIdentity) {
          await prisma.operationMutation.updateMany({
            where: {
              shop: history.shop,
              operationId: undo.executionIdentity,
            },
            data: {
              status: "FAILED",
              shopifyBulkOperationId: bulkOperation?.id || history.bulkOperationId || null,
            },
          }).catch(() => {});
        }
      }

      await markProcessingBatchStatus(
        history.processingBatchId,
        "failed",
        history.shop,
      );

      await markHistoryFailure(
        history,
        bulkOperation,
        "Shopify bulk operation failed",
        claimKind === "undo" ? "undo_bulk_mutation" : "shopify_bulk_mutation",
        claimKind,
      );

      if (claimKind === "edit") {
        await finalizeRecurringRunFromHistory({
          historyId: history.id,
          status: "FAILED",
          errorMessage: "Shopify bulk operation failed",
        });

        await finalizeAutomaticProductRuleRunFromHistory({
          historyId: history.id,
          status: "FAILED",
          errorMessage: "Shopify bulk operation failed",
        });
      }

      await clearKeyCaches(`${history.shop}:historyDetails:${history.id}`);
      return { success: false, reason: "bulk_operation_failed" };
    }

    const outcome = await bulkMutationFinalizerService.collectOutcome({
      resultUrl: bulkOperation?.url,
      partialDataUrl: bulkOperation?.partialDataUrl,
    });
    const expectedCount = Number(
      bulkOperation?.objectCount || bulkOperation?.rootObjectCount || 0,
    );
    const hasResultEvidence = Number(outcome.totalLines || 0) > 0;
    if (!hasResultEvidence && expectedCount > 0) {
      await markHistoryFailure(
        history,
        {
          ...bulkOperation,
          partialDataUrl: bulkOperation?.partialDataUrl || "result_evidence_missing",
        },
        "Shopify reported completion but no result lines were available",
        claimKind === "undo"
          ? "undo_bulk_mutation_result_missing"
          : "shopify_bulk_mutation_result_missing",
        claimKind,
      );

      if (claimKind === "edit") {
        await finalizeRecurringRunFromHistory({
          historyId: history.id,
          status: "FAILED",
          errorMessage: "Shopify completion missing result evidence",
        });

        await finalizeAutomaticProductRuleRunFromHistory({
          historyId: history.id,
          status: "FAILED",
          errorMessage: "Shopify completion missing result evidence",
        });
      }

      await clearKeyCaches(`${history.shop}:historyDetails:${history.id}`);
      return { success: false, reason: "bulk_operation_result_missing" };
    }
    const failedLineCount = Number(outcome.failedLines || 0);
    if (failedLineCount > 0) {
      if (claimKind === "edit") {
        const opId = getHistoryOperationId(history);
        if (opId && activeBatchId) {
          await bulkMutationFinalizerService.reconcileBulkEdit({
            shop: history.shop,
            operationId: opId,
            batchId: activeBatchId,
            bulkOperationId: bulkOperation?.id || history.bulkOperationId || null,
            editHistoryId: history.id,
            outcome,
            dispatchJobId,
            dispatchAttempt,
          });
        }
      } else {
        const undo = normalizeUndoState(history.undo);
        if (undo.executionIdentity) {
          await bulkMutationFinalizerService.reconcileBulkUndo({
            shop: history.shop,
            operationId: undo.executionIdentity,
            bulkOperationId: bulkOperation?.id || history.bulkOperationId || null,
            outcome,
          });
        }
      }

      await markProcessingBatchStatus(history.processingBatchId, "partial", history.shop);

      await markHistoryFailure(
        history,
        {
          ...bulkOperation,
          partialDataUrl: bulkOperation?.partialDataUrl || "line_failures_present",
        },
        "Shopify bulk operation completed with line-level failures",
        claimKind === "undo" ? "undo_bulk_mutation_result_parse" : "shopify_bulk_mutation_result_parse",
        claimKind,
      );

      if (claimKind === "edit") {
        await finalizeRecurringRunFromHistory({
          historyId: history.id,
          status: "FAILED",
          errorMessage: "Shopify bulk operation completed with line-level failures",
        });

        await finalizeAutomaticProductRuleRunFromHistory({
          historyId: history.id,
          status: "FAILED",
          errorMessage: "Shopify bulk operation completed with line-level failures",
        });
      }

      await clearKeyCaches(`${history.shop}:historyDetails:${history.id}`);
      return { success: false, reason: "bulk_operation_partial_line_failures" };
    }

    if (claimKind === "edit") {
      const opId = getHistoryOperationId(history);
      if (opId && activeBatchId) {
        await bulkMutationFinalizerService.reconcileBulkEdit({
          shop: history.shop,
          operationId: opId,
          batchId: activeBatchId,
          bulkOperationId: bulkOperation?.id || history.bulkOperationId || null,
          editHistoryId: history.id,
          outcome,
          dispatchJobId,
          dispatchAttempt,
        });
      }
    } else {
      const undo = normalizeUndoState(history.undo);
      if (undo.executionIdentity) {
        await bulkMutationFinalizerService.reconcileBulkUndo({
          shop: history.shop,
          operationId: undo.executionIdentity,
          bulkOperationId: bulkOperation?.id || history.bulkOperationId || null,
          outcome,
        });
      }
    }

    if (claimKind === "edit") {
      const result = await finalizeEditSuccess(history);
      if (!result.continued) {
        await schedulePostWriteResync(history.shop, getHistoryOperationId(history));
      }
      if (operationId && dispatchJobId && Number.isInteger(dispatchAttempt)) {
        await bulkMutationFinalizerService.completeWebhookSubmission({
          shop: history.shop,
          operationId,
          bulkOperationId: bulkOperation?.id || history.bulkOperationId || null,
          dispatchJobId,
          dispatchAttempt,
          resultUrl: bulkOperation?.url || null,
        });
      }
      await clearKeyCaches(`${history.shop}:historyDetails:${history.id}`);
      return { success: true, continued: result.continued, kind: "edit" };
    }

    const result = await finalizeUndoSuccess(history);
    if (!result.continued) {
      await schedulePostWriteResync(history.shop, getHistoryOperationId(history));
    }
    await clearKeyCaches(`${history.shop}:historyDetails:${history.id}`);
    return { success: true, continued: result.continued, kind: "undo" };
  } finally {
    await releaseBulkOperationFinalizeLock(finalizeLockKey).catch(() => { });
  }
}

function parseBulkOperationLine(line, shop) {
  const parsed = JSON.parse(line);
  const lineErrors = [];
  const topLevelErrors = asArray(parsed?.errors);
  if (topLevelErrors.length) {
    lineErrors.push(...topLevelErrors.map((item) => item?.message || "graphql_error"));
  }

  const deletedProductId = parsed?.data?.productDelete?.deletedProductId;
  const deleteUserErrors = asArray(parsed?.data?.productDelete?.userErrors);
  if (deleteUserErrors.length) {
    lineErrors.push(
      ...deleteUserErrors.map((item) => item?.message || "product_delete_user_error"),
    );
  }
  if (deletedProductId) {
    return {
      deletedProductId,
      product: null,
      variants: [],
      errors: lineErrors,
    };
  }

  const product = parsed?.data?.productSet?.product;
  const setUserErrors = asArray(parsed?.data?.productSet?.userErrors);
  const opUserErrors = asArray(parsed?.data?.productSet?.productSetOperation?.userErrors);
  if (setUserErrors.length) {
    lineErrors.push(...setUserErrors.map((item) => item?.message || "product_set_user_error"));
  }
  if (opUserErrors.length) {
    lineErrors.push(
      ...opUserErrors.map((item) => item?.message || "product_set_operation_user_error"),
    );
  }
  if (!product?.id) return null;

  const variants = asArray(product?.variants?.edges)
    .map((edge) => edge?.node)
    .filter((node) => node?.id)
    .map((node) => ({
      id: node.id,
      title: node.title ?? null,
      sku: node.sku ?? null,
      barcode: node.barcode ?? null,
      price: node.price != null ? Number(node.price) : null,
      compareAtPrice: node.compareAtPrice != null ? Number(node.compareAtPrice) : null,
      inventoryQuantity: node.inventoryQuantity != null ? Number(node.inventoryQuantity) : null,
      inventoryPolicy: node.inventoryPolicy ?? null,
      taxable: node.taxable ?? null,
      taxCode: node.taxCode ?? null,
      position: node.position != null ? Number(node.position) : null,
      selectedOptionsJson: node.selectedOptions ?? null,
      cost: node.inventoryItem?.unitCost?.amount != null
        ? Number(node.inventoryItem.unitCost.amount) : null,
      countryOfOrigin: node.inventoryItem?.countryCodeOfOrigin ?? null,
      hsTariffCode: node.inventoryItem?.harmonizedSystemCode ?? null,
      weight: node.inventoryItem?.measurement?.weight?.value != null
        ? Number(node.inventoryItem.measurement.weight.value) : null,
      weightUnit: node.inventoryItem?.measurement?.weight?.unit ?? null,
      option1Value: node.selectedOptions?.[0]?.value ?? null,
      option2Value: node.selectedOptions?.[1]?.value ?? null,
      option3Value: node.selectedOptions?.[2]?.value ?? null,
      physicalProduct: node.inventoryItem?.requiresShipping ?? null,
      tracked: node.inventoryItem?.tracked ?? null,
      profitMargin: null,
    }));

  return {
    product: {
      shop,
      id: product.id,
      title: product.title ?? null,
      handle: product.handle ?? null,
      status: product.status ?? "ACTIVE",
      productType: product.productType ?? null,
      vendor: product.vendor ?? null,
      templateSuffix: product.templateSuffix ?? null,
      descriptionHtml: product.descriptionHtml ?? null,
      descriptionText: product.descriptionHtml
        ? product.descriptionHtml.replace(/<[^>]*>/g, " ").replace(/\s{2,}/g, " ").trim() || null
        : null,
      createdAt: product.createdAt ? new Date(product.createdAt) : null,
      updatedAt: product.updatedAt ? new Date(product.updatedAt) : null,
      publishedAt: product.publishedAt ? new Date(product.publishedAt) : null,
      tags: Array.isArray(product.tags) ? product.tags : [],
      categoryId: product.category?.id ?? null,
      categoryName: product.category?.name ?? null,
      seoTitle: product.seo?.title ?? null,
      seoDescription: product.seo?.description ?? null,
      totalInventory: product.totalInventory != null ? Number(product.totalInventory) : null,
      featuredImageUrl: product.featuredImage?.url ?? null,
      featuredImageAltText: product.featuredImage?.altText ?? null,
      optionsJson: product.options ?? null,
      collectionsJson: asArray(product?.collections?.edges).map(({ node }) => ({
        id: node?.id ?? null,
        title: node?.title ?? null,
        handle: node?.handle ?? null,
        type: node?.ruleSet ? "SMART" : null,
      })),
      option1Name: product.options?.[0]?.name ?? null,
      option2Name: product.options?.[1]?.name ?? null,
      option3Name: product.options?.[2]?.name ?? null,
      variantCount: variants.length,
      visibleOnlineStore: null,
    },
    variants,
    errors: lineErrors,
  };
}

async function summarizeBulkOperationResult(url, shop) {
  const summary = {
    totalLines: 0,
    successLines: 0,
    failedLines: 0,
    userErrors: 0,
    missingProducts: 0,
  };

  if (!url) return summary;

  for await (const records of streamBulkOperationDataChunks(url, shop)) {
    for (const record of records) {
      summary.totalLines += 1;
      const hasEntity = Boolean(record?.deletedProductId || record?.product?.id);
      const errorCount = Array.isArray(record?.errors) ? record.errors.length : 0;

      if (!hasEntity) {
        summary.missingProducts += 1;
        summary.failedLines += 1;
        continue;
      }

      if (errorCount > 0) {
        summary.userErrors += errorCount;
        summary.failedLines += 1;
        continue;
      }

      summary.successLines += 1;
    }
  }

  return summary;
}

export async function* streamBulkOperationDataChunks(url, shop, chunkSize = 100) {
  const response = await axios.get(url, {
    responseType: "stream",
    timeout: 120000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  const reader = createInterface({
    input: response.data,
    crlfDelay: Infinity,
  });
  let chunk = [];

  for await (const line of reader) {
    if (!line) continue;

    try {
      const record = parseBulkOperationLine(line, shop);
      if (!record) continue;

      chunk.push(record);
      if (chunk.length >= chunkSize) {
        yield chunk;
        chunk = [];
      }
    } catch (_error) {
      // skip malformed lines
    }
  }

  if (chunk.length) {
    yield chunk;
  }
}

async function processNextEdit(shop) {
  const nextEdit = await prisma.editHistory.findFirst({
    where: {
      shop,
      status: { in: ["pending", "Undo pending"] },
    },
    orderBy: { updatedAt: "asc" },
    select: {
      id: true,
      shop: true,
      status: true,
      executionIdentity: true,
      undo: true,
      batch: true,
    },
  });

  if (!nextEdit) return;

  if (nextEdit.status === "Undo pending") {
    const undo = normalizeUndoState(nextEdit.undo);
    const undoExecutionIdentity =
      undo.executionIdentity || nextEdit.executionIdentity || nextEdit.id;
    const undoRequest = await prisma.undoRequest.findFirst({
      where: {
        shop: nextEdit.shop,
        executionId: undoExecutionIdentity,
      },
      select: { id: true },
    });
    const undoPlan = undoRequest
      ? await prisma.undoExecutionPlan.findFirst({
          where: {
            shop: nextEdit.shop,
            undoRequestId: undoRequest.id,
          },
          select: { id: true },
        })
      : null;
    if (!undoPlan?.id) {
      throw new Error("UNDO_EXECUTION_PLAN_NOT_FOUND");
    }

    await addBulkUndoJob({
      shop: nextEdit.shop,
      undoRequestId: undoRequest.id,
      undoExecutionPlanId: undoPlan.id,
    });
    return;
  }

  const followupOperationId = asObject(nextEdit.batch).operationId || null;
  if (!followupOperationId) {
    throw new Error("OPERATION_ID_REQUIRED_FOR_BULK_EDIT_JOB");
  }

  await addbulkEditJob({
    historyId: nextEdit.id,
    shop: nextEdit.shop,
    source: "bulk_edit_followup",
    executionId: nextEdit.executionIdentity || nextEdit.id,
    operationId: followupOperationId,
  });
}

async function fetchBulkOperationDetails(session, bulkOperationId) {
  const query = `query GetBulkOperationResults($id: ID!) {
    node(id: $id) {
      ... on BulkOperation {
        id
        status
        errorCode
        url
        partialDataUrl
        objectCount
        rootObjectCount
        completedAt
        createdAt
        fileSize
        type
      }
    }
  }`;

  const response = await adminGraphqlWithRetry({
    session,
    shop: session?.shop,
    operationName: "bulkOperationMutationStatus",
    data: {
      query,
      variables: { id: bulkOperationId },
    },
  });

  return response.body?.data?.node ?? null;
}

export { processNextEdit };
