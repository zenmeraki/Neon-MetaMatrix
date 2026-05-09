import crypto from "crypto";
import os from "os";
import shopify from "../../shopify.js";
import { uploadToShopifyStagedTarget } from "../../modules/bulkEdits/productBulkEditUtils.js";
import {
  bulkOperationMutation,
  getProductSetMutation,
  PRODUCT_SET_MODE,
  stagesUploadMutation,
} from "../../helpers/productBulkOperationHelpers/mutationTemplates.js";
import {
  compileProductBulkEdit,
  getUpdatedProducts,
} from "../../helpers/productBulkOperationHelpers/productUpdateHandler.js";
import { addbulkEditJob } from "../../jobs/queues/bulkEditJob.js";
import CacheService from "../../utils/cacheService.js";
import { createMultiLanguageForFileEdit } from "../../utils/googleTranslator.js";
import { FIELD_TRANSLATIONS } from "../../config/constants.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { runWorkerTask } from "../../utils/runWorkerTask.js";
import { isVariantLevelField as isVariantLevelBulkField } from "../../helpers/productBulkOperationHelpers/constants.js";
import { prisma } from "../../config/database.js";
import { OPERATION_TYPES } from "../../constants/operationTypes.js";
import { bulkEditHistoryRepository } from "../../repositories/bulkEditHistoryRepository.js";
import { storeOperationalStateRepository } from "../../repositories/storeOperationalStateRepository.js";
import { targetSnapshotSetRepository } from "../../repositories/targetSnapshotSetRepository.js";
import { operationEventRepository } from "../../repositories/operationEventRepository.js";
import { merchantOperationRepository } from "../../repositories/merchantOperationRepository.js";
import { storeExecutionPolicyService } from "../execution/storeExecutionPolicyService.js";
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
import { operationService } from "../operationService.js";
import { assertEditExecutionUsesFrozenTargets } from "../execution/frozenTargetInvariantService.js";
import { canonicalizeBulkEditIntent } from "../executionPlanner/canonicalizeBulkEditIntent.js";
import { bulkEditIntentRepository } from "../executionPlanner/bulkEditIntentRepository.js";
import { freezeImmutableSnapshotFromIntent } from "../executionPlanner/snapshotPlanner.js";

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
const DEFAULT_BULK_EDIT_PRODUCT_BATCH_SIZE = Math.max(
  Number(process.env.BULK_EDIT_PRODUCT_BATCH_SIZE || 75) || 75,
  1
);
const MAX_VARIANTS_PER_BULK_EDIT_BATCH = Math.max(
  Number(process.env.BULK_EDIT_MAX_VARIANTS_PER_BATCH || 5000) || 5000,
  1
);
const MAX_PREVIEW_LIMIT = 100;

function isVariantLevelField(field) {
  return isVariantLevelBulkField(field);
}

function assertRequiredMirrorBatchId(mirrorBatchId) {
  if (typeof mirrorBatchId !== "string" || !mirrorBatchId.trim()) {
    const error = new Error("MIRROR_BATCH_ID_REQUIRED_FOR_BULK_EDIT");
    error.code = "MIRROR_BATCH_ID_REQUIRED_FOR_BULK_EDIT";
    throw error;
  }

  return mirrorBatchId.trim();
}

function assertImmutableTargetSnapshotId(targetSnapshotId) {
  const normalized =
    typeof targetSnapshotId === "string" ? targetSnapshotId.trim() : "";
  if (!normalized) {
    const error = new Error("IMMUTABLE_TARGET_REQUIRED");
    error.code = "IMMUTABLE_TARGET_REQUIRED";
    error.statusCode = 409;
    throw error;
  }
  return normalized;
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

function isVariantSizedMutation(fields = []) {
  const normalizedFields = Array.isArray(fields) ? fields.filter(Boolean) : [];

  return normalizedFields.some(
    (field) => isVariantLevelField(field) || OPTION_NAME_FIELDS.has(field)
  );
}

function estimateVariantWeight(product) {
  if (Array.isArray(product?.variants)) {
    return Math.max(product.variants.length, 1);
  }

  const variantCount = Number(product?.variantCount);
  if (Number.isFinite(variantCount) && variantCount > 0) {
    return variantCount;
  }

  return 1;
}

function selectBatchRowsForMutation({ rows, productsById, fields }) {
  if (!isVariantSizedMutation(fields)) {
    return {
      selectedRows: rows,
      variantCount: 0,
      capped: false,
    };
  }

  const selectedRows = [];
  let variantCount = 0;

  for (const row of rows) {
    const product = productsById.get(row.productId);
    const nextVariantCount = estimateVariantWeight(product);

    if (
      selectedRows.length > 0 &&
      variantCount + nextVariantCount > MAX_VARIANTS_PER_BULK_EDIT_BATCH
    ) {
      break;
    }

    selectedRows.push(row);
    variantCount += nextVariantCount;
  }

  if (!selectedRows.length && rows.length) {
    const fallbackRow = rows[0];
    const fallbackProduct = productsById.get(fallbackRow.productId);
    selectedRows.push(fallbackRow);
    variantCount = estimateVariantWeight(fallbackProduct);
  }

  return {
    selectedRows,
    variantCount,
    capped: selectedRows.length < rows.length,
  };
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
    confirm,
  } = body;

  if (Array.isArray(explicitRules) && explicitRules.length > 0) {
    return explicitRules.map((rule) => ({
      ...rule,
      confirmedDangerousOperation:
        rule?.field !== "deleteProducts" || confirm === "DELETE",
    }));
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
      confirmedDangerousOperation:
        editedField !== "deleteProducts" || confirm === "DELETE",
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

function buildIntentId(intent) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(intent || {}))
    .digest("hex");
}

function buildMutationPlanHash({
  intentId,
  targetSnapshotId,
  mirrorBatchId,
  plannerFingerprint,
  plannerVersion,
}) {
  return stableHash({
    intentId: intentId || null,
    targetSnapshotId: targetSnapshotId || null,
    mirrorBatchId: mirrorBatchId || null,
    plannerFingerprint: plannerFingerprint || null,
    plannerVersion: Number.isInteger(plannerVersion) ? plannerVersion : null,
  });
}

function mergeById(existing = [], incoming = [], keyResolver) {
  const map = new Map();

  for (const item of existing) {
    const key = keyResolver(item);
    if (key) map.set(key, item);
  }

  for (const item of incoming) {
    const key = keyResolver(item);
    if (!key) continue;
    const prev = map.get(key);
    map.set(key, prev ? deepMergeMutationPayload(prev, item) : item);
  }

  return Array.from(map.values());
}

function deepMergeMutationPayload(base, next) {
  if (!base || typeof base !== "object") return next;
  if (!next || typeof next !== "object") return base;

  const merged = { ...base };

  for (const [key, value] of Object.entries(next)) {
    if (key === "id") {
      merged.id = value ?? merged.id;
      continue;
    }

    if (key === "variants" && Array.isArray(value)) {
      const current = Array.isArray(merged.variants) ? merged.variants : [];
      merged.variants = mergeById(current, value, (item) => item?.id);
      continue;
    }

    if (key === "productOptions" && Array.isArray(value)) {
      const current = Array.isArray(merged.productOptions)
        ? merged.productOptions
        : [];
      merged.productOptions = mergeById(
        current,
        value,
        (item) => item?.id || item?.name,
      );
      continue;
    }

    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      merged[key] &&
      typeof merged[key] === "object" &&
      !Array.isArray(merged[key])
    ) {
      merged[key] = deepMergeMutationPayload(merged[key], value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

function consolidateMutationLines(lines = []) {
  const aggregated = new Map();

  for (const line of lines) {
    if (typeof line !== "string" || !line.trim()) continue;

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      const error = new Error("INVALID_BULK_MUTATION_LINE");
      error.code = "INVALID_BULK_MUTATION_LINE";
      throw error;
    }

    const key = parsed?.productSet?.id || parsed?.id;
    if (!key) {
      const error = new Error("BULK_MUTATION_LINE_MISSING_PRODUCT_ID");
      error.code = "BULK_MUTATION_LINE_MISSING_PRODUCT_ID";
      throw error;
    }

    const previous = aggregated.get(key);
    if (!previous) {
      aggregated.set(key, parsed);
      continue;
    }

    // Delete payload wins over edits for the same product.
    if (parsed?.id && !parsed?.productSet) {
      aggregated.set(key, parsed);
      continue;
    }
    if (previous?.id && !previous?.productSet) {
      continue;
    }

    const merged = {
      productSet: deepMergeMutationPayload(previous.productSet || {}, parsed.productSet || {}),
    };
    aggregated.set(key, merged);
  }

  return Array.from(aggregated.values()).map((payload) => JSON.stringify(payload));
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

function shouldUsePreparationWorkers(productCount, ruleCount, fields = []) {
  if (isVariantSizedMutation(fields)) return false;
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

    const result = compileProductBulkEdit({
      product,
      rules,
      historyId,
      shop,
      batchId,
    });

    if (result?.formattedProduct) {
      formattedProducts.push(result.formattedProduct);
    }
    if (result?.changeRecord) {
      changes.push(result.changeRecord);
    }
  }

  return { formattedProducts, changes };
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

function mapIntentToRules(intent) {
  const operation = intent?.operation || {};
  const valuePayload = operation?.value || {};
  const valueType = valuePayload?.type || "RAW";

  if (valueType === "SEARCH_REPLACE") {
    return [
      {
        field: operation.field,
        editOption: operation.editType,
        value: "",
        searchKey: valuePayload.search || "",
        replaceText: valuePayload.replace || "",
        supportValue: null,
        locationId: operation.locationId || null,
      },
    ];
  }

  if (valueType === "ARRAY") {
    return [
      {
        field: operation.field,
        editOption: operation.editType,
        value: Array.isArray(valuePayload.items) ? valuePayload.items : [],
        searchKey: null,
        replaceText: null,
        supportValue: null,
        locationId: operation.locationId || null,
      },
    ];
  }

  return [
    {
      field: operation.field,
      editOption: operation.editType,
      value: valuePayload?.value ?? "",
      searchKey: null,
      replaceText: null,
      supportValue: null,
      locationId: operation.locationId || null,
    },
  ];
}

export default class ProductBulkService {
  constructor(session) {
    this.client = new shopify.api.clients.Graphql({ session });
    this.session = session;
  }

  async bulkEditProducts(req) {
    let operation = null;

    try {
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
      const existingOperation = await prisma.merchantOperation.findFirst({
        where: {
          shop: historyData.shop,
          idempotencyKey,
        },
        include: {
          editHistory: {
            select: { id: true },
          },
        },
      });

      if (existingOperation?.editHistory?.id) {
        const existingHistory = await prisma.editHistory.findFirst({
          where: {
            id: existingOperation.editHistory.id,
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

      const now = new Date();
      const { createdOperation, history } = await prisma.$transaction(async (tx) => {
        await storeOperationalStateRepository.getOrCreate(historyData.shop, tx);
        const createdOperation = await operationService.createOperation(
          {
            shop: historyData.shop,
            type: "BULK_EDIT",
            title: "Bulk edit",
            source: "MANUAL",
            idempotencyKey,
            targetHash,
            totalItems: Number(historyData.totalItems || 0),
            startedAt: now,
          },
          tx,
        );

        const history = await tx.editHistory.create({
          data: {
            ...historyData,
            batch: {
              ...historyData.batch,
              operationId: createdOperation.id,
            },
          },
        });
        await merchantOperationRepository.createForEditHistory(history, tx);
        await operationService.transitionOperation(
          {
            shop: historyData.shop,
            operationId: createdOperation.id,
            from: createdOperation.status,
            to: "SNAPSHOTTING",
            data: { startedAt: now },
          },
          tx,
        );

        await storeOperationalStateRepository.setActiveWrite(
          historyData.shop,
          createdOperation.id,
          tx,
        );

        return { createdOperation, history };
      });
      operation = createdOperation;

      const canonicalIntent = canonicalizeBulkEditIntent({
        shop: history.shop,
        filterParams:
          history?.summary?.bulkEditIntent?.target?.filterParams || [],
        actions: Array.isArray(history.rules) ? history.rules : [],
        activeMirrorBatchId: history.targetMirrorBatchId,
        stableSort:
          history?.summary?.bulkEditIntent?.target?.stableSort || {
            by: "ordinal",
            direction: "asc",
          },
        intentVersion: 1,
      });

      const persistedIntent = await bulkEditIntentRepository.createCanonicalIntent({
        shop: history.shop,
        operationId: operation.id,
        intentVersion: canonicalIntent.intentVersion || 1,
        mirrorBatchId: canonicalIntent.mirrorBatchId,
        filterAst: canonicalIntent.filterAst,
        actionAst: canonicalIntent.actionAst,
        stableSort: canonicalIntent.stableSort,
        canonicalIntentJson: canonicalIntent.canonicalIntentJson,
        canonicalFilterHash: canonicalIntent.canonicalFilterHash,
        canonicalActionHash: canonicalIntent.canonicalActionHash,
        intentHash: canonicalIntent.intentHash,
        plannerVersion: 1,
        compilerVersion: 1,
      });

      await freezeImmutableSnapshotFromIntent({
        shop: history.shop,
        operationId: operation.id,
        intentId: persistedIntent.id,
        mirrorBatchId: history.targetMirrorBatchId,
        filterAst: canonicalIntent.filterAst,
        actionAst: canonicalIntent.actionAst,
        filterHash: canonicalIntent.canonicalFilterHash,
        actionHash: canonicalIntent.canonicalActionHash,
        targetHash: canonicalIntent.intentHash,
        canonicalOrderBy: canonicalIntent.stableSort,
        plannerVersion: 1,
        compilerVersion: 1,
      });

      assertWriteInvariant({
        operation,
        lockResult: { acquired: true, locks: [] },
        idempotencyKey,
        snapshotFrozen: Boolean(historyData.batch?.frozen),
      });

      await operationEventRepository.emit({
        shop: historyData.shop,
        operationId: operation.id,
        type: "PREFLIGHT_PASSED",
        payload: {
          operationType: OPERATION_TYPES.BULK_EDIT,
          editHistoryId: history.id,
        },
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

      const frozenCount = await this.freezeEditHistoryTargets(history.id);
      await targetSnapshotSetRepository.materializeFromEditHistory({
        operationId: operation.id,
        shop: history.shop,
        historyId: history.id,
      });
      await operationService.transitionOperation({
        shop: history.shop,
        operationId: operation.id,
        from: "SNAPSHOTTING",
        to: "SNAPSHOTTED",
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

      return prisma.editHistory.findFirst({
        where: {
          id: history.id,
          shop: history.shop,
        },
      });
    } catch (error) {
      if (operation?.id) {
        const current = await prisma.merchantOperation.findFirst({
          where: { id: operation.id, shop: operation.shop },
          select: { status: true },
        });
        if (current && current.status !== "FAILED" && current.status !== "CANCELLED") {
          await operationService.transitionOperation({
            shop: operation.shop,
            operationId: operation.id,
            from: current.status,
            to: "FAILED",
            data: {
              failedAt: new Date(),
              errorCode: error.code || "BULK_EDIT_START_FAILED",
              errorMessage: error.message,
            },
          });
        }

        await storeOperationalStateRepository.clearActiveWrite(
          operation.shop,
          operation.id,
        );
      }

      throw error;
    }
  }

  async _bulkOperationEdit(body, subscription) {
    const intent = body?.intent || null;
    if (!intent) {
      const error = new Error("BULK_EDIT_INTENT_REQUIRED");
      error.code = "BULK_EDIT_INTENT_REQUIRED";
      error.statusCode = 400;
      throw error;
    }
    const intentOperation = intent?.operation || {};
    const intentId = buildIntentId(intent);
    const intentValue =
      intentOperation?.value && typeof intentOperation.value === "object"
        ? intentOperation.value
        : null;
    const resolvedField =
      intentOperation.field || body.editedField || body.field;
    const resolvedEditType =
      intentOperation.editType || body.editedType || body.editedBy || body.editType;
    const resolvedValue =
      intentValue?.type === "RAW"
        ? intentValue.value
        : intentValue?.type === "ARRAY"
        ? intentValue.items
        : body.value;
    const resolvedSearchKey =
      intentValue?.type === "SEARCH_REPLACE"
        ? intentValue.search
        : body.searchKey;
    const resolvedReplaceText =
      intentValue?.type === "SEARCH_REPLACE"
        ? intentValue.replace
        : body.replaceText;

    const normalizedBody = {
      ...body,
      editedField: resolvedField,
      editedType: resolvedEditType,
      value: resolvedValue,
      searchKey: resolvedSearchKey,
      replaceText: resolvedReplaceText,
      locationId: intentOperation.locationId || body.locationId,
    };

    validateBulkEditPayload(normalizedBody, { mode: "execute" });

    const {
      editedField,
      filterParams,
      targetSnapshotId,
      title: explicitTitle,
      __preflight,
    } = normalizedBody;

    if (editedField === "deleteProducts" && normalizedBody.confirm !== "DELETE") {
      const error = new Error("DELETE_CONFIRMATION_REQUIRED");
      error.code = "DELETE_CONFIRMATION_REQUIRED";
      throw error;
    }

    const rules = normalizeRules(normalizedBody);
    const normalizedTargetSnapshotId =
      assertImmutableTargetSnapshotId(targetSnapshotId);
    const resolvedTarget = await getFrozenTargetSnapshotSummary({
      ownerType: "AD_HOC_PRODUCT_TARGET",
      ownerId: normalizedTargetSnapshotId,
      shop: this.session.shop,
    });

    const count = resolvedTarget.count;
    const preflightFingerprint =
      typeof __preflight?.snapshotFingerprint === "string"
        ? __preflight.snapshotFingerprint
        : null;
    const preflightMirrorBatchId =
      typeof __preflight?.mirrorBatchId === "string"
        ? __preflight.mirrorBatchId
        : null;
    if (
      preflightMirrorBatchId &&
      preflightMirrorBatchId !== resolvedTarget.mirrorBatchId
    ) {
      const error = new Error("PREFLIGHT_SNAPSHOT_MISMATCH");
      error.code = "PREFLIGHT_SNAPSHOT_MISMATCH";
      throw error;
    }
    if (
      preflightFingerprint &&
      resolvedTarget?.plannerFingerprint &&
      preflightFingerprint !== resolvedTarget.plannerFingerprint
    ) {
      const error = new Error("PREFLIGHT_SNAPSHOT_FINGERPRINT_MISMATCH");
      error.code = "PREFLIGHT_SNAPSHOT_FINGERPRINT_MISMATCH";
      throw error;
    }
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
    const mutationPlanHash = buildMutationPlanHash({
      intentId,
      targetSnapshotId: normalizedTargetSnapshotId,
      mirrorBatchId: resolvedTarget.mirrorBatchId,
      plannerFingerprint: resolvedTarget?.plannerFingerprint || preflightFingerprint,
      plannerVersion:
        Number.isInteger(__preflight?.plannerVersion) ? __preflight.plannerVersion : null,
    });

    return {
      shop: this.session.shop,
      title,
      queryFilter: JSON.stringify({}),
      rules,
      startedAt: null,
      status: "pending",
      executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
      executionIdentity: crypto.randomUUID(),
      processedCount: 0,
      totalItems: count,
      targetSnapshotCount: 0,
      targetMirrorBatchId: assertRequiredMirrorBatchId(resolvedTarget.mirrorBatchId),
      durationMs: 0,
      batch: {
        frozen: false,
        hasMore: count > 0,
        lastProductId: null,
        lastOrdinal: 0,
        size: DEFAULT_BULK_EDIT_PRODUCT_BATCH_SIZE,
        previewCount: count,
        currentBatchTargetCount: 0,
        queuedAt: new Date().toISOString(),
        sourceTargetSnapshotId: normalizedTargetSnapshotId || null,
        previewSnapshotFingerprint: preflightFingerprint,
        previewCanonicalQueryHash:
          typeof __preflight?.canonicalQueryHash === "string"
            ? __preflight.canonicalQueryHash
            : null,
        previewPlannerVersion:
          Number.isInteger(__preflight?.plannerVersion)
            ? __preflight.plannerVersion
            : null,
        previewCanonicalOrderBy:
          __preflight?.canonicalOrderBy && typeof __preflight.canonicalOrderBy === "object"
            ? __preflight.canonicalOrderBy
            : null,
        intentId,
        mutationPlanHash,
      },
      summary: {
        intentId,
        mutationPlanHash,
        bulkEditIntent: intent,
      },
      ...(editedField === "inventory" && {
        locationId: normalizedBody.locationId,
      }),
      undo: buildPlannedUndoState({
        allowed: editedField !== "deleteProducts",
      }),
    };
  }

  async freezeEditHistoryTargets(historyId, db = prisma) {
    const history = await db.editHistory.findFirst({
      where: {
        id: historyId,
        shop: this.session.shop,
      },
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
      }, db);

      return cloned.count;
    }

    const where = JSON.parse(history.queryFilter || "{}");
    const mirrorBatchId = assertRequiredMirrorBatchId(history.targetMirrorBatchId);
    const frozenCount = await freezeTargetSnapshot({
      ownerType: "EDIT_HISTORY",
      ownerId: historyId,
      shop: history.shop,
      where,
      mirrorBatchId,
    }, db);

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
      const operationName = `bulkEditProducts_${this.session.shop}_${crypto.randomUUID()}`;
      const mode = determineMutationMode(fields.length ? fields : [field]);
      const jsonlLines = Array.isArray(formattedProducts)
        ? formattedProducts.filter((line) => typeof line === "string" && line.trim())
        : [];

      if (!jsonlLines.length) {
        const error = new Error("EMPTY_BULK_MUTATION_JSONL_PAYLOAD");
        error.code = "EMPTY_BULK_MUTATION_JSONL_PAYLOAD";
        throw error;
      }

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

      const jsonlPayload = `${jsonlLines.join("\n")}\n`;

      const keyUrl = await uploadToShopifyStagedTarget(
        target,
        jsonlPayload
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

      return {
        ...result,
        stagedUploadPath: keyUrl,
      };
    } catch (err) {
      throw err;
    }
  }

async _preparingBulkOperation({ historyId }) {
  await assertEditExecutionUsesFrozenTargets({
    shop: this.session.shop,
    historyId,
    phase: "bulk_edit_prepare_batch",
  });

  const history = await prisma.editHistory.findFirst({
    where: {
      id: historyId,
      shop: this.session.shop,
    },
    select: {
      shop: true,
      batch: true,
      rules: true,
      summary: true,
      targetMirrorBatchId: true,
      targetSnapshotCount: true,
      executionIdentity: true,
    },
  });

  if (!history) {
    throw new Error("Edit history not found");
  }

  const mirrorBatchId = assertRequiredMirrorBatchId(
    history.targetMirrorBatchId
  );

  const intent = history?.summary?.bulkEditIntent || null;

  const intentId =
    (typeof history?.summary?.intentId === "string" &&
      history.summary.intentId) ||
    buildIntentId(intent);

  const sourceTargetSnapshotId =
    typeof history?.batch?.sourceTargetSnapshotId === "string"
      ? history.batch.sourceTargetSnapshotId
      : null;

  const persistedMutationPlanHash =
    typeof history?.summary?.mutationPlanHash === "string"
      ? history.summary.mutationPlanHash
      : typeof history?.batch?.mutationPlanHash === "string"
      ? history.batch.mutationPlanHash
      : null;

  if (persistedMutationPlanHash) {
    const recomputedMutationPlanHash = buildMutationPlanHash({
      intentId,
      targetSnapshotId: sourceTargetSnapshotId,
      mirrorBatchId,
      plannerFingerprint:
        typeof history?.batch?.previewSnapshotFingerprint === "string"
          ? history.batch.previewSnapshotFingerprint
          : null,
      plannerVersion: Number.isInteger(
        history?.batch?.previewPlannerVersion
      )
        ? history.batch.previewPlannerVersion
        : null,
    });

    if (recomputedMutationPlanHash !== persistedMutationPlanHash) {
      const error = new Error("MUTATION_PLAN_HASH_MISMATCH");
      error.code = "MUTATION_PLAN_HASH_MISMATCH";
      throw error;
    }
  }

  if (!intent) {
    const error = new Error("BULK_EDIT_INTENT_REQUIRED");
    error.code = "BULK_EDIT_INTENT_REQUIRED";
    throw error;
  }

  const rules = mapIntentToRules(intent).filter(Boolean);

  if (!rules.length) {
    throw new Error("Edit rules not found");
  }

  const limit =
    history.batch?.size || DEFAULT_BULK_EDIT_PRODUCT_BATCH_SIZE;

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
      formattedProducts: [],
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
      batchVariantCount: 0,
    };
  }

  const fields = rules.map((rule) => rule.field).filter(Boolean);

  const include = buildProductInclude(fields);

  const safeInclude = include?.variants
    ? {
        variants: {
          where: {
            shop: history.shop,
            mirrorBatchId,
          },
        },
      }
    : undefined;

  const orderedIds = rows.map((row) => row.productId);

  const products = await prisma.product.findMany({
    where: {
      shop: history.shop,
      id: { in: orderedIds },
      mirrorBatchId,
    },
    ...(safeInclude ? { include: safeInclude } : {}),
  });

  const productsById = new Map(
    products.map((product) => [product.id, product])
  );

  const { selectedRows, variantCount, capped } =
    selectBatchRowsForMutation({
      rows,
      productsById,
      fields,
    });

  const selectedIds = selectedRows.map((row) => row.productId);

  const missingIds = selectedIds.filter(
    (id) => !productsById.has(id)
  );

  if (missingIds.length) {
    const error = new Error(
      "FROZEN_TARGET_PRODUCTS_MISSING_FROM_MIRROR"
    );

    error.code = "FROZEN_TARGET_PRODUCTS_MISSING_FROM_MIRROR";

    error.details = {
      missingCount: missingIds.length,
      sample: missingIds.slice(0, 10),
      mirrorBatchId,
    };

    throw error;
  }

  const selectedIdSet = new Set(selectedIds);

  const selectedLastRow =
    selectedRows[selectedRows.length - 1];

  const selectedHasMore = Boolean(hasMore || capped);

  const batchId = crypto
    .createHash("sha1")
    .update(
      `${history.executionIdentity || historyId}:${
        cursorOrdinal || "start"
      }:${selectedLastRow?.ordinal ?? lastOrdinal}:${
        selectedRows.length
      }`
    )
    .digest("hex");

  const preparedProducts = selectedIds
    .map((productId) => productsById.get(productId))
    .filter(Boolean);

  const { formattedProducts, changes } =
    shouldUsePreparationWorkers(
      preparedProducts.length,
      rules.length,
      fields
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
    formattedProducts,
    changes,
    lastProductId:
      selectedLastRow?.productId ?? lastProductId,
    lastOrdinal:
      selectedLastRow?.ordinal ?? lastOrdinal,
    hasMore: selectedHasMore,
    batchId,
    batchTargetCount: selectedIdSet.size,
    batchVariantCount: variantCount,
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
      const normalizedLimit = Math.min(
        Math.max(Number.parseInt(limit, 10) || 20, 1),
        MAX_PREVIEW_LIMIT
      );
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

      const include = isVariant
        ? {
            variants: {
              where: {
                shop: this.session.shop,
                ...(target.mirrorBatchId
                  ? { mirrorBatchId: target.mirrorBatchId }
                  : {}),
              },
            },
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
    const normalizedLimit = Math.min(
      Math.max(Number.parseInt(limit, 10) || 20, 1),
      MAX_PREVIEW_LIMIT
    );
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

    