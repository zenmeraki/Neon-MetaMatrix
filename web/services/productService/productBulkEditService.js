import crypto from "crypto";
import os from "os";
import shopify from "../../shopify.js";
import { uploadToShopifyStagedTarget } from "../../utils/productBulkEditUtils.js";
import {
  bulkOperationMutation,
  getProductSetMutation,
  PRODUCT_SET_MODE,
  stagesUploadMutation,
} from "../../helpers/productBulkOperationHelpers/mutationTemplates.js";
import { getUpdatedProducts } from "../../helpers/productBulkOperationHelpers/productUpdateHandler.js";
import { addbulkEditJob } from "../../Jobs/Queues/bulkEditJob.js";
import CacheService from "../../utils/cacheService.js";
import { createMultiLanguageForFileEdit } from "../../utils/googleTranslator.js";
import { FIELD_TRANSLATIONS } from "../../Config/constants.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { runWorkerTask } from "../../utils/runWorkerTask.js";
import { isVariantLevelField as isVariantLevelBulkField } from "../../helpers/productBulkOperationHelpers/constants.js";
import { prisma } from "../../config/database.js";
import { LOCK_NS } from "../../constants/lockNamespaces.js";
import { OPERATION_TYPES } from "../../constants/operationTypes.js";
import { bulkEditHistoryRepository } from "../../repositories/bulkEditHistoryRepository.js";
import { storeOperationRepository } from "../../repositories/storeOperationRepository.js";
import { storeOperationalStateRepository } from "../../repositories/storeOperationalStateRepository.js";
import { targetSnapshotSetRepository } from "../../repositories/targetSnapshotSetRepository.js";
import { operationEventRepository } from "../../repositories/operationEventRepository.js";
import { storeExecutionPolicyService } from "../execution/storeExecutionPolicyService.js";
import {
  acquireShopLocks,
  releaseShopLocks,
} from "../execution/storeMultiLockService.js";
import {
  cloneFrozenTargetSnapshot,
  freezeTargetSnapshot,
  getFrozenTargetSnapshotSummary,
  getFrozenTargetProductIds,
  markPreviewExecutionMismatch,
  resolveCanonicalProductTarget,
} from "./productTargetingService.js";
import {
  BULK_EDIT_EXECUTION_STATES,
  buildPlannedUndoState,
} from "../bulkEditExecutionStateService.js";
import {
  buildBulkEditIdempotencyKey,
  stableHash,
} from "../../utils/idempotencyKey.js";
import { assertWriteInvariant } from "../execution/writeInvariantService.js";
import { validateBulkEditPayload } from "../../validations/bulkEditPayloadValidator.js";
import { featureFlags } from "../featureFlagService.js";

const OPTION_NAME_FIELDS = new Set([
  "option1Name",
  "option2Name",
  "option3Name",
  "mixed",
]);
const PREPARATION_WORKER_PRODUCT_THRESHOLD = Math.max(
  Number(process.env.BULK_EDIT_PREPARATION_WORKER_THRESHOLD || 20) || 20,
  1
);
const PREPARATION_WORKER_CHUNK_SIZE = Math.max(
  Number(process.env.BULK_EDIT_PREPARATION_WORKER_CHUNK_SIZE || 20) || 20,
  1
);
const PREPARATION_WORKER_MAX_THREADS = Math.max(
  Number(process.env.BULK_EDIT_PREPARATION_WORKER_MAX_THREADS || 4) || 4,
  1
);

function isVariantLevelField(field) {
  return isVariantLevelBulkField(field);
}

function buildProductInclude(fields = []) {
  if (
    fields.some(
      (field) => isVariantLevelField(field) || OPTION_NAME_FIELDS.has(field)
    )
  ) {
    return {
      variants: true,
    };
  }

  return undefined;
}

function normalizeField(field) {
  if (!field) return field;

  const map = {
    compare_at_price: "compareAtPrice",
    compareatprice: "compareAtPrice",
    option1values: "option1Values",
    option2values: "option2Values",
    option3values: "option3Values",
  };

  const key = field.toString().trim();

  return map[key] || key;
}
function determineMutationMode(fields = []) {
  const normalizedFields = Array.isArray(fields) ? fields.filter(Boolean) : [];
  const includesDelete = normalizedFields.includes("deleteProducts");
  const includesVariant = normalizedFields.some((field) =>
    isVariantLevelField(field)
  );
  const includesProduct = normalizedFields.some(
    (field) => !isVariantLevelField(field) && field !== "deleteProducts"
  );
  const includesOptionNames = normalizedFields.some((field) =>
    OPTION_NAME_FIELDS.has(field)
  );

  if (includesDelete) {
    return PRODUCT_SET_MODE.PRODUCT_DELETE;
  }

  if (includesOptionNames || (includesProduct && includesVariant)) {
    return PRODUCT_SET_MODE.BOTH;
  }

  if (includesVariant) {
    return PRODUCT_SET_MODE.VARIANT_ONLY;
  }

  return PRODUCT_SET_MODE.PRODUCT_ONLY;
}

function normalizeMirrorProductForPreview(rawProduct) {
  const options = Array.isArray(rawProduct?.options)
    ? rawProduct.options
    : Array.isArray(rawProduct?.optionsJson)
    ? rawProduct.optionsJson
    : [];

  const variants = Array.isArray(rawProduct?.variants)
    ? rawProduct.variants.map((variant) => ({
        ...variant,
        selectedOptions: Array.isArray(variant?.selectedOptions)
          ? variant.selectedOptions
          : Array.isArray(variant?.selectedOptionsJson)
          ? variant.selectedOptionsJson
          : [],
      }))
    : [];

  return {
    ...rawProduct,
    descriptionHtml: rawProduct.descriptionHtml ?? null,
    descriptionText: rawProduct.descriptionText ?? null,
    description: rawProduct.descriptionHtml ?? rawProduct.descriptionText ?? "",
    options,
    variants,
    seo: {
      title: rawProduct?.seo?.title ?? rawProduct?.seoTitle ?? "",
      description:
        rawProduct?.seo?.description ?? rawProduct?.seoDescription ?? "",
    },
    category:
      rawProduct?.category ??
      (rawProduct?.categoryId || rawProduct?.categoryName
        ? {
            id: rawProduct.categoryId ?? null,
            name: rawProduct.categoryName ?? "",
          }
        : null),
    collections: Array.isArray(rawProduct?.collections)
      ? rawProduct.collections
      : Array.isArray(rawProduct?.collectionsJson)
      ? rawProduct.collectionsJson
      : [],
    featuredMedia:
      rawProduct?.featuredMedia ??
      (rawProduct?.featuredImageUrl
        ? {
            preview: {
              image: {
                url: rawProduct.featuredImageUrl,
              },
            },
          }
        : null),
  };
}

function normalizeMirrorVariantForPreview(variant) {
  return {
    ...variant,
    selectedOptions: Array.isArray(variant?.selectedOptions)
      ? variant.selectedOptions
      : Array.isArray(variant?.selectedOptionsJson)
      ? variant.selectedOptionsJson
      : [],
  };
}

function groupFallbackVariantsByProduct(variants) {
  const grouped = new Map();

  for (const variant of variants) {
    const productId = variant?.productId;
    if (!productId) continue;

    const bucket = grouped.get(productId) || new Map();
    const batchKey = variant?.mirrorBatchId || "legacy";
    const items = bucket.get(batchKey) || [];
    items.push(normalizeMirrorVariantForPreview(variant));
    bucket.set(batchKey, items);
    grouped.set(productId, bucket);
  }

  const resolved = new Map();
  for (const [productId, batches] of grouped.entries()) {
    if (batches.has("legacy")) {
      resolved.set(productId, batches.get("legacy"));
      continue;
    }

    const [firstBatchVariants] = batches.values();
    resolved.set(productId, firstBatchVariants || []);
  }

  return resolved;
}

async function hydrateMissingVariantsForProducts(
  products,
  shop,
  mirrorBatchId = null
) {
  const list = Array.isArray(products) ? products : [];
  const missingProductIds = list
    .filter(
      (product) =>
        Array.isArray(product?.variants) && product.variants.length === 0
    )
    .map((product) => product.id)
    .filter(Boolean);

  if (!missingProductIds.length) {
    return list;
  }

  const fallbackVariants = await prisma.variant.findMany({
    where: {
      shop,
      productId: { in: missingProductIds },
      ...(mirrorBatchId ? { mirrorBatchId } : {}),
    },
    orderBy: [{ productId: "asc" }, { position: "asc" }],
  });

  if (!fallbackVariants.length) {
    return list;
  }

  const fallbackByProduct = groupFallbackVariantsByProduct(fallbackVariants);

  return list.map((product) => {
    if (!Array.isArray(product?.variants) || product.variants.length > 0) {
      return product;
    }

    const fallback = fallbackByProduct.get(product.id);
    if (!fallback?.length) {
      return product;
    }

    return {
      ...product,
      variants: fallback,
    };
  });
}

function normalizeRules(body) {
  const {
    editedType,
    editedField,
    value,
    searchKey,
    replaceText,
    supportValue,
    rules: explicitRules,
    locationId,
  } = body;

  if (Array.isArray(explicitRules) && explicitRules.length > 0) {
    return explicitRules;
  }

  return [
    {
      field: editedField,
      value,
      editOption: editedType,
      searchKey,
      replaceText,
      supportValue,
      locationId: locationId ?? null,
    },
  ];
}

function chunkArray(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function yieldToEventLoop() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function normalizeMirrorProductForExecution(rawProduct) {
  return {
    ...rawProduct,
    descriptionHtml: rawProduct.descriptionHtml ?? null,
    descriptionText: rawProduct.descriptionText ?? null,
    description: rawProduct.descriptionHtml ?? rawProduct.descriptionText ?? "",
    options: Array.isArray(rawProduct.options)
      ? rawProduct.options
      : Array.isArray(rawProduct.optionsJson)
      ? rawProduct.optionsJson
      : [],
    variants: Array.isArray(rawProduct.variants)
      ? rawProduct.variants.map((variant) => ({
          ...variant,
          selectedOptions: Array.isArray(variant.selectedOptions)
            ? variant.selectedOptions
            : Array.isArray(variant.selectedOptionsJson)
            ? variant.selectedOptionsJson
            : [],
        }))
      : [],
  };
}

function shouldUsePreparationWorkers(productCount, ruleCount) {
  return productCount >= PREPARATION_WORKER_PRODUCT_THRESHOLD && ruleCount > 0;
}

function getPreparationWorkerCount(chunkCount) {
  const hostParallelism =
    typeof os.availableParallelism === "function"
      ? os.availableParallelism()
      : os.cpus().length;

  return Math.max(
    1,
    Math.min(
      chunkCount,
      PREPARATION_WORKER_MAX_THREADS,
      Math.max(hostParallelism - 1, 1)
    )
  );
}

async function processBulkPreparationInline({
  products,
  rules,
  historyId,
  shop,
  batchId,
}) {
  const formattedProducts = [];
  const changes = [];

  for (
    let productIndex = 0;
    productIndex < products.length;
    productIndex += 1
  ) {
    if (productIndex > 0 && productIndex % 10 === 0) {
      await yieldToEventLoop();
    }

    const product = normalizeMirrorProductForExecution(products[productIndex]);

    for (const rule of rules) {
      const result = getUpdatedProducts({
        product,
        field: rule.field,
        editType: rule.editOption,
        value: rule.value,
        searchKey: rule.searchKey,
        replaceText: rule.replaceText,
        supportValue: rule.supportValue,
        changes,
        historyId,
        shop,
        batchId,
      });

      if (result) {
        formattedProducts.push(result);
      }
    }
  }

  return {
    formattedProducts,
    changes,
  };
}

async function processBulkPreparationWithWorkers({
  products,
  rules,
  historyId,
  shop,
  batchId,
}) {
  const productChunks = chunkArray(products, PREPARATION_WORKER_CHUNK_SIZE);
  const chunkResults = new Array(productChunks.length);
  const workerUrl = new URL(
    "./workers/bulkEditPreparationWorker.js",
    import.meta.url
  );
  const concurrency = getPreparationWorkerCount(productChunks.length);

  async function runChunk(index) {
    chunkResults[index] = await runWorkerTask(
      workerUrl,
      {
        products: productChunks[index],
        rules,
        historyId,
        shop,
        batchId,
      },
      {
        timeoutMs: 60_000,
      }
    );
  }

  for (let start = 0; start < productChunks.length; start += concurrency) {
    const batch = [];

    for (
      let offset = 0;
      offset < concurrency && start + offset < productChunks.length;
      offset += 1
    ) {
      batch.push(runChunk(start + offset));
    }

    await Promise.all(batch);
  }

  return {
    formattedProducts: chunkResults.flatMap(
      (result) => result?.formattedProducts || []
    ),
    changes: chunkResults.flatMap((result) => result?.changes || []),
  };
}

async function buildHistoryTitle(rules) {
  const updatedTitle = rules
    .map((rule) =>
      getUpdatedProducts({
        field: rule.field,
        editType: rule.editOption,
        value: rule.value,
        supportValue: rule.supportValue,
        searchKey: rule.searchKey,
        replaceText: rule.replaceText,
        returnTitleOnly: true,
      })
    )
    .filter(Boolean)
    .join(" + ");

  return createMultiLanguageForFileEdit(updatedTitle || "Bulk edit");
}

export default class ProductBulkService {
  constructor(session) {
    this.client = new shopify.api.clients.Graphql({ session });
    this.session = session;
  }

  async bulkEditProducts(req) {
    let lockResult = null;
    let operation = null;

    try {
      if (featureFlags.newBulkEngine) {
        console.log("[feature:newBulkEngine] using guarded bulk edit pipeline", {
          shop: this.session.shop,
        });
      }

      const historyData = await this._bulkOperationEdit(
        req.body,
        req.subscription || {}
      );

      const targetHash = stableHash({
        queryFilter: historyData.queryFilter,
        targetMirrorBatchId: historyData.targetMirrorBatchId,
        totalItems: historyData.totalItems,
        sourceTargetSnapshotId: historyData.batch?.sourceTargetSnapshotId || null,
      });
      const clientRequestId =
        req.body?.clientRequestId ||
        req.body?.requestId ||
        historyData.executionIdentity;
      const idempotencyKey = buildBulkEditIdempotencyKey({
        shop: historyData.shop,
        userId: req.body?.userId || req.body?.user || null,
        targetHash,
        editPayload: historyData.rules,
        clientRequestId,
      });
      const existingOperation =
        await storeOperationRepository.findByIdempotencyKey(idempotencyKey);

      if (existingOperation?.editHistoryId) {
        const existingHistory = await prisma.editHistory.findFirst({
          where: {
            id: existingOperation.editHistoryId,
            shop: historyData.shop,
          },
        });

        if (existingHistory) {
          return existingHistory;
        }
      }

      if (existingOperation) {
        return existingOperation;
      }

      const policy = await storeExecutionPolicyService.canStartOperation({
        shop: historyData.shop,
        operationType: OPERATION_TYPES.BULK_EDIT,
      });

      if (!policy.allowed) {
        const error = new Error(policy.message);
        error.code = policy.reason;
        throw error;
      }

      lockResult = await acquireShopLocks(historyData.shop, [
        LOCK_NS.WRITE_CATALOG,
        LOCK_NS.BULK_EDIT_WRITE,
      ]);

      if (!lockResult.acquired) {
        const error = new Error("Another operation is already running.");
        error.code = "LOCK_HELD";
        throw error;
      }

      const now = new Date();
      const operationalState =
        await storeOperationalStateRepository.getOrCreate(historyData.shop);
      operation = await storeOperationRepository.create({
        shop: historyData.shop,
        type: OPERATION_TYPES.BULK_EDIT,
        status: "RUNNING",
        requestedBy: req.body?.userId || req.body?.user || null,
        source: "MANUAL",
        lockKey: lockResult.locks?.map((lock) => lock.key).join(",") || null,
        idempotencyKey,
        targetHash,
        catalogBatchId: operationalState.activeCatalogBatchId,
        productBatchId: operationalState.activeProductBatchId,
        variantBatchId: operationalState.activeVariantBatchId,
        collectionBatchId: operationalState.activeCollectionBatchId,
        mirrorBatchId: historyData.targetMirrorBatchId,
        totalTargets: historyData.totalItems,
        startedAt: now,
        heartbeatAt: now,
      });

      await storeOperationalStateRepository.setActiveWrite(
        historyData.shop,
        operation.id,
      );

      assertWriteInvariant({
        operation,
        lockResult,
        idempotencyKey,
        snapshotFrozen: Boolean(historyData.batch?.frozen),
      });

      await operationEventRepository.emit({
        shop: historyData.shop,
        operationId: operation.id,
        type: "OPERATION_STARTED",
        payload: {
          operationType: OPERATION_TYPES.BULK_EDIT,
          source: "MANUAL",
        },
      });

      const history = await prisma.editHistory.create({
        data: {
          ...historyData,
          batch: {
            ...historyData.batch,
            operationId: operation.id,
          },
        },
      });

      await storeOperationRepository.updateById(operation.id, {
        editHistoryId: history.id,
      });

      const frozenCount = await this.freezeEditHistoryTargets(history.id);
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
          targetCount: frozenCount,
        },
      });

      const queued = await bulkEditHistoryRepository.movePlannedToQueued({
        id: history.id,
        shop: history.shop,
        totalItems: frozenCount,
        targetSnapshotCount: frozenCount,
      });

      await clearKeyCaches(`${history.shop}:fetchHistories`);

      await addbulkEditJob({
        historyId: history.id,
        shop: history.shop,
        source: "manual_bulk_edit",
        executionId: history.executionIdentity,
        operationId: operation.id,
      });

      return prisma.editHistory.findUnique({
        where: { id: history.id },
      });
    } catch (error) {
      if (operation?.id) {
        await storeOperationRepository.fail(operation.id, {
          errorCode: error.code || "BULK_EDIT_START_FAILED",
          errorMessage: error.message,
        });

        await storeOperationalStateRepository.clearActiveWrite(
          operation.shop,
          operation.id,
        );
      }

      throw error;
    } finally {
      if (lockResult?.locks) {
        await releaseShopLocks(lockResult.locks);
      }
    }
  }

  async _bulkOperationEdit(body, subscription) {
    validateBulkEditPayload(body);

    const {
      editedField,
      filterParams,
      queryWhere,
      productIds,
      targetSnapshotId,
      title: explicitTitle,
    } = body;

    const rules = normalizeRules(body);
    const normalizedTargetSnapshotId =
      typeof targetSnapshotId === "string" ? targetSnapshotId.trim() : "";
    const usesFrozenTarget = Boolean(normalizedTargetSnapshotId);
    const resolvedTarget = normalizedTargetSnapshotId
      ? await getFrozenTargetSnapshotSummary({
          ownerType: "AD_HOC_PRODUCT_TARGET",
          ownerId: normalizedTargetSnapshotId,
          shop: this.session.shop,
        })
      : await resolveCanonicalProductTarget({
          shop: this.session.shop,
          filterParams,
          explicitWhere: queryWhere,
          explicitProductIds: Array.isArray(productIds) ? productIds : [],
          queryParams: {
            page: 1,
            limit: 20,
          },
          sampleLimit: 20,
        });

    const count = resolvedTarget.count;
    const store = await prisma.store.findUnique({
      where: { shopUrl: this.session.shop },
      select: { storeTotalProducts: true },
    });
    const storeTotalProducts = Number(store?.storeTotalProducts || 0);
    const isWholeCatalogTarget =
      storeTotalProducts > 0 && count >= storeTotalProducts;

    if (
      isWholeCatalogTarget &&
      String(body.allProductsConfirmation || "") !== "CONFIRM"
    ) {
      throw new Error(
        'You are about to change ALL products. Type "CONFIRM" to proceed.'
      );
    }

    const limit = subscription?.limit || 100;
    const planName = subscription?.planName || "Free Plan";
    const isUnlimited = subscription?.isUnlimited || false;

    if (!isUnlimited && count > limit) {
      throw new Error(
        `Your current plan (${planName}) allows editing up to ${limit} products at a time. You are trying to edit ${count} products. Please upgrade your plan or reduce the number of products.`
      );
    }

    const title = explicitTitle || (await buildHistoryTitle(rules));

    return {
      shop: this.session.shop,
      title,
      queryFilter: JSON.stringify(
        usesFrozenTarget ? {} : resolvedTarget.where || {}
      ),
      rules,
      startedAt: new Date(),
      status: "pending",
      executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
      executionIdentity: crypto.randomUUID(),
      processedCount: 0,
      totalItems: count,
      targetSnapshotCount: 0,
      targetMirrorBatchId: resolvedTarget.mirrorBatchId,
      durationMs: 0,
      batch: {
        frozen: true,
        hasMore: count > 0,
        lastProductId: null,
        size: 75,
        previewCount: count,
        currentBatchTargetCount: 0,
        queuedAt: new Date().toISOString(),
        sourceTargetSnapshotId: normalizedTargetSnapshotId || null,
      },
      ...(editedField === "inventory" && { locationId: body.locationId }),
      undo: buildPlannedUndoState({
        allowed: editedField !== "deleteProducts",
      }),
    };
  }

  async freezeEditHistoryTargets(historyId) {
    const history = await prisma.editHistory.findUnique({
      where: { id: historyId },
      select: {
        shop: true,
        queryFilter: true,
        targetMirrorBatchId: true,
        batch: true,
      },
    });

    if (!history) {
      throw new Error("Edit history not found");
    }

    const sourceTargetSnapshotId =
      typeof history.batch?.sourceTargetSnapshotId === "string"
        ? history.batch.sourceTargetSnapshotId.trim()
        : "";

    if (sourceTargetSnapshotId) {
      const cloned = await cloneFrozenTargetSnapshot({
        sourceOwnerType: "AD_HOC_PRODUCT_TARGET",
        sourceOwnerId: sourceTargetSnapshotId,
        targetOwnerType: "EDIT_HISTORY",
        targetOwnerId: historyId,
        shop: history.shop,
      });

      return cloned.count;
    }

    const where = JSON.parse(history.queryFilter || "{}");
    const frozenCount = await freezeTargetSnapshot({
      ownerType: "EDIT_HISTORY",
      ownerId: historyId,
      shop: history.shop,
      where,
      mirrorBatchId: history.targetMirrorBatchId,
    });

    const previewCount = history.batch?.previewCount ?? null;
    if (previewCount !== null && Number(previewCount) !== Number(frozenCount)) {
      await markPreviewExecutionMismatch({
        shop: history.shop,
        ownerType: "EDIT_HISTORY",
        ownerId: historyId,
        previewCount: Number(previewCount),
        frozenCount,
      });
    }

    return frozenCount;
  }

  async _bulkOperationHelper({ formattedProducts, field, fields = [] }) {
    try {
      const operationName = `bulkEditProducts_${Date.now()}`;
      const mode = determineMutationMode(fields.length ? fields : [field]);

      const stagedRes = await this.client.query({
        data: {
          query: stagesUploadMutation,
          variables: {
            input: [
              {
                filename: operationName,
                mimeType: "text/jsonl",
                resource: "BULK_MUTATION_VARIABLES",
                httpMethod: "POST",
              },
            ],
          },
        },
      });

      const userErrors = stagedRes?.body?.data?.stagedUploadsCreate?.userErrors;
      if (userErrors?.length) {
        throw new Error(
          `Shopify API returned errors: ${JSON.stringify(userErrors)}`
        );
      }

      const target =
        stagedRes?.body?.data?.stagedUploadsCreate?.stagedTargets?.[0];

      if (!target) {
        throw new Error("Failed to get staged upload target from Shopify");
      }

      const keyUrl = await uploadToShopifyStagedTarget(
        target,
        formattedProducts
      );

      const bulkRes = await this.client.query({
        data: {
          query: bulkOperationMutation,
          variables: {
            mutation: getProductSetMutation(mode),
            stagedUploadPath: keyUrl,
          },
        },
      });

      const bulkErrors =
        bulkRes?.body?.data?.bulkOperationRunMutation?.userErrors;

      if (bulkErrors?.length) {
        throw new Error(
          `Bulk operation returned errors: ${JSON.stringify(bulkErrors)}`
        );
      }

      const result = bulkRes.body?.data?.bulkOperationRunMutation;

      await CacheService.set(`${this.session.shop}:PRODUCT_UPDATE`, {
        running: true,
      });

      return result;
    } catch (err) {
      throw new Error(err.message);
    }
  }

  async _preparingBulkOperation({ historyId }) {
    const history = await prisma.editHistory.findUnique({
      where: { id: historyId },
      select: {
        shop: true,
        batch: true,
        rules: true,
        targetMirrorBatchId: true,
        targetSnapshotCount: true,
        executionIdentity: true,
      },
    });

    if (!history) {
      throw new Error("Edit history not found");
    }

    const rules = Array.isArray(history.rules)
      ? history.rules.filter(Boolean)
      : [];
    if (!rules.length) {
      throw new Error("Edit rules not found");
    }

    const limit = history.batch?.size || 75;
    const cursorOrdinal = Number(history.batch?.lastOrdinal) || 0;
    const { rows, lastProductId, lastOrdinal, hasMore } =
      await getFrozenTargetProductIds({
        ownerType: "EDIT_HISTORY",
        ownerId: historyId,
        shop: history.shop,
        limit,
        cursorOrdinal,
      });

    if (!rows.length) {
      return {
        formattedProducts: "",
        changes: [],
        lastProductId: null,
        hasMore: false,
        batchId: crypto
          .createHash("sha1")
          .update(
            `${history.executionIdentity || historyId}:${
              cursorOrdinal || "start"
            }:empty`
          )
          .digest("hex"),
        batchTargetCount: 0,
      };
    }

    const fields = rules.map((rule) => rule.field).filter(Boolean);
    const include = buildProductInclude(fields);

    // After building include, if variants are included, filter by mirrorBatchId
    const safeInclude =
      include?.variants && history.targetMirrorBatchId
        ? {
            variants: { where: { mirrorBatchId: history.targetMirrorBatchId } },
          }
        : include;
    const orderedIds = rows.map((row) => row.productId);

    let products = await prisma.product.findMany({
      where: {
        shop: history.shop,
        id: { in: orderedIds },
        ...(history.targetMirrorBatchId
          ? { mirrorBatchId: history.targetMirrorBatchId }
          : {}),
      },
      ...(safeInclude ? { include: safeInclude } : {}), // ✅
    });

    const productsById = new Map(
      products.map((product) => [product.id, product])
    );
    const batchId = crypto
      .createHash("sha1")
      .update(
        `${history.executionIdentity || historyId}:${
          cursorOrdinal || "start"
        }:${lastOrdinal}:${rows.length}`
      )
      .digest("hex");
    const preparedProducts = orderedIds
      .map((productId) => productsById.get(productId))
      .filter(Boolean);
    const { formattedProducts, changes } = shouldUsePreparationWorkers(
      preparedProducts.length,
      rules.length
    )
      ? await processBulkPreparationWithWorkers({
          products: preparedProducts,
          rules,
          historyId,
          shop: history.shop,
          batchId,
        })
      : await processBulkPreparationInline({
          products: preparedProducts,
          rules,
          historyId,
          shop: history.shop,
          batchId,
        });

    return {
      formattedProducts: formattedProducts.join("\n"),
      changes,
      lastProductId,
      lastOrdinal,
      hasMore,
      batchId,
      batchTargetCount: orderedIds.length,
    };
  }

  async trackEditProducts({
    field,
    editType,
    editValue,
    filterParams,
    searchKey,
    replaceText,
    supportValue,
    targetSnapshotId,
    page = 1,
    limit = 20,
    lang,
    subscription = {},
  }) {
    try {
      const changes = [];
      field = normalizeField(field);

      const isVariant = isVariantLevelField(field);

      const normalizedTargetSnapshotId =
        typeof targetSnapshotId === "string" ? targetSnapshotId.trim() : "";
      const normalizedPage = Math.max(Number.parseInt(page, 10) || 1, 1);
      const normalizedLimit = Math.max(Number.parseInt(limit, 10) || 20, 1);
      const target = normalizedTargetSnapshotId
        ? await this.resolveFrozenPreviewTarget({
            targetSnapshotId: normalizedTargetSnapshotId,
            page: normalizedPage,
            limit: normalizedLimit,
          })
        : await resolveCanonicalProductTarget({
            shop: this.session.shop,
            filterParams,
            queryParams: { page: normalizedPage, limit: normalizedLimit },
            sampleLimit: normalizedLimit,
          });

      const productLimit = subscription?.limit || 100;
      const planName = subscription?.planName || "Free Plan";
      const isUnlimited = subscription?.isUnlimited || false;

      let subscriptionWarning = null;

      if (!isUnlimited) {
        if (target.count > productLimit) {
          subscriptionWarning = {
            type: "LIMIT_EXCEEDED",
            message: `Your current plan (${planName}) allows editing up to ${productLimit} products. You're trying to edit ${target.count} products. Please upgrade your plan or reduce the number of products.`,
          };
        } else if (target.count > productLimit * 0.8) {
          const remaining = productLimit - target.count;
          subscriptionWarning = {
            type: "APPROACHING_LIMIT",
            message: `You're editing ${target.count} products. Your plan allows ${productLimit} products per edit. ${remaining} products remaining.`,
          };
        }
      }

      // In trackEditProducts
      const include = isVariant
        ? {
            variants: target.mirrorBatchId
              ? { where: { mirrorBatchId: target.mirrorBatchId } }
              : true,
          }
        : undefined;
      const productIds = target.sampleProducts.map((product) => product.id);
      let products = await prisma.product.findMany({
        where: {
          shop: this.session.shop,
          id: { in: productIds },
          ...(target.mirrorBatchId
            ? { mirrorBatchId: target.mirrorBatchId }
            : {}),
        },
        ...(include ? { include } : {}),
      });

      const productMap = new Map(
        products.map((product) => [product.id, product])
      );
      const formattedProducts = [];

      for (
        let productIndex = 0;
        productIndex < target.sampleProducts.length;
        productIndex += 1
      ) {
        if (productIndex > 0 && productIndex % 10 === 0) {
          await yieldToEventLoop();
        }

        const targetProduct = target.sampleProducts[productIndex];
        const rawProduct = productMap.get(targetProduct.id);
        if (!rawProduct) continue;

        const product = normalizeMirrorProductForPreview(rawProduct);

        const result = getUpdatedProducts({
          product,
          field,
          editType,
          value: editValue,
          changes,
          searchKey,
          replaceText,
          supportValue,
          isTracking: true,
        });

        if (result) {
          formattedProducts.push(result);
        }
      }

      return {
        message: "tracking successful",
        data: {
          preview: formattedProducts,
          field: FIELD_TRANSLATIONS?.[field]?.[lang] || field,
          isVariant,
          mirrorBatchId: target.mirrorBatchId,
          pagination: target.pagination,
        },
        subscription: subscriptionWarning
          ? { warning: subscriptionWarning }
          : {},
      };
    } catch (err) {
      throw new Error(err.message || "Failed to track edit products");
    }
  }

  async resolveFrozenPreviewTarget({ targetSnapshotId, page = 1, limit = 20 }) {
    const normalizedPage = Math.max(Number.parseInt(page, 10) || 1, 1);
    const normalizedLimit = Math.max(Number.parseInt(limit, 10) || 20, 1);
    const summary = await getFrozenTargetSnapshotSummary({
      ownerType: "AD_HOC_PRODUCT_TARGET",
      ownerId: targetSnapshotId,
      shop: this.session.shop,
    });
    const frozenPage = await getFrozenTargetProductIds({
      ownerType: "AD_HOC_PRODUCT_TARGET",
      ownerId: targetSnapshotId,
      shop: this.session.shop,
      limit: normalizedLimit,
      cursorOrdinal: (normalizedPage - 1) * normalizedLimit,
    });

    return {
      count: summary.count,
      mirrorBatchId: summary.mirrorBatchId,
      sampleProducts: frozenPage.rows.map((row) => ({ id: row.productId })),
      pagination: {
        total: summary.count,
        page: normalizedPage,
        limit: normalizedLimit,
        totalPages: Math.ceil(summary.count / normalizedLimit),
        hasNextPage: frozenPage.hasMore,
        hasPrevPage: normalizedPage > 1,
      },
    };
  }
}
