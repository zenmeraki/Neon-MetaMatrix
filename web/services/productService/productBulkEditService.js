import crypto from "crypto";
import { uploadToShopifyStagedTarget } from "../../utils/productBulkEditUtils.js";
import {
  bulkOperationMutation,
  getProductSetMutation,
  PRODUCT_SET_MODE,
  stagesUploadMutation,
} from "../../helpers/productBulkOperationHelpers/mutationTemplates.js";
import { getUpdatedProducts } from "../../helpers/productBulkOperationHelpers/productUpdateHandler.js";
import CacheService from "../../utils/cacheService.js";
import { createMultiLanguage } from "../../utils/googleTranslator.js";
import { FIELD_TRANSLATIONS } from "../../Config/constants.js";
import { FIELD_CONFIGS } from "../../helpers/productBulkOperationHelpers/constants.js";
import { prisma } from "../../Config/database.js";
import { Prisma } from "../../generated/prisma/index.js";
import {
  freezeTargetSnapshot,
  getFrozenTargetItems,
  markPreviewExecutionMismatch,
  resolveCanonicalProductTarget,
} from "./productTargetingService.js";
import {
  assertFilterVersionCurrent,
  CURRENT_FILTER_ENGINE_VERSION,
} from "./productFilterCompiler.js";
import {
  BULK_EDIT_EXECUTION_STATES,
  buildPlannedUndoState,
} from "../bulkEditExecutionStateService.js";
import { adminGraphqlWithRetry } from "../../utils/shopifyAdminApi.js";
import {
  buildRulesHash,
  sha256Hex,
} from "../../utils/deterministicHashUtils.js";
import { logBatchEvent } from "../../utils/batchObservability.js";
import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";
import { connection } from "../../Config/redis.js";
import logger from "../../utils/loggerUtils.js";
import {
  createBulkEditJobOutbox,
  drainBulkEditJobOutbox,
} from "../bulkEditJobOutboxService.js";
import { recordMirrorAnomaly } from "../mirrorAnomalyService.js";

const OPTION_NAME_FIELDS = new Set([
  "option1Name",
  "option2Name",
  "option3Name",
  "mixed",
]);

const VARIANT_LEVEL_FIELDS = new Set([
  "price",
  "barcode",
  "sku",
  "inventory",
  "taxable",
  "compareAtPrice",
  "option1Values",
  "option2Values",
  "option3Values",
  "inventoryPolicy",
  "cost",
  "requiresShipping",
  "weight",
  "weightUnit",
]);

function isVariantLevelField(field) {
  if (FIELD_CONFIGS?.[field]?.isVariantLevel) return true;
  return VARIANT_LEVEL_FIELDS.has(field);
}

function buildProductInclude(fields = [], batchScope = {}) {
  if (fields.some((field) => isVariantLevelField(field) || OPTION_NAME_FIELDS.has(field))) {
    const variantWhere = {
      ...(batchScope.shop ? { shop: batchScope.shop } : {}),
      ...(batchScope.catalogBatchId ? { catalogBatchId: batchScope.catalogBatchId } : {}),
    };

    return {
      variants: {
        ...(Object.keys(variantWhere).length ? { where: variantWhere } : {}),
        orderBy: [{ position: "asc" }, { id: "asc" }],
      },
    };
  }

  return undefined;
}

function determineMutationMode(fields = []) {
  const normalizedFields = Array.isArray(fields) ? fields.filter(Boolean) : [];
  const includesDelete = normalizedFields.includes("deleteProducts");
  const includesVariant = normalizedFields.some((field) => isVariantLevelField(field));
  const includesProduct = normalizedFields.some(
    (field) => !isVariantLevelField(field) && field !== "deleteProducts",
  );
  const includesOptionNames = normalizedFields.some((field) => OPTION_NAME_FIELDS.has(field));

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

function determineTargetLevel(fields = []) {
  const normalizedFields = Array.isArray(fields) ? fields.filter(Boolean) : [];
  return normalizedFields.some((field) => isVariantLevelField(field))
    ? "VARIANT"
    : "PRODUCT";
}

const getTargetBatchWhere = ({ shop, domain, batchScope }) => {
  if (!shop) {
    throw new Error("shop is required for domain batch scope");
  }

  const normalizedDomain = String(domain || "").toUpperCase();
  const batchKeyByDomain = {
    PRODUCT: "productBatchId",
    VARIANT: "variantBatchId",
    COLLECTION: "collectionBatchId",
    INVENTORY: "inventoryBatchId",
  };
  const batchKey = batchKeyByDomain[normalizedDomain];

  if (!batchKey) {
    throw new Error(`Unsupported batch domain: ${domain}`);
  }

  const batchId = batchScope?.[batchKey];
  if (!batchId) {
    throw new Error(`${batchKey} is required for ${normalizedDomain} reads`);
  }

  return { shop, catalogBatchId: batchId };
};

function buildFrozenTargetIntegrityError(message) {
  const error = new Error(message);
  error.code = "FROZEN_TARGET_INTEGRITY_VIOLATION";
  error.integrityViolation = true;
  error.retryable = false;
  return error;
}

function normalizeMirrorProduct(rawProduct) {
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
    options,
    variants,
    seo: {
      title: rawProduct?.seo?.title ?? rawProduct?.seoTitle ?? "",
      description: rawProduct?.seo?.description ?? rawProduct?.seoDescription ?? "",
    },
    category: rawProduct?.category ?? (
      rawProduct?.categoryId || rawProduct?.categoryName
        ? {
            id: rawProduct.categoryId ?? null,
            name: rawProduct.categoryName ?? "",
          }
        : null
    ),
    collections: Array.isArray(rawProduct?.collections)
      ? rawProduct.collections
      : [],
    featuredMedia: rawProduct?.featuredMedia ?? (
      rawProduct?.featuredImageUrl
        ? {
            preview: {
              image: {
                url: rawProduct.featuredImageUrl,
              },
            },
          }
        : null
    ),
  };
}

const normalizeMirrorProductForPreview = normalizeMirrorProduct;

async function acquireBulkEditEnqueueLock(shop) {
  const token = crypto.randomUUID();
  const key = `${shop}:bulk_edit_lock`;
  const acquired = await connection.set(key, token, "PX", 30_000, "NX");

  return acquired === "OK" ? { key, token } : null;
}

async function releaseBulkEditEnqueueLock(lock) {
  if (!lock) return;

  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    end
    return 0
  `;
  await connection.eval(script, 1, lock.key, lock.token).catch(() => {});
}

async function assertCatalogSnapshotReady({
  shop,
  snapshotId,
  catalogBatchId,
  client = prisma,
}) {
  const snapshot = snapshotId
    ? await client.catalogSnapshot.findUnique({
        where: { id: snapshotId },
      })
    : await client.catalogSnapshot.findFirst({
        where: { shop, catalogBatchId },
        orderBy: { activatedAt: "desc" },
      });

  if (!snapshot || snapshot.shop !== shop || snapshot.status !== "ACTIVE") {
    const error = new Error("Catalog snapshot is not ready for execution");
    error.code = "CATALOG_SNAPSHOT_NOT_READY";
    error.retryable = false;
    throw error;
  }

  const requiredDomains = [
    ["PRODUCT", snapshot.actualProductCount],
    ["VARIANT", snapshot.actualVariantCount],
    ["COLLECTION", snapshot.actualCollectionMembershipCount],
    ["INVENTORY", snapshot.actualInventoryLevelCount],
  ];
  const missingRequiredDomains = requiredDomains
    .filter(([, count]) => !(Number(count) > 0))
    .map(([domain]) => domain);

  if (missingRequiredDomains.length > 0) {
    const error = new Error("Catalog snapshot is missing required domains");
    error.code = "CATALOG_SNAPSHOT_INCOMPLETE";
    error.retryable = false;
    error.details = {
      snapshotId: snapshot.id,
      catalogBatchId: snapshot.catalogBatchId,
      missingRequiredDomains,
    };
    throw error;
  }

  return snapshot;
}

function filterVariantsByCatalogBatch(products, catalogBatchId) {
  if (!catalogBatchId) {
    return products;
  }

  return products.map((product) => ({
    ...product,
    variants: Array.isArray(product.variants)
      ? product.variants.filter((variant) => variant.catalogBatchId === catalogBatchId)
      : product.variants,
  }));
}

function normalizeRules(body) {
  const { rules: explicitRules } = body;

  if (Array.isArray(explicitRules) && explicitRules.length > 0) {
    return explicitRules;
  }

  throw new Error("Explicit rules array is required for bulk edits");
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
      }),
    )
    .filter(Boolean)
    .join(" + ");

  return createMultiLanguage(updatedTitle || "Bulk edit");
}

export default class ProductBulkService {
  constructor(session) {
    this.session = session;
  }

  async bulkEditProducts(req) {
    let enqueueLock = null;
    try {
      const historyData = await this._bulkOperationEdit(
        req.body,
        req.subscription || {},
      );

      enqueueLock = await acquireBulkEditEnqueueLock(historyData.shop);
      if (!enqueueLock) {
        const error = new Error("Another bulk edit is being queued for this shop");
        error.code = "BULK_EDIT_ENQUEUE_LOCKED";
        error.retryable = true;
        throw error;
      }

      const history = await prisma.$transaction(
        async (tx) => {
          const createdHistory = await tx.editHistory.create({
            data: historyData,
          });

          const frozenSnapshot = await this.freezeEditHistoryTargets(
            createdHistory.id,
            { client: tx },
          );

          const queuedHistory = await tx.editHistory.update({
            where: { id: createdHistory.id },
            data: {
              totalItems: frozenSnapshot.count,
            targetSnapshotCount: frozenSnapshot.count,
            targetSnapshotSetId: frozenSnapshot.targetSnapshotSetId,
            targetLevel: frozenSnapshot.targetLevel,
            batch: {
              ...(createdHistory.batch || {}),
              targetSnapshotSetId: frozenSnapshot.targetSnapshotSetId,
              frozenTargetCount: frozenSnapshot.count,
            },
            executionState: BULK_EDIT_EXECUTION_STATES.QUEUED,
          },
        });

          await createBulkEditJobOutbox(tx, {
            historyId: queuedHistory.id,
            shop: queuedHistory.shop,
            source: "manual_bulk_edit",
            executionId: queuedHistory.executionIdentity,
          });

          return queuedHistory;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      await drainBulkEditJobOutbox({ limit: 10 });

      return prisma.editHistory.findUnique({
        where: { id: history.id },
      });
    } catch (error) {
      throw error;
    } finally {
      await releaseBulkEditEnqueueLock(enqueueLock);
    }
  }

  async _bulkOperationEdit(body, subscription) {
    const {
      filterParams,
      queryWhere,
      productIds,
      title: explicitTitle,
    } = body;

    const initialEditedField = body.editedField;
    if (initialEditedField === "inventory" && !body.locationId) {
      throw new Error("Location ID is required for inventory edits");
    }

    const rules = normalizeRules(body);
    const editedField = rules[0]?.field;
    if (!editedField) {
      throw new Error("At least one rule field is required");
    }
    const targetLevel = determineTargetLevel(rules.map((rule) => rule?.field));
    const path = subscription?.path || "execute";
    const resolvedTarget = await resolveCanonicalProductTarget({
      shop: this.session.shop,
      filterParams,
      explicitWhere: queryWhere,
      explicitProductIds: Array.isArray(productIds) ? productIds : [],
      queryParams: {
        page: 1,
        limit: 20,
      },
      sampleLimit: 20,
      path,
    });

    const count = resolvedTarget.totalCount ?? resolvedTarget.count;
    const limit = subscription?.limit || 100;
    const planName = subscription?.planName || "Free Plan";
    const isUnlimited = subscription?.isUnlimited || false;

    if (!isUnlimited && count > limit) {
      throw new Error(
        `Your current plan (${planName}) allows editing up to ${limit} products at a time. You are trying to edit ${count} products. Please upgrade your plan or reduce the number of products.`,
      );
    }

    const title = explicitTitle || await buildHistoryTitle(rules);
    const batchScope = {
      catalogSnapshotId: resolvedTarget.snapshotId,
      productBatchId: resolvedTarget.catalogBatchId,
      variantBatchId: resolvedTarget.productMirrorBatchId || resolvedTarget.catalogBatchId,
      collectionBatchId: resolvedTarget.catalogBatchId,
      inventoryBatchId: resolvedTarget.catalogBatchId,
      requiredDomains: ["PRODUCT", "VARIANT", "COLLECTION", "INVENTORY"],
    };
    const rulesHash = sha256Hex({
      rules,
      canonicalFilterKey: resolvedTarget.canonicalFilterKey,
      snapshotId: resolvedTarget.snapshotId,
      filterVersion: resolvedTarget.filterVersion,
    });

    return {
      shop: this.session.shop,
      title,
      queryFilter: JSON.stringify(resolvedTarget.where),
      rules,
      status: "pending",
      executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
      executionIdentity: crypto.randomUUID(),
      filterVersion: resolvedTarget.filterVersion,
      canonicalFilterKey: resolvedTarget.canonicalFilterKey,
      rulesHash,
      ruleEngineVersion: "product-set-v1",
      processedCount: 0,
      totalItems: count,
      targetSnapshotCount: 0,
      targetCatalogBatchId: resolvedTarget.catalogBatchId,
      targetMirrorBatchId: resolvedTarget.mirrorBatchId,
      targetLevel,
      durationMs: 0,
      batch: {
        frozen: true,
        batchField: resolvedTarget.batchField,
        ...batchScope,
        catalogSnapshotCutoverFlag: resolvedTarget.cutoverFlag,
        catalogSnapshotCutoverEnabled: resolvedTarget.cutoverEnabled,
        hasMore: count > 0,
        lastProductId: null,
        targetCursorKey: null,
        size: 75,
        previewCount: count,
        currentBatchTargetCount: 0,
        queuedAt: new Date().toISOString(),
      },
      ...(editedField === "inventory" && { locationId: body.locationId }),
      undo: buildPlannedUndoState({
        allowed: editedField !== "deleteProducts",
      }),
    };
  }

  async freezeEditHistoryTargets(historyId, { client = prisma } = {}) {
    const history = await client.editHistory.findUnique({
      where: { id: historyId },
      select: {
        shop: true,
        queryFilter: true,
        targetCatalogBatchId: true,
        targetMirrorBatchId: true,
        rules: true,
        filterVersion: true,
        canonicalFilterKey: true,
        rulesHash: true,
        batch: true,
        targetLevel: true,
      },
    });

    if (!history) {
      throw new Error("Edit history not found");
    }

    assertFilterVersionCurrent(history.filterVersion, {
      historyId,
      shop: history.shop,
    });

    let where = {};
    try {
      where = history.queryFilter ? JSON.parse(history.queryFilter) : {};
    } catch (error) {
      await client.editHistory.update({
        where: { id: historyId },
        data: {
          status: "failed",
          executionState: BULK_EDIT_EXECUTION_STATES.FAILED,
          failureStage: "target_snapshot_freeze",
          completedAt: new Date(),
          error: [
            {
              code: "INVALID_QUERY_FILTER",
              stage: "target_snapshot_freeze",
              message: "Bulk edit target filter could not be parsed",
              retryable: false,
              details: {
                parserMessage: error.message,
              },
              occurredAt: new Date().toISOString(),
            },
          ],
        },
      });

      const invalidFilterError = new Error("Bulk edit target filter could not be parsed");
      invalidFilterError.code = "INVALID_QUERY_FILTER";
      invalidFilterError.retryable = false;
      throw invalidFilterError;
    }

    const rules = Array.isArray(history.rules) ? history.rules : [];
    await assertCatalogSnapshotReady({
      shop: history.shop,
      snapshotId: history.batch?.catalogSnapshotId || null,
      catalogBatchId:
        history.batch?.productBatchId ||
        history.targetCatalogBatchId ||
        history.targetMirrorBatchId ||
        null,
      client,
    });

    const targetLevel =
      history.targetLevel ||
      determineTargetLevel(rules.map((rule) => rule?.field).filter(Boolean));
    const batchField = history.batch?.batchField || "catalogBatchId";
    const path = history.batch?.catalogSnapshotCutoverFlag === "catalogSnapshotSchedulerEnabled"
      ? "scheduler"
      : "execute";
    const frozenSnapshot = await freezeTargetSnapshot({
      ownerType: "EDIT_HISTORY",
      ownerId: historyId,
      shop: history.shop,
      where,
      catalogBatchId: history.targetCatalogBatchId || history.targetMirrorBatchId,
      mirrorBatchId: history.targetMirrorBatchId,
      batchField,
      targetLevel,
      filterVersion: history.filterVersion || 1,
      canonicalFilterKey: history.canonicalFilterKey,
      compiledWhereHash: sha256Hex(where),
      rulesHash: sha256Hex({
        rules,
        canonicalFilterKey: history.canonicalFilterKey,
        snapshotId: history.batch?.catalogSnapshotId || null,
        filterVersion: history.filterVersion || 1,
      }),
      ruleEngineVersion: "product-set-v1",
      path,
      client,
      executionBatchSize: history.batch?.size || 75,
    });

    const previewCount = history.batch?.previewCount ?? null;
    if (previewCount !== null && Number(previewCount) !== Number(frozenSnapshot.count)) {
      await markPreviewExecutionMismatch({
        shop: history.shop,
        ownerType: "EDIT_HISTORY",
        ownerId: historyId,
        previewCount: Number(previewCount),
        frozenCount: frozenSnapshot.count,
      });
      void recordMirrorAnomaly({
        shop: history.shop,
        severity: "medium",
        type: "PREVIEW_EXECUTION_TARGET_MISMATCH",
        entityType: "EDIT_HISTORY",
        entityId: String(historyId),
        message: `Preview target count (${Number(previewCount)}) does not match frozen execution target count (${frozenSnapshot.count}). Proceeding with frozen snapshot.`,
        details: {
          historyId,
          previewCount: Number(previewCount),
          frozenCount: frozenSnapshot.count,
        },
      }).catch(() => {});
    }

    return frozenSnapshot;
  }

  async _bulkOperationHelper({
    formattedProducts,
    field,
    fields = [],
    batchId = null,
    executionIdentity = null,
  }) {
    try {
      const currentBulkOperation = await getCurrentBulkOperationStatus(
        this.session,
        "MUTATION",
      );
      if (["CREATED", "RUNNING", "CANCELING"].includes(currentBulkOperation.status)) {
        const error = new Error("Another Shopify bulk operation is already running");
        error.code = "SHOPIFY_BULK_OPERATION_RUNNING";
        error.retryable = true;
        error.details = {
          bulkOperationId: currentBulkOperation.id || null,
          status: currentBulkOperation.status || null,
        };
        throw error;
      }

      const operationName = `bulkEditProducts_${sha256Hex({
        executionIdentity: executionIdentity || this.session?.shop || "unknown",
        batchId: batchId || "unbatched",
      }).slice(0, 24)}`;
      const mode = determineMutationMode(fields.length ? fields : [field]);

      const stagedRes = await adminGraphqlWithRetry({
        session: this.session,
        shop: this.session?.shop,
        operationName: "bulkEditStagedUploadsCreate",
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
          `Shopify API returned errors: ${JSON.stringify(userErrors)}`,
        );
      }

      const target =
        stagedRes?.body?.data?.stagedUploadsCreate?.stagedTargets?.[0];

      if (!target) {
        throw new Error("Failed to get staged upload target from Shopify");
      }

      const keyUrl = await uploadToShopifyStagedTarget(
        target,
        formattedProducts,
      );

      const bulkRes = await adminGraphqlWithRetry({
        session: this.session,
        shop: this.session?.shop,
        operationName: "bulkEditRunMutation",
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
          `Bulk operation returned errors: ${JSON.stringify(bulkErrors)}`,
        );
      }

      const result = bulkRes.body?.data?.bulkOperationRunMutation;

      try {
        await CacheService.set(
          `${this.session.shop}:PRODUCT_UPDATE`,
          { running: true },
          30 * 60,
        );
      } catch (cacheError) {
        logger.warn("Bulk edit product update cache write failed", {
          shop: this.session.shop,
          batchId,
          message: cacheError.message,
        });
      }

      return result;
    } catch (err) {
      const error = new Error(err.message, { cause: err });
      error.code = err.code;
      error.retryable = err.retryable === true;
      error.details = err.details || null;
      throw error;
    }
  }

  async _preparingBulkOperation({ historyId }) {
    const history = await prisma.editHistory.findUnique({
      where: { id: historyId },
      select: {
        shop: true,
        batch: true,
        rules: true,
        targetCatalogBatchId: true,
        targetMirrorBatchId: true,
        targetSnapshotSetId: true,
        targetSnapshotCount: true,
        executionIdentity: true,
        targetLevel: true,
        skippedItems: true,
        locationId: true,
      },
    });

    if (!history) {
      throw new Error("Edit history not found");
    }

    const rules = Array.isArray(history.rules) ? history.rules.filter(Boolean) : [];
    if (!rules.length) {
      throw new Error("Edit rules not found");
    }

    const limit = history.batch?.size || 75;
    const targetCursorKey =
      history.batch?.targetCursorKey || history.batch?.lastProductId || null;
    const frozenTargets = await getFrozenTargetItems({
      ownerType: "EDIT_HISTORY",
      ownerId: historyId,
      shop: history.shop,
      targetSnapshotSetId: history.targetSnapshotSetId,
      limit,
      targetCursorKey,
    });
    const {
      rows,
      lastProductId,
      targetCursorKey: nextTargetCursorKey,
      hasMore,
    } = frozenTargets;
    const targetLevel = history.targetLevel || frozenTargets.targetLevel || "PRODUCT";
    const targetCatalogBatchId =
      history.targetCatalogBatchId ||
      frozenTargets.catalogBatchId ||
      history.targetMirrorBatchId ||
      null;
    if (
      history.batch?.targetSnapshotSetId &&
      history.batch.targetSnapshotSetId !== history.targetSnapshotSetId
    ) {
      throw buildFrozenTargetIntegrityError("Target snapshot changed during execution");
    }

    const batchScope = {
      catalogSnapshotId: history.batch?.catalogSnapshotId || frozenTargets.catalogSnapshotId || null,
      productBatchId:
        history.batch?.productBatchId ||
        targetCatalogBatchId ||
        null,
      variantBatchId:
        history.batch?.variantBatchId ||
        targetCatalogBatchId ||
        null,
      collectionBatchId:
        history.batch?.collectionBatchId ||
        targetCatalogBatchId ||
        null,
      inventoryBatchId:
        history.batch?.inventoryBatchId ||
        targetCatalogBatchId ||
        null,
    };

    logBatchEvent("catalog_batch_edit_execution", {
      shop: history.shop,
      oldMirrorBatchId:
        history.targetMirrorBatchId &&
        history.targetMirrorBatchId !== targetCatalogBatchId
          ? history.targetMirrorBatchId
          : null,
      resolvedCatalogBatchId: targetCatalogBatchId,
      path: "execute",
      extra: {
        historyId,
        targetSnapshotSetId: history.targetSnapshotSetId,
        batchSize: limit,
        targetCursorKey,
        returnedRows: rows.length,
      },
    });

    if (!rows.length) {
      const emptyBatchSequenceNumber = Number.isInteger(history.batch?.nextBatchSequenceNumber)
        ? history.batch.nextBatchSequenceNumber
        : null;
      return {
        formattedProducts: "",
        changes: [],
        lastProductId: null,
        hasMore: false,
        batchId: emptyBatchSequenceNumber
          ? `${historyId}:${emptyBatchSequenceNumber}`
          : `${historyId}:empty`,
        batchTargetCount: 0,
        targetCursorKey: null,
      };
    }

    const fields = rules.map((rule) => rule.field).filter(Boolean);
    const batchWhere = getTargetBatchWhere({
      shop: history.shop,
      domain: "PRODUCT",
      batchScope,
    });
    const include = buildProductInclude(
      fields,
      targetLevel === "VARIANT"
        ? getTargetBatchWhere({
            shop: history.shop,
            domain: "VARIANT",
            batchScope,
          })
        : batchWhere,
    );
    const orderedIds = [...new Set(rows.map((row) => row.productId))];
    const variantIdsByProductId = rows.reduce((accumulator, row) => {
      if (!row.variantId) {
        return accumulator;
      }
      const variants = accumulator.get(row.productId) || new Set();
      variants.add(row.variantId);
      accumulator.set(row.productId, variants);
      return accumulator;
    }, new Map());

    let products = await prisma.product.findMany({
      where: {
        id: {
          in: orderedIds,
        },
        ...batchWhere,
      },
      ...(include ? { include } : {}),
    });

    if (include?.variants) {
      if (targetLevel === "VARIANT") {
        products = products.map((product) => ({
          ...product,
          variants: (product.variants || []).filter((variant) =>
            variantIdsByProductId.get(product.id)?.has(variant.id),
          ),
        }));
      }
    }

    if (products.length !== orderedIds.length) {
      throw buildFrozenTargetIntegrityError(
        `Frozen target integrity violation: ${orderedIds.length - products.length} product(s) missing from snapshot ${history.targetSnapshotSetId}`,
      );
    }

    if (targetLevel === "VARIANT") {
      const frozenVariantCount = rows.filter((row) => row.variantId).length;
      const loadedVariantCount = products.reduce(
        (count, product) => count + (product.variants || []).length,
        0,
      );

      if (loadedVariantCount !== frozenVariantCount) {
        throw buildFrozenTargetIntegrityError(
          `Frozen target integrity violation: ${frozenVariantCount - loadedVariantCount} variant(s) missing from mirror batch ${history.targetMirrorBatchId}`,
        );
      }
    }

    if (fields.includes("inventory")) {
      if (!history.locationId) {
        throw buildFrozenTargetIntegrityError("Inventory edit requires a location snapshot");
      }

      const inventoryRows = await prisma.variantInventoryLevel.count({
        where: {
          ...getTargetBatchWhere({
            shop: history.shop,
            domain: "INVENTORY",
            batchScope,
          }),
          locationId: history.locationId,
        },
      });

      if (inventoryRows <= 0) {
        throw buildFrozenTargetIntegrityError(
          `Inventory location ${history.locationId} is not present in the frozen snapshot`,
        );
      }
    }

    const productsById = new Map(products.map((product) => [product.id, product]));
    const formattedProducts = [];
    const changes = [];
    const batchSequenceNumber = rows[0]?.batchSequenceNumber;
    const batchId = `${historyId}:${Number.isInteger(batchSequenceNumber) ? batchSequenceNumber : "legacy"}`;

    for (const productId of orderedIds) {
      const rawProduct = productsById.get(productId);
      if (!rawProduct) {
        continue;
      }

      const product = normalizeMirrorProduct(rawProduct);

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
          shop: history.shop,
          batchId,
        });

        if (result) {
          formattedProducts.push(result);
        }
      }
    }

    return {
      formattedProducts: formattedProducts.join("\n"),
      changes,
      lastProductId,
      targetCursorKey: nextTargetCursorKey,
      hasMore,
      batchId,
      batchTargetCount: rows.length,
      targetLevel,
      targetSnapshotRows: rows.length,
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
    page = 1,
    limit = 20,
    lang,
    subscription = {},
  }) {
    try {
      const changes = [];
      const isVariant = isVariantLevelField(field);

      const target = await resolveCanonicalProductTarget({
        shop: this.session.shop,
        filterParams,
        queryParams: { page, limit },
        sampleLimit: Number.parseInt(limit, 10) || 20,
        path: "preview",
      });

      const productLimit = subscription?.limit || 100;
      const planName = subscription?.planName || "Free Plan";
      const isUnlimited = subscription?.isUnlimited || false;

      let subscriptionWarning = null;

      if (!isUnlimited) {
        if ((target.totalCount ?? target.count) > productLimit) {
          subscriptionWarning = {
            type: "LIMIT_EXCEEDED",
            message: `Your current plan (${planName}) allows editing up to ${productLimit} products. You're trying to edit ${target.totalCount ?? target.count} products. Please upgrade your plan or reduce the number of products.`,
          };
        } else if ((target.totalCount ?? target.count) > productLimit * 0.8) {
          const remaining = productLimit - (target.totalCount ?? target.count);
          subscriptionWarning = {
            type: "APPROACHING_LIMIT",
            message: `You're editing ${target.totalCount ?? target.count} products. Your plan allows ${productLimit} products per edit. ${remaining} products remaining.`,
          };
        }
      }

      const batchWhere = getTargetBatchWhere({
        shop: this.session.shop,
        domain: "PRODUCT",
        batchScope: {
          productBatchId: target.catalogBatchId,
        },
      });
      const include = buildProductInclude([field], batchWhere);
      const productIds = target.sampleProducts.map((product) => product.id);
      let products = await prisma.product.findMany({
        where: {
          id: { in: productIds },
          ...batchWhere,
        },
        ...(include ? { include } : {}),
      });

      if (include?.variants) {
        products = filterVariantsByCatalogBatch(products, target.mirrorBatchId);
      }

      const productMap = new Map(products.map((product) => [product.id, product]));
      const formattedProducts = [];

      for (const targetProduct of target.sampleProducts) {
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
        subscription: subscriptionWarning ? { warning: subscriptionWarning } : {},
      };
    } catch (err) {
      throw new Error(err.message || "Failed to track edit products");
    }
  }
}
