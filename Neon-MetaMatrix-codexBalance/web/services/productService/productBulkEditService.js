import crypto from "crypto";
import fs from "fs";
import os from "os";
import shopify from "../../shopify.js";
import {
  uploadFileToShopifyStagedTarget,
  uploadToShopifyStagedTarget,
} from "../../utils/productBulkEditUtils.js";
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
import { bulkEditHistoryRepository } from "../../repositories/bulkEditHistoryRepository.js";
import { productMirrorRepository } from "../../repositories/productMirrorRepository.js";
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
import { compileBulkEditJsonl } from "./bulkEditJsonlCompiler.js";

const OPTION_NAME_FIELDS = new Set([
  "option1Name",
  "option2Name",
  "option3Name",
  "mixed",
]);
const DELETE_FIELD = "deleteProducts";
const DEFAULT_BATCH_SIZE = 75;
const MAX_PREVIEW_LIMIT = 100;
const MAX_RULES_PER_EDIT = 50;
const MAX_PRODUCTS_PER_PREPARATION_BATCH = 500;
const MAX_JSONL_LINES_PER_BATCH = 25_000;
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
const PREPARATION_WORKER_TIMEOUT_MS = Math.max(
  Number(process.env.BULK_EDIT_PREPARATION_WORKER_TIMEOUT_MS || 60_000) || 60_000,
  10_000
);

const FIELD_ALIASES = {
  compare_at_price: "compareAtPrice",
  compareatprice: "compareAtPrice",
  option1values: "option1Values",
  option2values: "option2Values",
  option3values: "option3Values",
};

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }

  return value.trim();
}

function assertShop(shop) {
  return assertNonEmptyString(shop, "shop");
}

function sanitizeError(error) {
  return error?.message || String(error || "Unknown error");
}

function safeJsonParse(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    throw new Error("INVALID_JSON_PAYLOAD");
  }
}

function normalizePositiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;

  return Math.min(parsed, max);
}

function isVariantLevelField(field) {
  return isVariantLevelBulkField(normalizeField(field));
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

  const key = field.toString().trim();

  return FIELD_ALIASES[key] || key;
}
function determineMutationMode(fields = []) {
  const normalizedFields = Array.isArray(fields)
    ? fields.map(normalizeField).filter(Boolean)
    : [];
  const includesDelete = normalizedFields.includes(DELETE_FIELD);
  const includesVariant = normalizedFields.some((field) =>
    isVariantLevelField(field)
  );
  const includesProduct = normalizedFields.some(
    (field) => !isVariantLevelField(field) && field !== DELETE_FIELD
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
  const explicitRules = Array.isArray(body?.rules) ? body.rules : null;
  const rules =
    explicitRules && explicitRules.length > 0
      ? explicitRules
      : [
          {
            field: body.editedField,
            value: body.value,
            editOption: body.editedType,
            searchKey: body.searchKey,
            replaceText: body.replaceText,
            supportValue: body.supportValue,
            locationId: body.locationId ?? null,
          },
        ];

  if (!rules.length) {
    throw new Error("At least one edit rule is required");
  }

  if (rules.length > MAX_RULES_PER_EDIT) {
    throw new Error(`Too many edit rules. Max allowed: ${MAX_RULES_PER_EDIT}`);
  }

  const normalized = rules.map((rule, index) => {
    if (!rule || typeof rule !== "object") {
      throw new Error(`Rule ${index + 1} must be an object`);
    }

    const field = normalizeField(rule.field);
    const editOption = assertNonEmptyString(
      rule.editOption ?? rule.editedType,
      `rule ${index + 1} editOption`
    );

    if (!field) {
      throw new Error(`Rule ${index + 1} field is required`);
    }

    if (field === "inventory" && !rule.locationId && !body.locationId) {
      throw new Error("Location ID is required for inventory edits");
    }

    return {
      ...rule,
      field,
      editOption,
      locationId: rule.locationId ?? body.locationId ?? null,
    };
  });

  const includesDelete = normalized.some((rule) => rule.field === DELETE_FIELD);

  if (includesDelete && normalized.length > 1) {
    throw new Error("deleteProducts cannot be combined with other edit rules");
  }

  return normalized;
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
  executionIdentity,
  mirrorBatchId,
}) {
  const formattedProducts = [];
  const changes = [];
  const errors = [];
  const skipped = [];

  for (
    let productIndex = 0;
    productIndex < products.length;
    productIndex += 1
  ) {
    if (productIndex > 0 && productIndex % 10 === 0) {
      await yieldToEventLoop();
    }

    const product = normalizeMirrorProductForExecution(products[productIndex]);

    for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex += 1) {
      const rule = rules[ruleIndex];
      const beforeChangesCount = changes.length;

      try {
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
          executionIdentity,
          mirrorBatchId,
        });

        if (result) {
          if (Array.isArray(result)) formattedProducts.push(...result);
          else formattedProducts.push(result);
        }

        if (!result && changes.length === beforeChangesCount) {
          skipped.push({
            productId: product.id,
            ruleIndex,
            reason: "NO_CHANGE",
          });
        }
      } catch (error) {
        changes.splice(beforeChangesCount);
        errors.push({
          productId: product.id,
          ruleIndex,
          message: sanitizeError(error),
        });
      }
    }
  }

  if (errors.length) {
    throw new Error(`Bulk preparation failed for ${errors.length} product/rule pairs`);
  }

  return {
    formattedProducts,
    changes,
    skipped,
    errors,
  };
}

async function processBulkPreparationWithWorkers({
  products,
  rules,
  historyId,
  shop,
  batchId,
  executionIdentity,
  mirrorBatchId,
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
        executionIdentity,
        mirrorBatchId,
      },
      {
        timeoutMs: PREPARATION_WORKER_TIMEOUT_MS,
      }
    );

    if (chunkResults[index]?.ok === false) {
      throw new Error(
        chunkResults[index]?.error?.message || "Preparation worker failed"
      );
    }

    chunkResults[index] = chunkResults[index]?.result || chunkResults[index];
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
    skipped: chunkResults.flatMap((result) => result?.skipped || []),
    errors: chunkResults.flatMap((result) => result?.errors || []),
  };
}

function serializeMutationLine(item) {
  if (!item) return null;

  if (typeof item === "string") {
    const trimmed = item.trim();
    if (!trimmed) return null;

    JSON.parse(trimmed);
    return trimmed;
  }

  if (typeof item === "object") {
    return JSON.stringify(item);
  }

  return null;
}

function serializeJsonlLines(items = []) {
  const lines = [];

  for (const item of items) {
    const line = serializeMutationLine(item);
    if (!line) continue;

    lines.push(line);

    if (lines.length > MAX_JSONL_LINES_PER_BATCH) {
      throw new Error("Prepared mutation payload exceeds batch line limit");
    }
  }

  return lines.join("\n");
}

function assertPreparedPayload(jsonl, batchTargetCount) {
  if (!jsonl || typeof jsonl !== "string" || !jsonl.trim()) {
    throw new Error("EMPTY_BULK_MUTATION_JSONL_PAYLOAD");
  }

  const lineCount = jsonl.split("\n").filter(Boolean).length;

  if (batchTargetCount > 0 && lineCount <= 0) {
    throw new Error("PREPARED_PAYLOAD_HAS_NO_LINES");
  }

  return lineCount;
}

function buildBatchId({ executionIdentity, historyId, cursorOrdinal, lastOrdinal, count }) {
  return crypto
    .createHash("sha256")
    .update(
      [
        executionIdentity || historyId,
        cursorOrdinal || "start",
        lastOrdinal || "none",
        count || 0,
      ].join(":")
    )
    .digest("hex");
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
    this.session = session;
    this.shop = assertShop(session?.shop);
    this.client = new shopify.api.clients.Graphql({ session });
  }

  async bulkEditProducts(req) {
    let history = null;

    try {
      const historyData = await this._bulkOperationEdit(
        req.body,
        req.subscription || {}
      );

      history = await bulkEditHistoryRepository.create(historyData);

      const frozenCount = await this.freezeEditHistoryTargets({
        historyId: history.id,
        shop: history.shop,
      });

      const queued = await bulkEditHistoryRepository.movePlannedToQueued({
        id: history.id,
        shop: history.shop,
        totalItems: frozenCount,
        targetSnapshotCount: frozenCount,
        now: new Date(),
      });

      if (!queued) {
        throw new Error("FAILED_TO_QUEUE_BULK_EDIT_HISTORY");
      }

      await addbulkEditJob({
        historyId: history.id,
        shop: history.shop,
        source: "manual_bulk_edit",
        executionId: history.executionIdentity,
      });

      await clearKeyCaches(`${history.shop}:fetchHistories`);

      return bulkEditHistoryRepository.findByIdForShop(history.id, history.shop);
    } catch (error) {
      if (history?.id && history?.shop) {
        await bulkEditHistoryRepository.markFailed({
          id: history.id,
          shop: history.shop,
          reason: sanitizeError(error),
          stage: "bulk_edit_create",
          now: new Date(),
        });
      }

      throw error;
    }
  }

  async _bulkOperationEdit(body, subscription) {
    const {
      filterParams,
      queryWhere,
      productIds,
      targetSnapshotId,
      title: explicitTitle,
    } = body;

    const rules = normalizeRules(body);
    const fields = rules.map((rule) => rule.field);
    const normalizedTargetSnapshotId =
      typeof targetSnapshotId === "string" ? targetSnapshotId.trim() : "";
    const usesFrozenTarget = Boolean(normalizedTargetSnapshotId);
    const resolvedTarget = normalizedTargetSnapshotId
      ? await getFrozenTargetSnapshotSummary({
          ownerType: "AD_HOC_PRODUCT_TARGET",
          ownerId: normalizedTargetSnapshotId,
          shop: this.shop,
        })
      : await resolveCanonicalProductTarget({
          shop: this.shop,
          filterParams,
          explicitWhere: queryWhere,
          explicitProductIds: Array.isArray(productIds) ? productIds : [],
          queryParams: {
            page: 1,
            limit: 20,
          },
          sampleLimit: 20,
        });

    const count = Number(resolvedTarget?.count || 0);
    if (count <= 0) {
      throw new Error("No products matched this bulk edit target");
    }

    const mirrorBatchId = assertNonEmptyString(
      resolvedTarget?.mirrorBatchId,
      "targetMirrorBatchId"
    );
    const limit = subscription?.limit || 100;
    const planName = subscription?.planName || "Free Plan";
    const isUnlimited = subscription?.isUnlimited || false;

    if (!isUnlimited && count > limit) {
      throw new Error(
        `Your current plan (${planName}) allows editing up to ${limit} products at a time. You are trying to edit ${count} products. Please upgrade your plan or reduce the number of products.`
      );
    }

    const title = explicitTitle || (await buildHistoryTitle(rules));
    const executionIdentity = crypto.randomUUID();
    const includesDelete = fields.includes(DELETE_FIELD);

    return {
      shop: this.shop,
      title,
      queryFilter: JSON.stringify(
        usesFrozenTarget ? {} : resolvedTarget.where || {}
      ),
      rules,
      startedAt: new Date(),
      status: "pending",
      executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
      executionIdentity,
      processedCount: 0,
      totalItems: count,
      targetSnapshotCount: 0,
      targetMirrorBatchId: mirrorBatchId,
      durationMs: 0,
      batch: {
        frozen: false,
        hasMore: false,
        lastProductId: null,
        lastOrdinal: 0,
        size: DEFAULT_BATCH_SIZE,
        previewCount: count,
        currentBatchTargetCount: 0,
        queuedAt: null,
        sourceTargetSnapshotId: normalizedTargetSnapshotId || null,
        mutationMode: determineMutationMode(fields),
      },
      ...(rules.find((rule) => rule.locationId)?.locationId
        ? { locationId: rules.find((rule) => rule.locationId)?.locationId }
        : {}),
      undo: buildPlannedUndoState({
        allowed: !includesDelete,
        executionIdentity,
      }),
    };
  }

  async freezeEditHistoryTargets({ historyId, shop = this.shop }) {
    const safeShop = assertShop(shop);
    const safeHistoryId = assertNonEmptyString(historyId, "historyId");

    const history = await bulkEditHistoryRepository.findTargetFreezePayloadByIdForShop(
      safeHistoryId,
      safeShop
    );

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
        targetOwnerId: safeHistoryId,
        shop: safeShop,
      });

      return Number(cloned.count || 0);
    }

    const where = safeJsonParse(history.queryFilter || "{}");
    const frozenCount = await freezeTargetSnapshot({
      ownerType: "EDIT_HISTORY",
      ownerId: safeHistoryId,
      shop: safeShop,
      where,
      mirrorBatchId: assertNonEmptyString(
        history.targetMirrorBatchId,
        "targetMirrorBatchId"
      ),
    });

    const previewCount = history.batch?.previewCount ?? null;
    if (previewCount !== null && Number(previewCount) !== Number(frozenCount)) {
      await markPreviewExecutionMismatch({
        shop: safeShop,
        ownerType: "EDIT_HISTORY",
        ownerId: safeHistoryId,
        previewCount: Number(previewCount),
        frozenCount,
      });

      throw new Error(
        `Preview/execution mismatch. Preview=${previewCount}, frozen=${frozenCount}`
      );
    }

    if (frozenCount <= 0) {
      throw new Error("Target freeze produced zero products");
    }

    return frozenCount;
  }

  async _bulkOperationHelper({
    formattedProducts,
    jsonlFilePath = null,
    field,
    fields = [],
    historyId = null,
    shop = this.shop,
  }) {
    try {
      const safeShop = assertShop(shop);
      const hasJsonlFile =
        typeof jsonlFilePath === "string" && jsonlFilePath.trim();
      const jsonlPayload = hasJsonlFile
        ? null
        : typeof formattedProducts === "string"
        ? formattedProducts.trim()
        : serializeJsonlLines(formattedProducts);

      if (!hasJsonlFile) {
        assertPreparedPayload(jsonlPayload, 1);
      }

      const operationName = `bulkEditProducts_${safeShop}_${crypto.randomUUID()}`;
      const mode = determineMutationMode(fields.length ? fields : [field]);

      const stagedRes = await this.client.query({
        data: {
          query: stagesUploadMutation,
          variables: {
            input: [
              {
                filename: `${operationName}.jsonl`,
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

      const keyUrl = hasJsonlFile
        ? await uploadFileToShopifyStagedTarget(
            target,
            jsonlFilePath,
            `${operationName}.jsonl`
          )
        : await uploadToShopifyStagedTarget(target, jsonlPayload);

      if (hasJsonlFile) {
        await fs.promises.unlink(jsonlFilePath).catch(() => {});
      }

      if (!keyUrl) {
        throw new Error("Shopify staged upload path missing");
      }

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

      if (!result?.bulkOperation?.id) {
        throw new Error("Missing bulk operation response payload");
      }

      if (historyId) {
        await bulkEditHistoryRepository.updateBulkOperationId({
          id: historyId,
          shop: safeShop,
          bulkOperationId: result.bulkOperation.id,
        });
      }

      await CacheService.set(`${safeShop}:PRODUCT_UPDATE`, {
        running: true,
        bulkOperationId: result.bulkOperation.id,
        historyId,
      });

      return result;
    } catch (err) {
      if (typeof jsonlFilePath === "string" && jsonlFilePath.trim()) {
        await fs.promises.unlink(jsonlFilePath).catch(() => {});
      }
      throw err;
    }
  }

  async _preparingBulkOperation({ historyId, shop = this.shop }) {
    const safeShop = assertShop(shop);
    const safeHistoryId = assertNonEmptyString(historyId, "historyId");

    const history = await bulkEditHistoryRepository.findPreparationPayloadByIdForShop(
      safeHistoryId,
      safeShop
    );

    if (!history) {
      throw new Error("Edit history not found");
    }

    const rules = Array.isArray(history.rules)
      ? normalizeRules({ rules: history.rules })
      : [];
    if (!rules.length) {
      throw new Error("Edit rules not found");
    }

    const mirrorBatchId = assertNonEmptyString(
      history.targetMirrorBatchId,
      "targetMirrorBatchId"
    );

    const compiled = await compileBulkEditJsonl({
      shop: safeShop,
      historyId: safeHistoryId,
      executionIdentity: history.executionIdentity,
      mirrorBatchId,
      rules,
    });

    const compiledBatchId = buildBatchId({
      executionIdentity: history.executionIdentity,
      historyId: safeHistoryId,
      cursorOrdinal: 0,
      lastOrdinal: compiled.lastOrdinal,
      count: compiled.productCount,
    });

    return {
      formattedProducts: null,
      jsonlFilePath: compiled.filePath,
      changes: [],
      skipped: [],
      lastProductId: null,
      lastOrdinal: compiled.lastOrdinal,
      hasMore: compiled.hasMore,
      batchId: compiledBatchId,
      batchTargetCount: compiled.batchTargetCount,
      preparedLineCount: compiled.jsonlLineCount,
      changeCount: compiled.changeCount,
      productCount: compiled.productCount,
      jsonlFileBytes: compiled.bytes,
    };

  }

  async trackEditProducts({
    field,
    editType,
    editValue,
    filterParams,
    queryWhere,
    productIds,
    searchKey,
    replaceText,
    supportValue,
    targetSnapshotId,
    page = 1,
    limit = 20,
    lang,
    subscription = {},
    locationId = null,
  }) {
    try {
      const changes = [];
      field = normalizeField(field);

      if (!field) {
        throw new Error("field is required");
      }

      if (!editType) {
        throw new Error("editType is required");
      }

      if (field === "inventory" && !locationId) {
        throw new Error("Location ID is required for inventory edits");
      }

      const isVariant = isVariantLevelField(field);

      const normalizedTargetSnapshotId =
        typeof targetSnapshotId === "string" ? targetSnapshotId.trim() : "";
      const normalizedPage = Math.max(Number.parseInt(page, 10) || 1, 1);
      const normalizedLimit = normalizePositiveInteger(limit, 20, MAX_PREVIEW_LIMIT);
      const target = normalizedTargetSnapshotId
        ? await this.resolveFrozenPreviewTarget({
            targetSnapshotId: normalizedTargetSnapshotId,
            page: normalizedPage,
            limit: normalizedLimit,
          })
        : await resolveCanonicalProductTarget({
            shop: this.shop,
            filterParams,
            explicitWhere: queryWhere,
            explicitProductIds: Array.isArray(productIds) ? productIds : [],
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

      const sampleProductIds = target.sampleProducts.map((product) => product.id);
      const products = await productMirrorRepository.findProductsForFrozenTarget({
        shop: this.shop,
        productIds: sampleProductIds,
        mirrorBatchId: assertNonEmptyString(target.mirrorBatchId, "mirrorBatchId"),
        includeVariants: isVariant,
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
          locationId,
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
      throw err;
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
