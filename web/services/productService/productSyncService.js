import readline from "readline";
import {
  activateProductMirrorBatch,
  clearProductSyncCache,
  insertProductMirrorBatch,
  markSyncHistoryFailed,
  queueProductSyncStart,
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
import { extractMetaobjectIds } from "./productSyncMetaobjects.js";

const PRODUCT_BATCH_SIZE = Number(process.env.PRODUCT_SYNC_BATCH_SIZE || 10000);
const PROGRESS_UPDATE_INTERVAL = Number(
  process.env.PRODUCT_SYNC_PROGRESS_INTERVAL || 25000,
);
const MAX_MALFORMED_LINES = 10;
const STREAM_IDLE_TIMEOUT_MS = 60_000;

export async function startBulkOperationToFetchProducts({
  session,
  isInitialSync = false,
}) {
  console.log(
    `[sync:start] shop=${session.shop} isInitialSync=${isInitialSync}`,
  );

  const { bulkOperationId } = await runProductBulkFetch({ session });

  console.log(
    `[sync:bulk_created] shop=${session.shop} bulkOperationId=${bulkOperationId}`,
  );

  const syncHistory = await queueProductSyncStart({
    shop: session.shop,
    bulkOperationId,
    isInitialSync,
  });

  console.log(
    `[sync:history_created] shop=${session.shop} syncHistoryId=${syncHistory.id} syncBatchId=${syncHistory.syncBatchId}`,
  );

  await clearProductSyncCache(session.shop);

  return {
    message: "Bulk product sync started",
    bulkOperationId,
    syncHistoryId: syncHistory.id,
    syncBatchId: syncHistory.syncBatchId,
  };
}

export async function formatAndSyncProductsToDB({
  dataStream,
  shop,
  session,
  syncBatchId,
  syncHistoryId = null,
}) {
  if (!syncBatchId) {
    throw new Error("syncBatchId is required for staged product sync");
  }

  console.log(
    `[sync:stream_start] shop=${shop} syncBatchId=${syncBatchId} syncHistoryId=${syncHistoryId}`,
  );

  let idleTimer = null;

  try {
    let productBatch = [];
    let totalProductsProcessed = 0;
    let totalVariantsProcessed = 0;
    let lastProgressUpdate = 0;
    let malformedLineCount = 0;
    let duplicateProductCount = 0;
    let orphanChildCount = 0;
    let currentProduct = null;

    const pendingChildren = new Map();
    let batchReferencedMetaobjectIds = new Set();

    const clearIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    const resetIdleTimer = () => {
      clearIdleTimer();
      idleTimer = setTimeout(() => {
        dataStream.destroy(
          new Error("Product sync stream timed out while reading JSONL"),
        );
      }, STREAM_IDLE_TIMEOUT_MS);
    };

    resetIdleTimer();

    dataStream.on("data", resetIdleTimer);
    dataStream.on("error", clearIdleTimer);
    dataStream.on("end", clearIdleTimer);
    dataStream.on("close", clearIdleTimer);

    const addMetaobjectIdsFromMetafields = (metafields = []) => {
      for (const metafield of metafields) {
        for (const id of extractMetaobjectIds(metafield?.value)) {
          batchReferencedMetaobjectIds.add(id);
        }
      }
    };

    const attachPendingChildren = (product) => {
      const pending = pendingChildren.get(product.id);

      if (!pending) {
        return product;
      }

      if (pending.variants.length) {
        product.variants.push(...pending.variants);
      }

      if (pending.collections.length) {
        product.collections.push(...pending.collections);
      }

      if (pending.metafields.length) {
        product.metafields.push(...pending.metafields);
      }

      if (pending.featuredMedia && !product.featuredMedia) {
        product.featuredMedia = pending.featuredMedia;
      }

      pendingChildren.delete(product.id);
      return product;
    };

    const maybeUpdateProgress = async ({ force = false } = {}) => {
      if (totalProductsProcessed <= 0) return;

      if (
        force ||
        totalProductsProcessed - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL
      ) {
        await updateInitialSyncProgress({
          shop,
          totalProductsProcessed,
        });

        lastProgressUpdate = totalProductsProcessed;
      }
    };

    const flushProductsAndVariants = async () => {
      if (productBatch.length === 0) return;

      const currentProducts = productBatch;
      const currentMetaobjectIds = batchReferencedMetaobjectIds;

      productBatch = [];
      batchReferencedMetaobjectIds = new Set();

      const productRows = [];
      const variantRows = [];

      // Critical speed path:
      // Do not call Shopify GraphQL while ingesting JSONL.
      // Metaobject labels should be resolved later by an enrichment worker.
      const metaobjectLookup = new Map();

      if (currentMetaobjectIds.size > 0) {
        console.log("[sync:metaobjects_deferred]", {
          shop,
          count: currentMetaobjectIds.size,
        });
      }

      for (const rawProduct of currentProducts) {
        productRows.push(flattenProduct(rawProduct, shop, metaobjectLookup));

        const rawVariants = Array.isArray(rawProduct.variants)
          ? rawProduct.variants
          : [];

        for (const rawVariant of rawVariants) {
          if (!rawVariant?.id) continue;

          variantRows.push(flattenVariant(rawProduct.id, rawVariant, shop));
        }
      }

      const insertStartedAt = Date.now();

      await insertProductMirrorBatch({
        productRows,
        variantRows,
        syncBatchId,
      });

      const insertDurationMs = Date.now() - insertStartedAt;

      totalProductsProcessed += productRows.length;
      totalVariantsProcessed += variantRows.length;

      console.log(
        `[sync:flush] shop=${shop} products=${productRows.length} variants=${variantRows.length} insertMs=${insertDurationMs} totalProductsProcessed=${totalProductsProcessed} totalVariantsProcessed=${totalVariantsProcessed}`,
      );

      await maybeUpdateProgress();
    };

    const finalizeCurrentProduct = async () => {
      if (!currentProduct) return;

      productBatch.push(currentProduct);
      addMetaobjectIdsFromMetafields(currentProduct.metafields);
      currentProduct = null;

      if (productBatch.length >= PRODUCT_BATCH_SIZE) {
        await flushProductsAndVariants();
      }
    };

    console.log(`[sync:staging_start] shop=${shop} syncBatchId=${syncBatchId}`);

    await stageProductMirrorBatch({
      shop,
      syncBatchId,
      syncHistoryId,
    });

    console.log(`[sync:staging_done] shop=${shop}`);

    const rl = readline.createInterface({
      input: dataStream,
      crlfDelay: Infinity,
    });

    let lineCount = 0;

    for await (const line of rl) {
      if (!line.trim()) continue;

      lineCount += 1;

      if (lineCount % 10000 === 0) {
        console.log(
          `[sync:stream_reading] shop=${shop} linesRead=${lineCount} bufferedProducts=${
            productBatch.length
          } hasCurrentProduct=${Boolean(currentProduct)}`,
        );
      }

      let json;

      try {
        json = JSON.parse(line);
      } catch (error) {
        malformedLineCount += 1;

        console.error(
          `[sync:jsonl_malformed] shop=${shop} count=${malformedLineCount} error=${error.message}`,
        );

        if (malformedLineCount > MAX_MALFORMED_LINES) {
          throw new Error(
            `Product sync JSONL parse error threshold exceeded: ${error.message}`,
          );
        }

        continue;
      }

      if (!json.__parentId && json.__typename === "Product") {
        if (currentProduct?.id === json.id) {
          duplicateProductCount += 1;

          console.warn(
            `[sync:duplicate_product] shop=${shop} productId=${json.id} duplicates=${duplicateProductCount}`,
          );
        } else {
          await finalizeCurrentProduct();
        }

        const productMetafields = extractMetafields(json.metafields);

        currentProduct = attachPendingChildren({
          ...json,
          variants: extractVariants(json.variants),
          metafields: productMetafields,
          collections: extractCollections(json.collections),
          options: Array.isArray(json.options) ? json.options : [],
          featuredMedia: json.featuredMedia || null,
        });

        continue;
      }

      const parentId = json.__parentId;
      if (!parentId) continue;

      const parent = currentProduct?.id === parentId ? currentProduct : null;

      const pending = pendingChildren.get(parentId) || {
        variants: [],
        collections: [],
        metafields: [],
        featuredMedia: null,
      };

      switch (json.__typename) {
        case "ProductVariant":
          (parent ? parent.variants : pending.variants).push({
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
            selectedOptions: Array.isArray(json.selectedOptions)
              ? json.selectedOptions
              : [],
            inventoryItem: json.inventoryItem || null,
          });
          break;

        case "Collection":
          (parent ? parent.collections : pending.collections).push({
            id: json.id,
            title: json.title,
          });
          break;

        case "Metafield":
          (parent ? parent.metafields : pending.metafields).push({
            namespace: json.namespace,
            key: json.key,
            type: json.type,
            value: json.value,
          });
          break;

        case "MediaImage":
          if (parent) {
            parent.featuredMedia = json;
          } else {
            pending.featuredMedia = json;
          }
          break;

        default:
          break;
      }

      if (!parent) {
        orphanChildCount += 1;
      }

      pendingChildren.set(parentId, pending);
    }

    await finalizeCurrentProduct();
    await flushProductsAndVariants();
    await maybeUpdateProgress({ force: true });

    if (pendingChildren.size > 0) {
      orphanChildCount += pendingChildren.size;

      console.warn(
        `[sync:orphan_children] shop=${shop} count=${pendingChildren.size}`,
      );
    }

    console.log(
      `[sync:stream_done] shop=${shop} totalLinesRead=${lineCount} malformedLines=${malformedLineCount} duplicateProducts=${duplicateProductCount} orphanChildren=${orphanChildCount}`,
    );

    console.log(
      `[sync:activating] shop=${shop} syncBatchId=${syncBatchId} totalProductsProcessed=${totalProductsProcessed}`,
    );

    await activateProductMirrorBatch({
      shop,
      syncBatchId,
      totalProductsProcessed,
      syncHistoryId,
    });

    console.log(
      `[sync:complete] shop=${shop} syncBatchId=${syncBatchId} totalProductsProcessed=${totalProductsProcessed} totalVariantsProcessed=${totalVariantsProcessed}`,
    );

    return {
      totalProductsProcessed,
      totalVariantsProcessed,
      syncBatchId,
      malformedLineCount,
      duplicateProductCount,
      orphanChildCount,
    };
  } catch (error) {
    console.error(
      `[sync:failed] shop=${shop} syncBatchId=${syncBatchId} syncHistoryId=${syncHistoryId} error=${error.message}`,
    );
    console.error(error.stack);

    await markSyncHistoryFailed({
      shop,
      syncHistoryId,
      errorMessage: error.message,
    });

    throw error;
  } finally {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
  }
}
