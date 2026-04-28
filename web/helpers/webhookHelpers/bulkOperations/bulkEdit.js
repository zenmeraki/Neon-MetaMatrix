import axios from "axios";
import {
  getSession,
  getShopOwnerEmailAddress,
} from "../../../utils/sessionHandler.js";
import { productEditConfirmationEmailHTML } from "../../../Config/templates/productEditConfirmationTemplate.js";
import { sendEmail } from "../../../utils/emailHelper.js";
import { addBulkUndoJob } from "../../../Jobs/Queues/bulkUndoJob.js";
import { addbulkEditJob } from "../../../Jobs/Queues/bulkEditJob.js";
import { clearKeyCaches } from "../../../utils/cacheUtils.js";
import { prisma } from "../../../config/database.js";
import { finalizeRecurringRunFromHistory } from "../../../services/recurringEditExecutionService.js";
import { finalizeAutomaticProductRuleRunFromHistory } from "../../../services/automaticProductRuleExecutionService.js";
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

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
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
    collectionsJson: preferIncomingOrExisting(incoming.collectionsJson, existing?.collectionsJson ?? null),
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

function toProductCreateInput(product, variants, mirrorBatchId = "legacy") {
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
    variants: {
      create: asArray(variants).map((variant) => toVariantNestedCreateInput(variant)),
    },
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
    const updated = await prisma.editHistory.updateMany({
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

    return updated.count === 1 ? "edit" : null;
  }

  if (
    undo.status === "processing" &&
    undo.state === BULK_UNDO_STATES.AWAITING_SHOPIFY &&
    undo.bulkOperationId === history.bulkOperationId
  ) {
    const updated = await prisma.editHistory.updateMany({
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
    await prisma.editHistory.update({
      where: { id: history.id },
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
    return;
  }

  await prisma.editHistory.update({
    where: { id: history.id },
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
}

async function markProcessingBatchStatus(batchId, status) {
  if (!batchId) return;
  await prisma.changeRecord.updateMany({
    where: { batchId },
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

  const records = await fetchBulkOperationData(bulkOperation.url, history.shop);
  if (!records.length) {
    return;
  }

await prisma.$transaction(
  async (tx) => {
    for (const { product, variants } of records) {
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

      await tx.variant.deleteMany({
        where: {
          shop: product.shop,
          productId: product.id,
          ...(activeMirrorBatchId ? { mirrorBatchId: activeMirrorBatchId } : {}),
        },
      });

      await tx.product.deleteMany({
        where: {
          shop: product.shop,
          id: product.id,
          ...(activeMirrorBatchId ? { mirrorBatchId: activeMirrorBatchId } : {}),
        },
      });

      // Create product WITHOUT nested variants
      await tx.product.create({
        data: {
          shop: String(mergedProduct.shop),
          id: String(mergedProduct.id),
          mirrorBatchId: batchId,
          title: mergedProduct.title ?? "",
          handle: mergedProduct.handle ?? null,
          status: mergedProduct.status ?? "ACTIVE",
          productType: mergedProduct.productType ?? null,
          vendor: mergedProduct.vendor ?? null,
          tags: asArray(mergedProduct.tags),
          templateSuffix: mergedProduct.templateSuffix ?? null,
          descriptionHtml: mergedProduct.descriptionHtml ?? null,
          descriptionText: mergedProduct.descriptionText ?? null,
          createdAt: mergedProduct.createdAt ?? null,
          updatedAt: mergedProduct.updatedAt ?? null,
          publishedAt: mergedProduct.publishedAt ?? null,
          seoTitle: mergedProduct.seoTitle ?? null,
          seoDescription: mergedProduct.seoDescription ?? null,
          totalInventory: toNullableInt(mergedProduct.totalInventory),
          categoryId: mergedProduct.categoryId ?? null,
          categoryName: mergedProduct.categoryName ?? null,
          featuredImageUrl: mergedProduct.featuredImageUrl ?? null,
          featuredImageAltText: mergedProduct.featuredImageAltText ?? null,
          optionsJson: mergedProduct.optionsJson ?? null,
          collectionsJson: mergedProduct.collectionsJson ?? null,
          option1Name: mergedProduct.option1Name ?? null,
          option2Name: mergedProduct.option2Name ?? null,
          option3Name: mergedProduct.option3Name ?? null,
          variantCount: toNullableInt(mergedProduct.variantCount),
          visibleOnlineStore: toNullableBoolean(mergedProduct.visibleOnlineStore),
        },
      });

      // Create variants separately with all required fields
      if (variants.length > 0) {
        await tx.variant.createMany({
          data: variants.map((v) => ({
            ...toVariantNestedCreateInput(v),
            shop: product.shop,
            productId: product.id,
            mirrorBatchId: batchId,
          })),
          skipDuplicates: true,
        });
      }
    }
  },
  { maxWait: 10_000, timeout: 60_000 },
);

  await clearKeyCaches(`${history.shop}:ProductFetch`);
  await clearKeyCaches(`${history.shop}:productTypes:`);
}

async function finalizeEditSuccess(history) {
  const session = await getSession(history.shop);
  const batch = asObject(history.batch);
  const batchTargetCount = Number(batch.currentBatchTargetCount || 0);
  const nextProcessedCount = Math.min(
    Number(history.processedCount || 0) + batchTargetCount,
    Number(history.targetSnapshotCount || Number(history.totalItems || 0)),
  );
  const hasMore = Boolean(batch.hasMore);

  await markProcessingBatchStatus(history.processingBatchId, "completed");

  
  if (hasMore) {
    const updatedBatch = {
      ...batch,
      currentBatchId: null,
      currentBatchCount: 0,
      currentBatchTargetCount: 0,
      lastFinalizedAt: new Date().toISOString(),
    };

    await prisma.editHistory.update({
      where: { id: history.id },
      data: {
        processedCount: nextProcessedCount,
        durationMs: calculateDurationMs(history.startedAt),
        executionState: BULK_EDIT_EXECUTION_STATES.QUEUED,
        bulkOperationId: null,
        processingBatchId: null,
        batch: updatedBatch,
      },
    });

    await addbulkEditJob({
      historyId: history.id,
      shop: history.shop,
      source: "bulk_edit_continuation",
      executionId: history.executionIdentity || history.id,
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

  await prisma.editHistory.update({
    where: { id: history.id },
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
  const undo = normalizeUndoState(history.undo);
  const batch = asObject(history.batch);
  const batchTargetCount = Number(batch.currentBatchTargetCount || 0);
  const nextProcessedCount = Number(undo.processedCount || 0) + batchTargetCount;
  const hasMore = Boolean(batch.hasMore);

  await markProcessingBatchStatus(history.processingBatchId, "undo completed");

  if (hasMore) {
    await prisma.editHistory.update({
      where: { id: history.id },
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

    await addBulkUndoJob({
      historyId: history.id,
      shop: history.shop,
      source: "bulk_undo_continuation",
      executionId: undo.executionIdentity || history.executionIdentity || history.id,
    });

    return { continued: true };
  }

  const completedAt = new Date();
  await prisma.editHistory.update({
    where: { id: history.id },
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

    const session = await getSession(history.shop);
    const bulkOperation = await fetchBulkOperationDetails(session, bulkOperationId);
    const hasFailure =
      bulkOperation?.errorCode ||
      ["FAILED", "CANCELED", "CANCELING"].includes(bulkOperation?.status);

    if (hasFailure || bulkOperation?.partialDataUrl) {
      await markProcessingBatchStatus(
        history.processingBatchId,
        bulkOperation?.partialDataUrl ? "partial" : "failed",
      );

      await markHistoryFailure(
        history,
        bulkOperation,
        bulkOperation?.partialDataUrl
          ? "Shopify bulk operation completed with partial failures"
          : "Shopify bulk operation failed",
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

    await applyBulkMirrorUpdates(history, bulkOperation);

    if (claimKind === "edit") {
      const result = await finalizeEditSuccess(history);
      await clearKeyCaches(`${history.shop}:historyDetails:${history.id}`);
      return { success: true, continued: result.continued, kind: "edit" };
    }

    const result = await finalizeUndoSuccess(history);
    await clearKeyCaches(`${history.shop}:historyDetails:${history.id}`);
    return { success: true, continued: result.continued, kind: "undo" };
  } finally {
    await releaseBulkOperationFinalizeLock(finalizeLockKey).catch(() => { });
  }
}

export async function fetchBulkOperationData(url, shop) {
  const response = await axios.get(url, {
    responseType: "text",
    timeout: 120000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  const operations = [];
  const lines = response.data.split("\n").filter(Boolean);

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      const product = parsed?.data?.productSet?.product;
      if (!product?.id) continue;

      // Extract nested variants from edges
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

      operations.push({
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
          })),
          option1Name: product.options?.[0]?.name ?? null,
          option2Name: product.options?.[1]?.name ?? null,
          option3Name: product.options?.[2]?.name ?? null,
          variantCount: variants.length,
          visibleOnlineStore: null,
        },
        variants,
      });
    } catch (_error) {
      // skip malformed lines
    }
  }

  return operations;
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
    },
  });

  if (!nextEdit) return;

  if (nextEdit.status === "Undo pending") {
    const undo = normalizeUndoState(nextEdit.undo);
    await addBulkUndoJob({
      historyId: nextEdit.id,
      shop: nextEdit.shop,
      source: "bulk_edit_followup_undo",
      executionId: undo.executionIdentity || nextEdit.executionIdentity || nextEdit.id,
    });
    return;
  }

  await addbulkEditJob({
    historyId: nextEdit.id,
    shop: nextEdit.shop,
    source: "bulk_edit_followup",
    executionId: nextEdit.executionIdentity || nextEdit.id,
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
