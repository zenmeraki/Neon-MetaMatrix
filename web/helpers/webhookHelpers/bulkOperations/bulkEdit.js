import axios from "axios";
import {
  getSession,
  getShopOwnerEmailAddress,
} from "../../../utils/sessionHandler.js";
import { productEditConfirmationEmailHTML } from "../../../Config/templates/productEditConfirmationTemplate.js";
import { sendEmail } from "../../../utils/emailHelper.js";
import { addbulkUndoJob } from "../../../Jobs/Queues/bulkUndoJob.js";
import { addbulkEditJob } from "../../../Jobs/Queues/bulkEditJob.js";
import { clearKeyCaches } from "../../../utils/cacheUtils.js";
import { prisma } from "../../../Config/database.js";
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
import * as bulkMutationExecutionService from "../../../services/execution/bulkMutationExecutionService.js";

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
    catalogBatchId: existing?.catalogBatchId ?? incoming.catalogBatchId ?? null,
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
    description: preferIncomingOrExisting(incoming.description, existing?.description ?? null),
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

function toVariantNestedCreateInput(variant, catalogBatchId = null) {
  const price = toNullableFloat(variant.price);
  const compareAtPrice = toNullableFloat(variant.compareAtPrice);
  const cost = toNullableFloat(variant.cost);
  const weight = toNullableFloat(variant.weight);
  const profitMargin = toNullableFloat(variant.profitMargin);

  return {
    id: String(variant.id),
    catalogBatchId,
    title: variant.title ?? null,
    sku: variant.sku ?? null,
    barcode: variant.barcode ?? null,
    price,
    priceDecimal: price,
    compareAtPrice,
    compareAtPriceDecimal: compareAtPrice,
    inventoryQuantity: toNullableInt(variant.inventoryQuantity),
    inventoryPolicy: variant.inventoryPolicy ?? null,
    taxable: toNullableBoolean(variant.taxable),
    taxCode: variant.taxCode ?? null,
    position: toNullableInt(variant.position),
    selectedOptionsJson: variant.selectedOptionsJson ?? null,
    cost,
    costDecimal: cost,
    countryOfOrigin: variant.countryOfOrigin ?? null,
    hsTariffCode: variant.hsTariffCode ?? null,
    weight,
    weightDecimal: weight,
    weightUnit: variant.weightUnit ?? null,
    option1Value: variant.option1Value ?? null,
    option2Value: variant.option2Value ?? null,
    option3Value: variant.option3Value ?? null,
    physicalProduct: toNullableBoolean(variant.physicalProduct),
    profitMargin,
    profitMarginDecimal: profitMargin,
    tracked: toNullableBoolean(variant.tracked),
  };
}

function toProductCreateInput(product, variants, mirrorBatchId = "legacy") {
  const catalogBatchId = product.catalogBatchId || mirrorBatchId;

  return {
    shop: String(product.shop),
    id: String(product.id),
    mirrorBatchId,
    catalogBatchId,
    title: product.title ?? "",
    handle: product.handle ?? null,
    status: product.status ?? "ACTIVE",
    productType: product.productType ?? null,
    vendor: product.vendor ?? null,
    tags: asArray(product.tags),
    templateSuffix: product.templateSuffix ?? null,
    description: product.description ?? null,
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
      create: asArray(variants).map((variant) =>
        toVariantNestedCreateInput(variant, catalogBatchId),
      ),
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
    const nextUndo = {
      ...undo,
      state: BULK_UNDO_STATES.FINALIZING,
    };

    const updated = await prisma.$executeRaw`
      UPDATE "EditHistory"
      SET "undo" = ${JSON.stringify(nextUndo)}::jsonb
      WHERE "id" = ${history.id}
        AND "shop" = ${history.shop}
        AND "bulkOperationId" = ${history.bulkOperationId}
        AND "undo"->>'status' = 'processing'
        AND "undo"->>'state' = ${BULK_UNDO_STATES.AWAITING_SHOPIFY}
        AND "undo"->>'bulkOperationId' = ${history.bulkOperationId}
    `;

    return Number(updated) === 1 ? "undo" : null;
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
    where: {
      batchId,
      ...(status === "completed" || status === "undo completed"
        ? { status: { in: ["pending", "SUCCEEDED", "PARTIAL"] } }
        : {}),
    },
    data: { status },
  });
}

async function applyOutcomeStatusesToChangeRecords({ history, outcomes }) {
  if (!history?.processingBatchId || !Array.isArray(outcomes) || !outcomes.length) {
    return;
  }

  for (const outcome of outcomes) {
    const productId = outcome.productId || outcome.targetId || null;
    if (!productId) {
      continue;
    }

    const status = outcome.status === "SUCCESS" ? "SUCCEEDED" : "FAILED";

    await prisma.changeRecord.updateMany({
      where: {
        editHistoryId: history.id,
        shop: history.shop,
        batchId: history.processingBatchId,
        productId,
      },
      data: { status },
    });
  }
}

async function applyBulkMirrorUpdates(history, bulkOperation) {
  if (!bulkOperation?.url) {
    return;
  }

  const targetMirrorBatchId = history.targetMirrorBatchId;
  if (!targetMirrorBatchId) {
    throw new Error("Bulk edit mirror finalization requires targetMirrorBatchId");
  }

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
            mirrorBatchId: targetMirrorBatchId,
          },
          select: {
            shop: true,
            id: true,
            catalogBatchId: true,
            title: true,
            handle: true,
            status: true,
            productType: true,
            vendor: true,
            tags: true,
            templateSuffix: true,
            description: true,
            createdAt: true,
            updatedAt: true,
            publishedAt: true,
            seoTitle: true,
            seoDescription: true,
            totalInventory: true,
            categoryId: true,
            categoryName: true,
            featuredImageUrl: true,
            featuredImageAltText: true,
            optionsJson: true,
            collectionsJson: true,
            option1Name: true,
            option2Name: true,
            option3Name: true,
            variantCount: true,
            visibleOnlineStore: true,
          },
        });

        const mergedProduct = mergeProductForBulkMirror(existing, product);

        await tx.variant.deleteMany({
          where: {
            shop: product.shop,
            productId: product.id,
            mirrorBatchId: targetMirrorBatchId,
          },
        });

        await tx.product.deleteMany({
          where: {
            shop: product.shop,
            id: product.id,
            mirrorBatchId: targetMirrorBatchId,
          },
        });

        await tx.product.create({
          data: toProductCreateInput(
            mergedProduct,
            variants,
            targetMirrorBatchId,
          ),
        });
      }
    },
    { maxWait: 10_000, timeout: 60_000 },
  );

  await clearKeyCaches(`${history.shop}:ProductFetch`);
  await clearKeyCaches(`${history.shop}:productTypes:`);
}

function extractProductSetUserErrors(parsed) {
  const productSet = parsed?.data?.productSet;

  return [
    ...asArray(productSet?.userErrors),
    ...asArray(productSet?.productSetOperation?.userErrors),
  ].filter((error) => error?.message || error?.code);
}

function fieldPathToString(field) {
  if (Array.isArray(field)) {
    return field.map((part) => String(part)).join(".");
  }

  return typeof field === "string" ? field : "";
}

function extractVariantIndexFromError(error) {
  const path = fieldPathToString(error?.field);
  const match = path.match(/(?:^|\.|>)variants(?:\.|>|\[)(\d+)/i);

  if (!match) {
    return null;
  }

  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function buildVariantIdByIndex(product) {
  const variants = asArray(product?.variants?.edges)
    .map((edge) => edge?.node)
    .filter((node) => node?.id);

  return new Map(variants.map((variant, index) => [index, variant.id]));
}

function normalizeBulkMutationOutcomes({ parsed, shop }) {
  const product = parsed?.data?.productSet?.product || null;
  const productId = product?.id || parsed?.productId || parsed?.id || null;
  const errors = extractProductSetUserErrors(parsed);
  const variantIdByIndex = buildVariantIdByIndex(product);
  const variantErrors = [];
  const productErrors = [];

  for (const error of errors) {
    const variantIndex = extractVariantIndexFromError(error);
    const variantId =
      variantIndex !== null ? variantIdByIndex.get(variantIndex) || null : null;

    if (variantIndex !== null) {
      variantErrors.push({
        error,
        variantIndex,
        variantId,
      });
      continue;
    }

    productErrors.push(error);
  }

  if (errors.length === 0) {
    return [
      {
        targetId: productId,
        productId,
        variantId: null,
        status: "SUCCESS",
        code: null,
        message: null,
        raw: {
          shop,
          productId,
          userErrors: [],
          productSetOperation: parsed?.data?.productSet?.productSetOperation || null,
        },
      },
    ];
  }

  const outcomes = [];
  const firstProductError = productErrors[0] || errors[0] || null;

  outcomes.push({
    targetId: productId,
    productId,
    variantId: null,
    status: "FAILED",
    code: firstProductError?.code || null,
    message: firstProductError?.message || null,
    raw: {
      shop,
      productId,
      userErrors: errors,
      productSetOperation: parsed?.data?.productSet?.productSetOperation || null,
    },
  });

  for (const { error, variantIndex, variantId } of variantErrors) {
    outcomes.push({
      targetId: variantId || productId,
      productId,
      variantId,
      status: "FAILED",
      code: error?.code || null,
      message: error?.message || null,
      raw: {
        shop,
        productId,
        variantId,
        variantIndex,
        field: error?.field || null,
        userError: error,
      },
    });
  }

  return outcomes;
}

async function fetchBulkMutationOutcomes(url, shop) {
  const response = await axios.get(url, {
    responseType: "text",
    timeout: 120000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  const outcomes = [];
  const lines = response.data.split("\n").filter(Boolean);

  for (let i = 0; i < lines.length; i += 1) {
    try {
      const parsed = JSON.parse(lines[i]);
      outcomes.push(...normalizeBulkMutationOutcomes({ parsed, shop }));
    } catch (_error) {
      outcomes.push({
        targetId: null,
        productId: null,
        variantId: null,
        status: "FAILED",
        code: "BULK_MUTATION_RESULT_PARSE_FAILED",
        message: `Failed to parse Shopify bulk mutation result line ${i + 1}`,
        raw: {
          lineNumber: i + 1,
        },
      });
    }
  }

  return outcomes;
}

async function fetchBulkMutationOutcomeResult({ history, bulkOperation }) {
  if (!bulkOperation?.url) {
    return { count: 0 };
  }

  const outcomes = await fetchBulkMutationOutcomes(
    bulkOperation.url,
    history.shop,
  );

  if (!outcomes.length) {
    return { count: 0 };
  }

  return { count: outcomes.length, outcomes };
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

    await addbulkUndoJob({
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
    await bulkMutationExecutionService.markBulkMutationFailedByOperationId({
      bulkOperationId,
      shop: history.shop,
      failureCode: bulkOperation?.errorCode || "SHOPIFY_BULK_MUTATION_FAILED",
      failureMessage: bulkOperation?.partialDataUrl
        ? "Shopify bulk operation completed with partial failures"
        : "Shopify bulk operation failed",
      failureCategory: "SHOPIFY",
      failureStage: claimKind === "undo" ? "undo_bulk_mutation" : "shopify_bulk_mutation",
      retryable: false,
    });

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

  const outcomeResult = await fetchBulkMutationOutcomeResult({
    history,
    bulkOperation,
  });

  await bulkMutationExecutionService.completeBulkMutationByOperationId({
    bulkOperationId,
    shop: history.shop,
    outcomes: outcomeResult.outcomes || [],
    rowCount: outcomeResult.count || Number(bulkOperation?.objectCount || 0),
  });

  await applyOutcomeStatusesToChangeRecords({
    history,
    outcomes: outcomeResult.outcomes || [],
  }).catch(() => {});

  await applyBulkMirrorUpdates(history, bulkOperation);
  if (claimKind === "edit") {
    const result = await finalizeEditSuccess(history);
    await clearKeyCaches(`${history.shop}:historyDetails:${history.id}`);
    return { success: true, continued: result.continued, kind: "edit" };
  }

  const result = await finalizeUndoSuccess(history);
  await clearKeyCaches(`${history.shop}:historyDetails:${history.id}`);
  return { success: true, continued: result.continued, kind: "undo" };
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

  for (let i = 0; i < lines.length; i += 1) {
    try {
      const parsed = JSON.parse(lines[i]);
      const product = parsed?.data?.productSet?.product;

      if (!product?.id) {
        continue;
      }

      const variantEdges = asArray(product?.variants?.edges);
      const variants = variantEdges
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
          cost:
            node.inventoryItem?.unitCost?.amount != null
              ? Number(node.inventoryItem.unitCost.amount)
              : null,
          countryOfOrigin: node.inventoryItem?.countryCodeOfOrigin ?? null,
          hsTariffCode: node.inventoryItem?.harmonizedSystemCode ?? null,
          weight:
            node.inventoryItem?.measurement?.weight?.value != null
              ? Number(node.inventoryItem.measurement.weight.value)
              : null,
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
          description: product.descriptionHtml ?? null,
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
      // Skip malformed lines while preserving valid rows.
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
    await addbulkUndoJob({
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
