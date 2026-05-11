import { Worker } from "bullmq";
import crypto from "crypto";
import { connection } from "../../config/redis.js";
import UndoEditService from "../../services/productService/productBulkUndoService.js";
import { getSession } from "../../utils/sessionHandler.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import logger from "../../utils/loggerUtils.js";
import { logWorkerError } from "../../utils/errorLogUtils.js";
import { prisma } from "../../config/database.js";
import { bulkUndoExecutionRepository } from "../../repositories/bulkUndoExecutionRepository.js";
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
import { requireJobData } from "../../utils/jobPayloadValidation.js";
import { assertShopMatch } from "../../utils/assertShopMatch.js";
import { recordMirrorAnomaly } from "../../services/mirrorAnomalyService.js";
import {
  BULK_UNDO_STATES,
  buildExecutionError,
  normalizeUndoState,
} from "../../services/bulkEditExecutionStateService.js";
import { OPERATION_QUEUE_NAMES } from "../queues/operationQueueRegistry.js";
import { toUnrecoverableIfNonRetryable } from "../../utils/nonRetryableJobCodes.js";
import { getCurrentBulkOperationStatus } from "../../modules/bulkOperations/bulkOperationHelper.js";
import { bulkEditHistoryRepository } from "../../repositories/bulkEditHistoryRepository.js";
import { claimUndoExecutionPlan } from "../../services/undo/undoClaimService.js";
import { UNDO_TARGET_STATUS } from "../../services/undo/undoStatus.constants.js";
import { transitionUndoRequestStatus } from "../../services/undo/undoTransitionGuard.js";
import { UNDO_CONFLICT_REASONS } from "../../services/undo/undoConflictReasons.js";
import { assertEditExecutionUsesFrozenTargets } from "../../services/execution/frozenTargetInvariantService.js";
import { stableCanonicalStringify } from "../../utils/stableCanonicalStringify.js";

const QUEUE_NAME = process.env.UNDO_QUEUE || OPERATION_QUEUE_NAMES.UNDO_EXECUTE;
const WORKER_NAME = "bulkUndoWorker";

class RetryableBulkUndoError extends Error {
  constructor(message, code = "retryable_bulk_undo") {
    super(message);
    this.name = "RetryableBulkUndoError";
    this.retryable = true;
    this.code = code;
  }
}

function isRetryableError(error) {
  return Boolean(error?.retryable);
}

function calculateUndoDurationMs(startedAt, completedAt) {
  const start = startedAt ? new Date(startedAt).getTime() : NaN;
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();

  if (Number.isNaN(start)) {
    return 0;
  }

  return Math.max(0, end - start);
}

function buildUndoMutationLedgerRows({ shop, operationId, products }) {
  const rows = [];

  for (const product of products || []) {
    const productId = product?.productId;
    if (!productId) continue;

    const productChanges = Array.isArray(product.productFieldChanges)
      ? product.productFieldChanges
      : [];
    for (const change of productChanges) {
      if (!change?.field) continue;
        rows.push({
          shop,
          operationId,
          entityId: productId,
          entityType: "PRODUCT",
          field: change.field,
          batchId: null,
          status: "SUBMITTED",
        });
    }

    const variantChanges = Array.isArray(product.variantFieldChanges)
      ? product.variantFieldChanges
      : [];
    for (const variant of variantChanges) {
      if (!variant?.variantId || !Array.isArray(variant.changes)) continue;
      for (const change of variant.changes) {
        if (!change?.field) continue;
        rows.push({
          shop,
          operationId,
          entityId: variant.variantId,
          entityType: "VARIANT",
          field: change.field,
          batchId: null,
          status: "SUBMITTED",
        });
      }
    }
  }

  return rows;
}

function valuesEqual(a, b) {
  return stableCanonicalStringify(a) === stableCanonicalStringify(b);
}

const STRICT_UNDO_DRIFT_BLOCK =
  String(process.env.UNDO_STRICT_DRIFT_BLOCK ?? "true").trim().toLowerCase() !== "false";

function hashUndoPlan(planJson) {
  return crypto
    .createHash("sha256")
    .update(stableCanonicalStringify(planJson))
    .digest("hex");
}

function canonicalizeFieldValue(field, value) {
  if (value === undefined) return null;
  if (value === null) return null;

  if (field === "price" || field === "compareAtPrice" || field === "cost" || field === "weight") {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  if (field === "inventoryQuantity" || field === "position") {
    const num = Number(value);
    return Number.isFinite(num) ? Math.trunc(num) : null;
  }

  if (field === "taxable" || field === "requiresShipping") {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes"].includes(normalized)) return true;
      if (["false", "0", "no"].includes(normalized)) return false;
    }
    return Boolean(value);
  }

  if (field === "tags") {
    const source = Array.isArray(value)
      ? value
      : String(value)
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean);
    return [...new Set(source.map((entry) => String(entry).trim().toLowerCase()))].sort();
  }

  return value ?? null;
}

function valuesEqualCanonical(field, a, b) {
  const left = canonicalizeFieldValue(field, a);
  const right = canonicalizeFieldValue(field, b);
  return stableCanonicalStringify(left) === stableCanonicalStringify(right);
}

function normalizeProductFieldValue(product, field) {
  if (!product || !field) return null;
  if (field.startsWith("option") && field.endsWith("Name")) {
    const match = field.match(/^option([123])Name$/);
    const index = match ? Number(match[1]) - 1 : -1;
    const options = Array.isArray(product.optionsJson) ? product.optionsJson : [];
    const option = index >= 0 ? options[index] : null;
    return option?.name ?? null;
  }
  return product[field] ?? null;
}

function normalizeVariantFieldValue(variant, field) {
  if (!variant || !field) return null;
  return variant[field] ?? null;
}

async function revalidateUndoBatchAgainstMirror({
  shop,
  mirrorBatchId,
  products,
}) {
  const safeProducts = [];
  const conflicts = [];
  const sourceProducts = Array.isArray(products) ? products : [];
  if (!sourceProducts.length) {
    return { safeProducts, skippedCount: 0 };
  }

  const productIds = sourceProducts.map((item) => item?.productId).filter(Boolean);
  const variantsRequested = [];
  for (const product of sourceProducts) {
    const variantChanges = Array.isArray(product?.variantFieldChanges)
      ? product.variantFieldChanges
      : [];
    for (const variant of variantChanges) {
      if (variant?.variantId) {
        variantsRequested.push(variant.variantId);
      }
    }
  }

  const productMirrorRows = await prisma.product.findMany({
    where: {
      shop,
      mirrorBatchId,
      id: { in: productIds },
    },
    select: {
      id: true,
      title: true,
      handle: true,
      status: true,
      vendor: true,
      productType: true,
      tags: true,
      seoTitle: true,
      seoDescription: true,
      option1Name: true,
      option2Name: true,
      option3Name: true,
      optionsJson: true,
    },
  });
  const variantMirrorRows = variantsRequested.length
    ? await prisma.variant.findMany({
        where: {
          shop,
          mirrorBatchId,
          id: { in: variantsRequested },
        },
        select: {
          id: true,
          title: true,
          sku: true,
          barcode: true,
          price: true,
          compareAtPrice: true,
          inventoryQuantity: true,
          inventoryPolicy: true,
          taxable: true,
          cost: true,
          weight: true,
          weightUnit: true,
          option1Value: true,
          option2Value: true,
          option3Value: true,
        },
      })
    : [];

  const productById = new Map(productMirrorRows.map((row) => [row.id, row]));
  const variantById = new Map(variantMirrorRows.map((row) => [row.id, row]));

  for (const product of sourceProducts) {
    const mirrorProduct = productById.get(product.productId);
    if (!mirrorProduct) {
      conflicts.push({
        productId: product.productId,
        variantId: null,
        field: null,
        reason: UNDO_CONFLICT_REASONS.PRODUCT_MISSING,
      });
      continue;
    }

    const safeProductFieldChanges = [];
    const safeVariantFieldChanges = [];

    for (const change of Array.isArray(product.productFieldChanges)
      ? product.productFieldChanges
      : []) {
      const expectedCurrent = change?.newValue ?? null;
      const actualCurrent = normalizeProductFieldValue(mirrorProduct, change?.field);
      if (!valuesEqualCanonical(change?.field, actualCurrent, expectedCurrent)) {
        conflicts.push({
          productId: product.productId,
          variantId: null,
          field: change?.field || null,
          reason: UNDO_CONFLICT_REASONS.MERCHANT_OR_APP_CHANGED_VALUE_AFTER_EDIT,
        });
        continue;
      }
      safeProductFieldChanges.push(change);
    }

    for (const variant of Array.isArray(product.variantFieldChanges)
      ? product.variantFieldChanges
      : []) {
      const mirrorVariant = variant?.variantId ? variantById.get(variant.variantId) : null;
      if (!mirrorVariant) {
        conflicts.push({
          productId: product.productId,
          variantId: variant?.variantId || null,
          field: null,
          reason: UNDO_CONFLICT_REASONS.VARIANT_MISSING,
        });
        continue;
      }

      const safeChanges = [];
      for (const change of Array.isArray(variant.changes) ? variant.changes : []) {
        const expectedCurrent = change?.newValue ?? null;
        const actualCurrent = normalizeVariantFieldValue(mirrorVariant, change?.field);
        if (!valuesEqualCanonical(change?.field, actualCurrent, expectedCurrent)) {
          conflicts.push({
            productId: product.productId,
            variantId: variant?.variantId || null,
            field: change?.field || null,
            reason: UNDO_CONFLICT_REASONS.MERCHANT_OR_APP_CHANGED_VALUE_AFTER_EDIT,
          });
          continue;
        }
        safeChanges.push(change);
      }

      if (safeChanges.length > 0) {
        safeVariantFieldChanges.push({
          ...variant,
          changes: safeChanges,
        });
      }
    }

    if (safeProductFieldChanges.length === 0 && safeVariantFieldChanges.length === 0) {
      continue;
    }

    safeProducts.push({
      ...product,
      productFieldChanges: safeProductFieldChanges,
      variantFieldChanges: safeVariantFieldChanges,
    });
  }

  return {
    safeProducts,
    conflicts,
    skippedCount: Math.max(0, sourceProducts.length - safeProducts.length),
  };
}

function normalizeLiveProductFieldValue(product, field) {
  if (!product || !field) return null;
  switch (field) {
    case "metaTitle":
      return product?.seo?.title ?? null;
    case "metaDescription":
      return product?.seo?.description ?? null;
    case "description":
    case "descriptionHtml":
      return product?.descriptionHtml ?? null;
    case "option1Name":
      return product?.options?.[0]?.name ?? null;
    case "option2Name":
      return product?.options?.[1]?.name ?? null;
    case "option3Name":
      return product?.options?.[2]?.name ?? null;
    default:
      return product?.[field] ?? null;
  }
}

function normalizeLiveVariantFieldValue(variant, field) {
  if (!variant || !field) return null;
  switch (field) {
    case "cost":
      return variant?.inventoryItem?.unitCost?.amount ?? null;
    case "weight":
      return variant?.inventoryItem?.measurement?.weight?.value ?? null;
    case "weightUnit":
      return variant?.inventoryItem?.measurement?.weight?.unit ?? null;
    case "requiresShipping":
      return variant?.inventoryItem?.requiresShipping ?? null;
    default:
      return variant?.[field] ?? null;
  }
}

async function fetchLiveShopifyState({ session, productIds, variantIds }) {
  const productById = new Map();
  const variantById = new Map();
  const nodes = [...new Set([...(productIds || []), ...(variantIds || [])])];
  const chunkSize = 50;

  for (let index = 0; index < nodes.length; index += chunkSize) {
    const chunk = nodes.slice(index, index + chunkSize);
    if (!chunk.length) continue;

    const client = new shopify.api.clients.Graphql({ session });
    const response = await client.query({
      data: {
        query: `#graphql
          query UndoLiveState($ids: [ID!]!) {
            nodes(ids: $ids) {
              __typename
              ... on Product {
                id
                title
                handle
                status
                vendor
                productType
                tags
                descriptionHtml
                seo {
                  title
                  description
                }
                options {
                  name
                }
              }
              ... on ProductVariant {
                id
                title
                sku
                barcode
                price
                compareAtPrice
                inventoryQuantity
                inventoryPolicy
                taxable
                inventoryItem {
                  requiresShipping
                  unitCost {
                    amount
                  }
                  measurement {
                    weight {
                      value
                      unit
                    }
                  }
                }
              }
            }
          }`,
        variables: { ids: chunk },
      },
    });

    const liveNodes = Array.isArray(response?.body?.data?.nodes) ? response.body.data.nodes : [];
    for (const node of liveNodes) {
      if (!node?.id) continue;
      if (node.__typename === "Product") productById.set(node.id, node);
      if (node.__typename === "ProductVariant") variantById.set(node.id, node);
    }
  }

  return { productById, variantById };
}

async function validateUndoAgainstLiveShopify({ session, products }) {
  const safeProducts = [];
  const conflicts = [];
  const sourceProducts = Array.isArray(products) ? products : [];
  if (!sourceProducts.length) {
    return { safeProducts, conflicts, skippedCount: 0 };
  }

  const productIds = sourceProducts.map((product) => product?.productId).filter(Boolean);
  const variantIds = [];
  for (const product of sourceProducts) {
    for (const variant of Array.isArray(product?.variantFieldChanges) ? product.variantFieldChanges : []) {
      if (variant?.variantId) variantIds.push(variant.variantId);
    }
  }

  const { productById, variantById } = await fetchLiveShopifyState({
    session,
    productIds,
    variantIds,
  });

  for (const product of sourceProducts) {
    const liveProduct = productById.get(product.productId);
    if (!liveProduct) {
      conflicts.push({
        productId: product.productId,
        variantId: null,
        field: null,
        reason: UNDO_CONFLICT_REASONS.PRODUCT_MISSING,
      });
      continue;
    }

    const safeProductFieldChanges = [];
    const safeVariantFieldChanges = [];

    for (const change of Array.isArray(product.productFieldChanges) ? product.productFieldChanges : []) {
      const expectedCurrent = change?.newValue ?? null;
      const actualCurrent = normalizeLiveProductFieldValue(liveProduct, change?.field);
      if (!valuesEqualCanonical(change?.field, actualCurrent, expectedCurrent)) {
        conflicts.push({
          productId: product.productId,
          variantId: null,
          field: change?.field || null,
          reason: UNDO_CONFLICT_REASONS.MERCHANT_OR_APP_CHANGED_VALUE_AFTER_EDIT,
        });
        continue;
      }
      safeProductFieldChanges.push(change);
    }

    for (const variant of Array.isArray(product.variantFieldChanges) ? product.variantFieldChanges : []) {
      const liveVariant = variant?.variantId ? variantById.get(variant.variantId) : null;
      if (!liveVariant) {
        conflicts.push({
          productId: product.productId,
          variantId: variant?.variantId || null,
          field: null,
          reason: UNDO_CONFLICT_REASONS.VARIANT_MISSING,
        });
        continue;
      }

      const safeChanges = [];
      for (const change of Array.isArray(variant.changes) ? variant.changes : []) {
        const expectedCurrent = change?.newValue ?? null;
        const actualCurrent = normalizeLiveVariantFieldValue(liveVariant, change?.field);
        if (!valuesEqualCanonical(change?.field, actualCurrent, expectedCurrent)) {
          conflicts.push({
            productId: product.productId,
            variantId: variant?.variantId || null,
            field: change?.field || null,
            reason: UNDO_CONFLICT_REASONS.MERCHANT_OR_APP_CHANGED_VALUE_AFTER_EDIT,
          });
          continue;
        }
        safeChanges.push(change);
      }

      if (safeChanges.length > 0) {
        safeVariantFieldChanges.push({
          ...variant,
          changes: safeChanges,
        });
      }
    }

    if (safeProductFieldChanges.length === 0 && safeVariantFieldChanges.length === 0) {
      continue;
    }

    safeProducts.push({
      ...product,
      productFieldChanges: safeProductFieldChanges,
      variantFieldChanges: safeVariantFieldChanges,
    });
  }

  return {
    safeProducts,
    conflicts,
    skippedCount: Math.max(0, sourceProducts.length - safeProducts.length),
  };
}

function buildUndoDispatchedSelectors(products) {
  const selectors = [];
  for (const product of Array.isArray(products) ? products : []) {
    const productId = product?.productId || null;
    if (!productId) continue;
    for (const change of Array.isArray(product?.productFieldChanges)
      ? product.productFieldChanges
      : []) {
      if (!change?.field) continue;
      selectors.push({
        productId,
        variantId: null,
        field: change.field,
      });
    }
    for (const variant of Array.isArray(product?.variantFieldChanges)
      ? product.variantFieldChanges
      : []) {
      if (!variant?.variantId) continue;
      for (const change of Array.isArray(variant?.changes) ? variant.changes : []) {
        if (!change?.field) continue;
        selectors.push({
          productId,
          variantId: variant.variantId,
          field: change.field,
        });
      }
    }
  }
  return selectors;
}

async function claimUndo(historyId, shop, executionId, jobId, attempt) {
  const claimed = await bulkEditHistoryRepository.applyProjectionUpdate({
    where: {
      id: historyId,
      shop,
      undoExecutionIdentity: executionId,
      undoState: BULK_UNDO_STATES.QUEUED,
    },
    data: {
      undoState: BULK_UNDO_STATES.DISPATCHING,
    },
  });

  if (claimed.count !== 1) {
    return null;
  }

  const history = await prisma.editHistory.findFirst({
    where: {
      id: historyId,
      shop,
      undoExecutionIdentity: executionId,
    },
    select: {
      id: true,
      shop: true,
      batch: true,
      rules: true,
      undo: true,
    },
  });

  if (!history) {
    throw new Error(`EditHistory not found for shop ${shop} and id ${historyId}`);
  }

  const undo = normalizeUndoState(history.undo);
  if (executionId && undo.executionIdentity && executionId !== undo.executionIdentity) {
    throw new Error("Bulk undo execution identity mismatch");
  }

  return history;
}

async function resolveUndoDispatchContext({ shop, undoRequestId, undoExecutionPlanId }) {
  if (!undoRequestId) {
    const error = new Error("UNDO_REQUEST_ID_REQUIRED");
    error.code = "UNDO_REQUEST_ID_REQUIRED";
    throw error;
  }
  if (!undoExecutionPlanId) {
    const error = new Error("UNDO_EXECUTION_PLAN_ID_REQUIRED");
    error.code = "UNDO_EXECUTION_PLAN_ID_REQUIRED";
    throw error;
  }

  const claimedPlan = await claimUndoExecutionPlan({
    shop,
    undoExecutionPlanId,
  });

  if (claimedPlan.undoRequestId !== undoRequestId) {
    const error = new Error("UNDO_PLAN_REQUEST_BINDING_MISMATCH");
    error.code = "UNDO_PLAN_REQUEST_BINDING_MISMATCH";
    throw error;
  }

  const computedPlanHash = hashUndoPlan(claimedPlan.planJson);
  if (computedPlanHash !== claimedPlan.planHash) {
    const error = new Error("UNDO_EXECUTION_PLAN_HASH_MISMATCH");
    error.code = "UNDO_EXECUTION_PLAN_HASH_MISMATCH";
    throw error;
  }

  const planMutationCount = Array.isArray(claimedPlan?.planJson?.mutations)
    ? claimedPlan.planJson.mutations.length
    : 0;
  if (Number(claimedPlan.mutationCount || 0) !== planMutationCount) {
    const error = new Error("UNDO_EXECUTION_PLAN_MUTATION_COUNT_MISMATCH");
    error.code = "UNDO_EXECUTION_PLAN_MUTATION_COUNT_MISMATCH";
    throw error;
  }

  const undoRequest = await prisma.undoRequest.findFirst({
    where: {
      id: undoRequestId,
      shop,
    },
    select: {
      executionId: true,
    },
  });

  if (!undoRequest?.executionId) {
    const error = new Error("UNDO_REQUEST_EXECUTION_ID_MISSING");
    error.code = "UNDO_REQUEST_EXECUTION_ID_MISSING";
    throw error;
  }

  const history = await prisma.editHistory.findFirst({
    where: {
      shop,
      OR: [
        { undoExecutionIdentity: undoRequest.executionId },
        { executionIdentity: undoRequest.executionId },
      ],
    },
    select: {
      id: true,
      undoExecutionIdentity: true,
      executionIdentity: true,
    },
  });

  if (!history?.id) {
    const error = new Error("UNDO_HISTORY_NOT_FOUND_FOR_REQUEST");
    error.code = "UNDO_HISTORY_NOT_FOUND_FOR_REQUEST";
    throw error;
  }

  const expectedExecutionId =
    history?.undoExecutionIdentity || history?.executionIdentity || null;

  if (expectedExecutionId && expectedExecutionId !== undoRequest.executionId) {
    const error = new Error("UNDO_EXECUTION_PLAN_HISTORY_MISMATCH");
    error.code = "UNDO_EXECUTION_PLAN_HISTORY_MISMATCH";
    throw error;
  }

  return {
    historyId: history.id,
    executionId: undoRequest.executionId,
    undoRequestId,
    undoExecutionPlanId: claimedPlan.id,
    claimedPlan,
  };
}

const bulkUndoWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const data = requireJobData(job, ["shop", "undoRequestId", "undoExecutionPlanId"], "bulk undo");
    const { shop, undoRequestId, source = "undo", undoExecutionPlanId = null } = data;
    const attempt = getJobAttempt(job);
    const { executionId, historyId: resolvedHistoryId, claimedPlan } = await resolveUndoDispatchContext({
      shop,
      undoRequestId,
      undoExecutionPlanId,
    });
    const historyId = resolvedHistoryId;

    let shopLockKey = null;

    try {
      const lock = await acquireExclusiveShopWork({
        shop,
        activity: "bulk_undo_execution",
        worker: WORKER_NAME,
        queue: QUEUE_NAME,
        jobId: job.id,
        entityType: "editHistory",
        entityId: historyId,
        executionId,
      });

      if (!lock.acquired) {
        throw new RetryableBulkUndoError(
          "Another heavy job is already running for this shop",
          "shop_work_conflict",
        );
      }

      shopLockKey = lock.lockKey;

      const session = await getSession(shop);
      if (!session?.shop) {
        throw new Error("Shop session not available for bulk undo execution");
      }
      assertShopMatch({
        jobShop: shop,
        dbShop: session.shop,
        context: "bulk_undo_session",
        jobId: job?.id || null,
        entityType: "editHistory",
        entityId: historyId,
      });

      const claimedHistory = await claimUndo(historyId, shop, executionId, job.id, attempt);
      if (!claimedHistory) {
        return {
          skipped: true,
          reason: "undo_already_processing",
          shop,
          historyId,
        };
      }

      const history = await prisma.editHistory.findFirst({
        where: {
          id: historyId,
          shop,
        },
        select: {
          id: true,
          batch: true,
          rules: true,
          undo: true,
          startedAt: true,
          targetMirrorBatchId: true,
        },
      });
      await assertEditExecutionUsesFrozenTargets({
        shop,
        historyId,
        phase: "bulk_undo_dispatch",
      });

      const rule = Array.isArray(history?.rules) ? history.rules[0] || {} : {};
      const batch = history?.batch && typeof history.batch === "object" ? history.batch : {};
      const undo = normalizeUndoState(history?.undo);
      const service = new UndoEditService(session);
      const limit = batch.size || 75;
      const execution = await bulkUndoExecutionRepository.findExecution({
        shop,
        executionIdentity: executionId,
      });

      if (!execution?.frozenCount || execution.frozenCount <= 0) {
        throw new Error("UNDO_SNAPSHOT_NOT_FROZEN");
      }
      if (!execution?.mirrorBatchId) {
        throw new Error("UNDO_MIRROR_BATCH_REQUIRED");
      }
      if (!history?.targetMirrorBatchId || history.targetMirrorBatchId !== execution.mirrorBatchId) {
        throw new Error("UNDO_MIRROR_BATCH_MISMATCH");
      }

      if (execution.bulkOperationId) {
        return {
          skipped: true,
          reason: "already_dispatched",
          shop,
          historyId,
        };
      }

      const { status: shopifyBulkStatus } = await getCurrentBulkOperationStatus(session);
      if (shopifyBulkStatus === "RUNNING") {
        throw new RetryableBulkUndoError(
          "Another Shopify bulk operation is already running",
          "shopify_bulk_busy",
        );
      }

      const batchData = await service.prepareUndoBatch({
        historyId,
        executionId,
        limit,
        undoPlanJson: claimedPlan?.planJson || null,
      });

      if (!batchData.products.length) {
        if (Number(execution.processedCount || 0) < Number(execution.frozenCount || 0)) {
          throw new Error("UNDO_INCOMPLETE_BUT_NO_MORE_BATCHES");
        }

        const completedAt = new Date();
        const applying = await bulkUndoExecutionRepository.markApplyingResults({
          shop,
          executionIdentity: executionId,
        });
        if (applying.count !== 1) {
          throw new Error("Undo execution could not enter APPLYING_RESULTS");
        }
        const verifying = await bulkUndoExecutionRepository.markVerifying({
          shop,
          executionIdentity: executionId,
          resultsAppliedAt: completedAt,
        });
        if (verifying.count !== 1) {
          throw new Error("Undo execution could not enter VERIFYING");
        }
        const completion = await bulkUndoExecutionRepository.markCompleted({
          shop,
          executionIdentity: executionId,
        });

        if (completion.count !== 1) {
          throw new Error("Undo execution could not be completed after snapshot exhaustion");
        }

        const completedExecution = await bulkUndoExecutionRepository.findExecution({
          shop,
          executionIdentity: executionId,
        });

        await bulkEditHistoryRepository.applyProjectionUpdate({
          where: {
            id: historyId,
            shop,
            undoExecutionIdentity: executionId,
          },
          data: {
            undoState: BULK_UNDO_STATES.COMPLETED,
            undoCompletedAt: completedAt,
            undo: {
              ...undo,
              status: "completed",
              state: BULK_UNDO_STATES.COMPLETED,
              completedAt,
              processedCount: Number(
                completedExecution?.processedCount ?? undo.processedCount ?? 0,
              ),
              durationMs: calculateUndoDurationMs(
                undo.startedAt || history?.startedAt,
                completedAt,
              ),
              error: null,
            },
            batch: {
              ...batch,
              hasMore: false,
              currentBatchTargetCount: 0,
            },
          },
        });

        await clearKeyCaches(`${shop}:fetchHistories`);
        await clearKeyCaches(`${shop}:historyDetails:${historyId}`);

        return {
          success: true,
          reason: "undo_completed_snapshot_exhausted",
          shop,
          historyId,
        };
      }

      await bulkEditHistoryRepository.applyProjectionUpdate({
        where: {
          id: historyId,
          shop,
          undoExecutionIdentity: executionId,
        },
        data: {
          undoState: BULK_UNDO_STATES.DISPATCHING,
          undo: {
            ...undo,
            status: "processing",
            state: BULK_UNDO_STATES.DISPATCHING,
            dispatchPreparedAt: new Date(),
            error: null,
          },
          batch: {
            ...batch,
            currentBatchTargetCount: batchData.count,
            hasMore: batchData.hasMore,
          },
          processingBatchId: `${executionId}:${batchData.lastSnapshotOrdinal || "start"}`,
        },
      });

      const activeOperationId =
        typeof batch?.operationId === "string" ? batch.operationId : null;
      if (activeOperationId) {
        await storeOperationalStateRepository.markAwaitingShopify(
          shop,
          activeOperationId,
        );
      }

      const revalidatedBatch = await revalidateUndoBatchAgainstMirror({
        shop,
        mirrorBatchId: execution.mirrorBatchId,
        products: batchData.products,
      });
      const liveValidatedBatch = await validateUndoAgainstLiveShopify({
        session,
        products: revalidatedBatch.safeProducts,
      });
      const combinedConflicts = [
        ...(revalidatedBatch.conflicts || []),
        ...(liveValidatedBatch.conflicts || []),
      ];
      if (!liveValidatedBatch.safeProducts.length) {
        const undoRequest = await prisma.undoRequest.findFirst({
          where: { shop, executionId },
          select: { id: true },
        });
        if (undoRequest?.id && combinedConflicts.length > 0) {
          const reasonBuckets = new Map();
          for (const conflict of combinedConflicts) {
            const key = conflict.reason || UNDO_CONFLICT_REASONS.CURRENT_VALUE_DIFFERS_FROM_AFTER_VALUE;
            if (!reasonBuckets.has(key)) reasonBuckets.set(key, []);
            reasonBuckets.get(key).push(conflict);
          }
          for (const [reason, bucket] of reasonBuckets.entries()) {
            const selectorOr = bucket.map((conflict) => ({
              productId: conflict.productId,
              ...(conflict.variantId ? { variantId: conflict.variantId } : {}),
              ...(conflict.field ? { field: conflict.field } : {}),
            }));
            if (selectorOr.length > 0) {
              await prisma.undoTarget.updateMany({
                where: {
                  shop,
                  undoRequestId: undoRequest.id,
                  OR: selectorOr,
                  status: {
                    in: [UNDO_TARGET_STATUS.SAFE, UNDO_TARGET_STATUS.DISPATCHED, UNDO_TARGET_STATUS.PENDING],
                  },
                },
                data: {
                  status: UNDO_TARGET_STATUS.CONFLICT,
                  conflictReason: reason,
                },
              });
            }
          }
        }
        const error = new Error("NO_SAFE_UNDO_TARGETS_FOR_DISPATCH");
        error.code = "NO_SAFE_UNDO_TARGETS_FOR_DISPATCH";
        throw error;
      }

      if (combinedConflicts.length > 0) {
        const undoRequest = await prisma.undoRequest.findFirst({
          where: { shop, executionId },
          select: { id: true },
        });
        if (undoRequest?.id) {
          const reasonBuckets = new Map();
          for (const conflict of combinedConflicts) {
            const key = conflict.reason || UNDO_CONFLICT_REASONS.CURRENT_VALUE_DIFFERS_FROM_AFTER_VALUE;
            if (!reasonBuckets.has(key)) reasonBuckets.set(key, []);
            reasonBuckets.get(key).push(conflict);
          }
          for (const [reason, bucket] of reasonBuckets.entries()) {
            const selectorOr = bucket.map((conflict) => ({
              productId: conflict.productId,
              ...(conflict.variantId ? { variantId: conflict.variantId } : {}),
              ...(conflict.field ? { field: conflict.field } : {}),
            }));
            if (selectorOr.length > 0) {
              await prisma.undoTarget.updateMany({
                where: {
                  shop,
                  undoRequestId: undoRequest.id,
                  OR: selectorOr,
                  status: {
                    in: [UNDO_TARGET_STATUS.SAFE, UNDO_TARGET_STATUS.DISPATCHED, UNDO_TARGET_STATUS.PENDING],
                  },
                },
                data: {
                  status: UNDO_TARGET_STATUS.CONFLICT,
                  conflictReason: reason,
                },
              });
            }
          }
        }
      }

      if (
        STRICT_UNDO_DRIFT_BLOCK &&
        combinedConflicts.some(
          (conflict) =>
            conflict?.reason ===
            UNDO_CONFLICT_REASONS.MERCHANT_OR_APP_CHANGED_VALUE_AFTER_EDIT,
        )
      ) {
        const error = new Error("MERCHANT_OR_APP_CHANGED_VALUE_AFTER_EDIT");
        error.code = "MERCHANT_OR_APP_CHANGED_VALUE_AFTER_EDIT";
        throw error;
      }

      const dispatchSelectors = buildUndoDispatchedSelectors(
        liveValidatedBatch.safeProducts,
      );
      if (dispatchSelectors.length > 0) {
        const undoRequest = await prisma.undoRequest.findFirst({
          where: {
            shop,
            executionId,
          },
          select: { id: true },
        });
        if (undoRequest?.id) {
          const allowedUndoTargetIds = new Set(
            Array.isArray(claimedPlan?.planJson?.mutations)
              ? claimedPlan.planJson.mutations
                  .map((mutation) => mutation?.undoTargetId)
                  .filter(Boolean)
              : [],
          );
          for (const selector of dispatchSelectors) {
            const updateResult = await prisma.undoTarget.updateMany({
              where: {
                shop,
                undoRequestId: undoRequest.id,
                productId: selector.productId,
                variantId: selector.variantId,
                field: selector.field,
                ...(allowedUndoTargetIds.size > 0
                  ? { id: { in: Array.from(allowedUndoTargetIds) } }
                  : {}),
                restoredAt: null,
                undoMutationId: null,
                status: {
                  in: [UNDO_TARGET_STATUS.SAFE, UNDO_TARGET_STATUS.PENDING],
                },
              },
              data: {
                status: UNDO_TARGET_STATUS.DISPATCHED,
              },
            });
            if (updateResult.count === 0) {
              const conflict = new Error("UNDO_TARGET_ALREADY_RESTORED_OR_NOT_DISPATCHABLE");
              conflict.code = "UNDO_TARGET_ALREADY_RESTORED_OR_NOT_DISPATCHABLE";
              throw conflict;
            }
          }
        }
      }

      const result = await service.undoEditBulkOperation(
        revalidatedBatch.safeProducts,
        rule.field,
      );
      if (!result?.bulkOperationId) {
        throw new Error("UNDO_BULK_OPERATION_ID_MISSING");
      }

      const mutationRows = buildUndoMutationLedgerRows({
        shop,
        operationId: executionId,
        products: liveValidatedBatch.safeProducts,
      });
      if (mutationRows.length > 0) {
        await prisma.operationMutation.createMany({
          data: mutationRows,
          skipDuplicates: true,
        });
      }

      await bulkUndoExecutionRepository.markAwaitingShopify({
        shop,
        executionIdentity: executionId,
        bulkOperationId: result.bulkOperationId,
        lastSnapshotOrdinal: batchData.lastSnapshotOrdinal,
        count: result.count,
      });
      const activeUndoRequest = await prisma.undoRequest.findFirst({
        where: {
          shop,
          executionId,
        },
        select: { id: true },
      });
      if (activeUndoRequest?.id) {
        await transitionUndoRequestStatus({
          shop,
          undoRequestId: activeUndoRequest.id,
          toStatus: "AWAITING_SHOPIFY",
        });
      }

      if (mutationRows.length > 0) {
        await prisma.operationMutation.updateMany({
          where: {
            shop,
            operationId: executionId,
            shopifyBulkOperationId: null,
          },
          data: {
            shopifyBulkOperationId: result.bulkOperationId,
          },
        });
      }

      await bulkEditHistoryRepository.applyProjectionUpdate({
        where: {
          id: historyId,
          shop,
          undoExecutionIdentity: executionId,
        },
        data: {
          bulkOperationId: result.bulkOperationId,
          processingBatchId: `${undo.executionIdentity || historyId}:${batchData.lastSnapshotOrdinal || "start"}`,
          batch: {
            ...batch,
            hasMore: batchData.hasMore,
            currentBatchTargetCount: result.count,
          },
          undo: {
            ...undo,
            status: "processing",
            state: BULK_UNDO_STATES.AWAITING_SHOPIFY,
            bulkOperationId: result.bulkOperationId,
          },
        },
      });

      logger.info("Bulk undo worker queued Shopify bulk mutation", {
        worker: WORKER_NAME,
        queue: QUEUE_NAME,
        jobId: job.id,
        shop,
        historyId,
        executionId: executionId || undo.executionIdentity || null,
        attempt,
        source,
        bulkOperationId: result.bulkOperationId,
      });

      return {
        success: true,
        shop,
        historyId,
        bulkOperationId: result.bulkOperationId,
      };
    } catch (error) {
      if (executionId && !isRetryableError(error)) {
        await bulkUndoExecutionRepository.markFailed({
          shop,
          executionIdentity: executionId,
          errorMessage: error.message,
        }).catch(() => {});
      }

      const existing = await prisma.editHistory.findFirst({
        where: {
          id: historyId,
          shop,
        },
        select: { undo: true },
      }).catch(() => null);

      if (existing) {
        const undo = normalizeUndoState(existing.undo);
        await bulkEditHistoryRepository.applyProjectionUpdate({
          where: {
            id: historyId,
            shop,
            undoExecutionIdentity: executionId,
          },
          data: {
            undo: {
              ...undo,
              ...(isRetryableError(error)
                ? {
                    status: "pending",
                    state: BULK_UNDO_STATES.QUEUED,
                  }
                : {
                    status: "failed",
                    state: BULK_UNDO_STATES.FAILED,
                    completedAt: new Date(),
                    error: buildExecutionError({
                      code: error.code || "bulk_undo_worker_failure",
                      stage: "queue_execution",
                      message: error.message,
                      retryable: false,
                      details: {
                        attempt,
                        source,
                        executionId,
                      },
                    }),
                  }),
            },
          },
        }).catch(() => {});
      }

      await clearKeyCaches(`${shop}:fetchHistories`);
      await clearKeyCaches(`${shop}:historyDetails:${historyId}`);

      await recordMirrorAnomaly({
        shop,
        severity: "high",
        type: "bulk_undo_worker_failure",
        entityType: "editHistory",
        entityId: historyId,
        message: error.message,
        details: {
          worker: WORKER_NAME,
          queue: QUEUE_NAME,
          jobId: job?.id || null,
          attempt,
          source,
          executionId,
          retryable: isRetryableError(error),
        },
      }).catch(() => {});

      await logWorkerError({
        shop,
        err: error,
        source: "BulkUndoWorker",
        metadata: {
          queue: QUEUE_NAME,
          worker: WORKER_NAME,
          jobId: job?.id || null,
          historyId,
          attempt,
          source,
          executionId,
          retryable: isRetryableError(error),
        },
      });

      throw toUnrecoverableIfNonRetryable(error);
    } finally {
      await releaseExclusiveShopWork(shopLockKey);
    }
  },
  { connection, concurrency: 1 },
);

bulkUndoWorker.on("failed", async (job, error) => {
  logger.error("Bulk undo worker failed", {
    worker: WORKER_NAME,
    queue: QUEUE_NAME,
    jobId: job?.id,
    shop: job?.data?.shop,
    undoRequestId: job?.data?.undoRequestId || null,
    undoExecutionPlanId: job?.data?.undoExecutionPlanId || null,
    attempt: getJobAttempt(job),
    message: error.message,
  });

  if (isRetryExhausted(job)) {
    await addDeadLetterJob("bulk_undo_failed", {
      job,
      error,
      reason: "bulk_undo_retries_exhausted",
    }).catch(() => {});

    await recordRetryExhausted({
      job,
      shop: job?.data?.shop,
      worker: WORKER_NAME,
      queue: QUEUE_NAME,
      entityType: "undoRequest",
      entityId: job?.data?.undoRequestId || null,
      executionId: job?.data?.undoExecutionPlanId || null,
      message: "Bulk undo worker exhausted retries",
      details: {
        source: job?.data?.source || null,
      },
    });
  }
});

export default bulkUndoWorker;
