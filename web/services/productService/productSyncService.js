import readline from "readline";
import {
  activateProductMirrorBatch,
  attachBulkOperationToSyncHistory,
  clearProductSyncCache,
  insertProductMirrorBatch,
  markProductSyncFailed,
  prepareProductSyncStart,
  stageProductMirrorBatch,
  updateInitialSyncProgress,
} from "./productSyncRepository.js";
import { runProductBulkFetch } from "./productSyncGateway.js";
import {
  extractCollections,
  extractMetafields,
  extractVariants,
  flattenProduct,
  flattenVariant,
} from "./productSyncTransformers.js";
import {
  extractMetaobjectIds,
  fetchMetaobjectLookupByIds,
} from "./productSyncMetaobjects.js";
import { getRedisClient } from "../../utils/cacheUtils.js";
import logger from "../../utils/loggerUtils.js";

const START_LOCK_PREFIX = "product_sync_service_lock";
const START_LOCK_TTL_SECONDS = 60;
const SHOPIFY_START_TIMEOUT_MS = 15000;
const METAOBJECT_LOOKUP_TIMEOUT_MS = 10000;
const REPOSITORY_WRITE_TIMEOUT_MS = 15000;
const PRODUCT_BATCH_SIZE = 250;
const MAX_LINE_LENGTH_BYTES = 2 * 1024 * 1024;
const PROGRESS_COUNT_INTERVAL = 1000;
const PROGRESS_TIME_INTERVAL_MS = 15000;

function buildContext({
  shop,
  syncBatchId = null,
  syncHistoryId = null,
  bulkOperationId = null,
}) {
  return {
    shop,
    syncBatchId,
    syncHistoryId,
    bulkOperationId,
  };
}

function logInfo(message, context = {}, meta = {}) {
  logger.info(message, {
    ...context,
    ...meta,
  });
}

function logWarn(message, context = {}, meta = {}) {
  logger.warn(message, {
    ...context,
    ...meta,
  });
}

function logError(message, context = {}, meta = {}) {
  logger.error(message, {
    ...context,
    ...meta,
  });
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error(`${label} timed out`);
        error.code = "SYNC_TIMEOUT";
        reject(error);
      }, timeoutMs);
    }),
  ]);
}

async function acquireStartLock(shop) {
  const redis = getRedisClient();
  const key = `${shop}:${START_LOCK_PREFIX}`;
  const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const result = await redis.set(key, token, {
    NX: true,
    EX: START_LOCK_TTL_SECONDS,
  });

  return {
    acquired: result === "OK",
    key,
    token,
  };
}

async function releaseStartLock(lock) {
  if (!lock?.acquired) {
    return;
  }

  try {
    const redis = getRedisClient();
    const currentToken = await redis.get(lock.key);

    if (currentToken === lock.token) {
      await redis.del(lock.key);
    }
  } catch (error) {
    logger.warn("Failed to release product sync service lock", {
      lockKey: lock?.key,
      error: error.message,
    });
  }
}

function normalizeProductRecord(product) {
  const variants = Array.isArray(product?.variants)
    ? [...product.variants]
    : extractVariants(product?.variants);
  const metafields = extractMetafields(product?.metafields);
  const collections = extractCollections(product?.collections);

  return {
    ...product,
    variants,
    metafields,
    collections,
    options: Array.isArray(product?.options) ? product.options : [],
    featuredMedia: product?.featuredMedia || null,
    __variantIds: new Set(variants.map((variant) => variant?.id).filter(Boolean)),
    __collectionIds: new Set(collections.map((collection) => collection?.id).filter(Boolean)),
    __metafieldKeys: new Set(
      metafields
        .map((metafield) =>
          metafield?.namespace && metafield?.key
            ? `${metafield.namespace}:${metafield.key}`
            : null,
        )
        .filter(Boolean),
    ),
    __metaobjectIds: new Set(
      metafields.flatMap((metafield) => extractMetaobjectIds(metafield?.value)),
    ),
  };
}

function stripInternalFields(product) {
  const {
    __variantIds,
    __collectionIds,
    __metafieldKeys,
    __metaobjectIds,
    ...cleanProduct
  } = product;

  return cleanProduct;
}

async function resolveMetaobjectLookupForBatch(session, ids, context) {
  if (!session?.accessToken || ids.length === 0) {
    return new Map();
  }

  const startedAt = Date.now();
  const lookup = await withTimeout(
    fetchMetaobjectLookupByIds(session, ids),
    METAOBJECT_LOOKUP_TIMEOUT_MS,
    "Metaobject lookup",
  );

  logInfo("Resolved metaobject labels for product sync batch", context, {
    metaobjectCount: ids.length,
    resolvedCount: lookup.size,
    durationMs: Date.now() - startedAt,
  });

  return lookup;
}

function buildVariantFromChildRow(json) {
  return {
    id: json.id,
    title: json.title,
    sku: json.sku,
    barcode: json.barcode,
    price: json.price,
    compareAtPrice: json.compareAtPrice,
    inventoryQuantity: json.inventoryQuantity,
    inventoryPolicy: json.inventoryPolicy,
    taxable: json.taxable,
    taxCode: json.taxCode,
    position: json.position,
    selectedOptions: Array.isArray(json.selectedOptions) ? json.selectedOptions : [],
    inventoryItem: json.inventoryItem || null,
  };
}

function createProductSyncError(message, meta = {}) {
  const error = new Error(message);
  Object.assign(error, meta);
  return error;
}

export async function startBulkOperationToFetchProducts({
  session,
  isInitialSync = false,
}) {
  if (!session?.shop) {
    throw new Error("A valid Shopify session is required to start product sync");
  }

  const lock = await acquireStartLock(session.shop);

  if (!lock.acquired) {
    throw createProductSyncError(
      "A product sync start is already in progress for this shop",
      { code: "SYNC_START_LOCKED" },
    );
  }

  let syncHistory = null;
  let bulkOperationId = null;

  try {
    syncHistory = await withTimeout(
      prepareProductSyncStart({
        shop: session.shop,
        isInitialSync,
      }),
      REPOSITORY_WRITE_TIMEOUT_MS,
      "Prepare product sync start",
    );

    const context = buildContext({
      shop: session.shop,
      syncBatchId: syncHistory.syncBatchId,
      syncHistoryId: syncHistory.id,
    });

    logInfo("Prepared durable product sync start state", context, {
      isInitialSync,
      startedAt: syncHistory.createdAt,
    });

    const { bulkOperationId: startedBulkOperationId, responseBody } = await withTimeout(
      runProductBulkFetch({ session }),
      SHOPIFY_START_TIMEOUT_MS,
      "Shopify bulk product sync start",
    );

    bulkOperationId = startedBulkOperationId;

    await withTimeout(
      attachBulkOperationToSyncHistory({
        shop: session.shop,
        syncHistoryId: syncHistory.id,
        bulkOperationId,
      }),
      REPOSITORY_WRITE_TIMEOUT_MS,
      "Attach Shopify bulk operation to sync history",
    );

    await clearProductSyncCache(session.shop);

    logInfo("Started Shopify bulk operation for product sync", context, {
      bulkOperationId,
    });

    return {
      message: "Bulk product sync started",
      bulkOperationId,
      syncHistoryId: syncHistory.id,
      syncBatchId: syncHistory.syncBatchId,
      startedAt: syncHistory.createdAt,
      response: {
        bulkOperation: {
          id: bulkOperationId,
          status:
            responseBody?.data?.bulkOperationRunQuery?.bulkOperation?.status || null,
        },
      },
    };
  } catch (error) {
    if (syncHistory?.id) {
      const errorSummary = bulkOperationId
        ? `${error.message} (bulkOperationId=${bulkOperationId})`
        : error.message;

      await markProductSyncFailed({
        shop: session.shop,
        syncHistoryId: syncHistory.id,
        errorSummary,
        stage: bulkOperationId ? "SHOPIFY_BULK_STARTED_UNRECORDED" : "START_FAILED",
      });
      await clearProductSyncCache(session.shop);
    }

    logError("Product sync start failed", {
      shop: session.shop,
      syncHistoryId: syncHistory?.id || null,
      syncBatchId: syncHistory?.syncBatchId || null,
      bulkOperationId,
    }, {
      error: error.message,
    });

    throw error;
  } finally {
    await releaseStartLock(lock);
  }
}

export async function formatAndSyncProductsToDB({
  dataStream,
  shop,
  session,
  syncBatchId,
  syncHistoryId,
}) {
  if (!shop || !syncBatchId || !syncHistoryId) {
    throw new Error("shop, syncBatchId, and syncHistoryId are required for staged product sync");
  }

  if (session?.shop && session.shop !== shop) {
    throw new Error("Session shop does not match product sync target shop");
  }

  const context = buildContext({
    shop,
    syncBatchId,
    syncHistoryId,
  });

  let totalProductsProcessed = 0;
  let totalVariantsProcessed = 0;
  let flushCount = 0;
  let parseCount = 0;
  let orphanCount = 0;
  let duplicateProductCount = 0;
  let duplicateVariantCount = 0;
  let duplicateCollectionCount = 0;
  let duplicateMetafieldCount = 0;
  let unknownRowCount = 0;
  let maxLineBytes = 0;

  let lastProgressPersistedCount = 0;
  let lastProgressPersistedAt = Date.now();

  const flushedProductIds = new Set();
  let currentProduct = null;
  let batchProducts = [];
  let failed = false;
  let lineNumber = 0;

  async function persistProgressIfNeeded(force = false) {
    const now = Date.now();
    const shouldPersist =
      force ||
      totalProductsProcessed - lastProgressPersistedCount >= PROGRESS_COUNT_INTERVAL ||
      now - lastProgressPersistedAt >= PROGRESS_TIME_INTERVAL_MS;

    if (!shouldPersist) {
      return;
    }

    await withTimeout(
      updateInitialSyncProgress({
        shop,
        totalProductsProcessed,
        syncHistoryId,
      }),
      REPOSITORY_WRITE_TIMEOUT_MS,
      "Persist product sync progress",
    );

    lastProgressPersistedCount = totalProductsProcessed;
    lastProgressPersistedAt = now;
  }

  async function flushBatch(force = false) {
    if (!force && batchProducts.length < PRODUCT_BATCH_SIZE) {
      return;
    }

    if (batchProducts.length === 0) {
      return;
    }

    const currentBatch = batchProducts;
    batchProducts = [];
    flushCount += 1;

    const metaobjectIds = Array.from(
      new Set(
        currentBatch.flatMap((product) => Array.from(product.__metaobjectIds || [])),
      ),
    );

    const lookup = await resolveMetaobjectLookupForBatch(session, metaobjectIds, context);

    const productRows = currentBatch.map((product) =>
      flattenProduct(stripInternalFields(product), shop, lookup),
    );

    const variantRows = currentBatch.flatMap((product) => {
      const rawVariants = Array.isArray(product.variants) ? product.variants : [];
      return rawVariants
        .filter((variant) => Boolean(variant?.id))
        .map((variant) => flattenVariant(product.id, variant, shop));
    });

    const startedAt = Date.now();
    await withTimeout(
      insertProductMirrorBatch({
        productRows,
        variantRows,
        syncBatchId,
      }),
      REPOSITORY_WRITE_TIMEOUT_MS,
      "Insert staged product sync batch",
    );

    totalProductsProcessed += productRows.length;
    totalVariantsProcessed += variantRows.length;

    logInfo("Flushed staged product sync batch", context, {
      flushCount,
      batchProductCount: productRows.length,
      batchVariantCount: variantRows.length,
      totalProductsProcessed,
      totalVariantsProcessed,
      durationMs: Date.now() - startedAt,
    });

    await persistProgressIfNeeded(force);
  }

  function queueCurrentProduct() {
    if (!currentProduct) {
      return;
    }

    batchProducts.push(currentProduct);
    currentProduct = null;
  }

  function assertProductBoundary(parentId, typename) {
    if (!currentProduct || currentProduct.id !== parentId) {
      orphanCount += 1;
      throw createProductSyncError(
        `Encountered ${typename} row without active parent product at line ${lineNumber}`,
        { code: "SYNC_ORPHAN_CHILD_ROW" },
      );
    }
  }

  try {
    await withTimeout(
      stageProductMirrorBatch({
        shop,
        syncBatchId,
        syncHistoryId,
      }),
      REPOSITORY_WRITE_TIMEOUT_MS,
      "Stage product mirror batch",
    );

    logInfo("Staged product mirror batch", context);

    const rl = readline.createInterface({
      input: dataStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      lineNumber += 1;

      if (!line.trim()) {
        continue;
      }

      const lineBytes = Buffer.byteLength(line, "utf8");
      maxLineBytes = Math.max(maxLineBytes, lineBytes);

      if (lineBytes > MAX_LINE_LENGTH_BYTES) {
        throw createProductSyncError(
          `Product sync line ${lineNumber} exceeded maximum supported size`,
          { code: "SYNC_LINE_TOO_LARGE" },
        );
      }

      let json;

      try {
        json = JSON.parse(line);
      } catch (error) {
        throw createProductSyncError(
          `Failed to parse product sync JSONL line ${lineNumber}: ${error.message}`,
          { code: "SYNC_LINE_PARSE_FAILED" },
        );
      }

      parseCount += 1;

      if (!json.__parentId && json.__typename === "Product") {
        queueCurrentProduct();
        await flushBatch();

        if (flushedProductIds.has(json.id)) {
          duplicateProductCount += 1;
          throw createProductSyncError(
            `Duplicate product row detected for ${json.id} at line ${lineNumber}`,
            { code: "SYNC_DUPLICATE_PRODUCT_ROW" },
          );
        }

        currentProduct = normalizeProductRecord(json);
        flushedProductIds.add(json.id);
        continue;
      }

      assertProductBoundary(json.__parentId, json.__typename);

      switch (json.__typename) {
        case "ProductVariant": {
          if (currentProduct.__variantIds.has(json.id)) {
            duplicateVariantCount += 1;
            break;
          }

          currentProduct.__variantIds.add(json.id);
          currentProduct.variants.push(buildVariantFromChildRow(json));
          break;
        }

        case "Collection": {
          if (currentProduct.__collectionIds.has(json.id)) {
            duplicateCollectionCount += 1;
            break;
          }

          currentProduct.__collectionIds.add(json.id);
          currentProduct.collections.push({
            id: json.id,
            title: json.title,
          });
          break;
        }

        case "Metafield": {
          const compositeKey =
            json.namespace && json.key ? `${json.namespace}:${json.key}` : null;

          if (compositeKey && currentProduct.__metafieldKeys.has(compositeKey)) {
            duplicateMetafieldCount += 1;
            break;
          }

          if (compositeKey) {
            currentProduct.__metafieldKeys.add(compositeKey);
          }

          for (const id of extractMetaobjectIds(json.value)) {
            currentProduct.__metaobjectIds.add(id);
          }

          currentProduct.metafields.push({
            namespace: json.namespace,
            key: json.key,
            type: json.type,
            value: json.value,
          });
          break;
        }

        case "MediaImage":
          currentProduct.featuredMedia = json;
          break;

        default:
          unknownRowCount += 1;
          logWarn("Ignored unknown product sync child row", context, {
            lineNumber,
            typename: json.__typename || "unknown",
          });
          break;
      }
    }

    queueCurrentProduct();
    await flushBatch(true);

    await withTimeout(
      activateProductMirrorBatch({
        shop,
        syncBatchId,
        totalProductsProcessed,
        syncHistoryId,
      }),
      REPOSITORY_WRITE_TIMEOUT_MS,
      "Activate product mirror batch",
    );

    logInfo("Activated product mirror batch", context, {
      totalProductsProcessed,
      totalVariantsProcessed,
      flushCount,
      parseCount,
      orphanCount,
      duplicateProductCount,
      duplicateVariantCount,
      duplicateCollectionCount,
      duplicateMetafieldCount,
      unknownRowCount,
      maxLineBytes,
    });

    return {
      totalProductsProcessed,
      totalVariantsProcessed,
      syncBatchId,
      flushCount,
      parseCount,
      orphanCount,
      duplicateProductCount,
      duplicateVariantCount,
      duplicateCollectionCount,
      duplicateMetafieldCount,
      unknownRowCount,
      maxLineBytes,
    };
  } catch (error) {
    failed = true;

    await markProductSyncFailed({
      shop,
      syncHistoryId,
      errorSummary: error.message,
      stage: "MIRROR_STAGING_FAILED",
    });

    await clearProductSyncCache(shop);

    logError("Product sync staging failed", context, {
      error: error.message,
      lineNumber,
      totalProductsProcessed,
      totalVariantsProcessed,
      flushCount,
      parseCount,
      orphanCount,
      duplicateProductCount,
      duplicateVariantCount,
      duplicateCollectionCount,
      duplicateMetafieldCount,
      unknownRowCount,
      maxLineBytes,
    });

    throw error;
  } finally {
    if (!failed) {
      await clearProductSyncCache(shop);
    }
  }
}
