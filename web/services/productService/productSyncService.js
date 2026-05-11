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
  flattenProductMetafield,
  flattenVariant,
} from "./productSyncTransformers.js";
import { extractMetaobjectIds } from "./productSyncMetaobjects.js";
import { validateCatalogConsistency } from "../catalogConsistencyValidatorService.js";
import { alertingService } from "../operationalAlertService.js";
import { enqueueAutomationAfterSync } from "../automation/automationEnqueueService.js";

const PRODUCT_BATCH_SIZE = 5000;
const VARIANT_ROOT_BATCH_SIZE = 15000;
const MAX_MALFORMED_LINES = 10;
const STREAM_IDLE_TIMEOUT_MS = 180_000;
const STREAM_PROGRESS_LOG_INTERVAL = 10_000;

export async function startBulkOperationToFetchProducts({
  session,
  isInitialSync = false,
  syncLeaseOwner = null,
}) {
  console.log(`[sync:start] shop=${session.shop} isInitialSync=${isInitialSync}`);

  const { bulkOperationId } = await runProductBulkFetch({ session });

  console.log(
    `[sync:bulk_created] shop=${session.shop} bulkOperationId=${bulkOperationId}`,
  );

  const syncHistory = await queueProductSyncStart({
    shop: session.shop,
    bulkOperationId,
    isInitialSync,
    syncLeaseOwner,
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
    let rootVariantBatch = [];
    let currentProduct = null;
    let batchReferencedMetaobjectIds = new Set();

    let totalProductsProcessed = 0;
    let totalVariantsProcessed = 0;
    let malformedLineCount = 0;
    let duplicateProductCount = 0;
    let orphanChildCount = 0;
    let skippedMetaobjectReferenceCount = 0;

    const pendingChildren = new Map();

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

    const getPendingBucket = (parentId) => {
      const existing = pendingChildren.get(parentId);
      if (existing) return existing;

      const created = {
        variants: [],
        collections: [],
        metafields: [],
        featuredMedia: null,
      };

      pendingChildren.set(parentId, created);
      return created;
    };

    const attachPendingChildren = (product) => {
      const pending = pendingChildren.get(product.id);
      if (!pending) return product;

      if (pending.variants.length) product.variants.push(...pending.variants);
      if (pending.collections.length) product.collections.push(...pending.collections);
      if (pending.metafields.length) product.metafields.push(...pending.metafields);
      if (pending.featuredMedia && !product.featuredMedia) {
        product.featuredMedia = pending.featuredMedia;
      }

      pendingChildren.delete(product.id);
      return product;
    };

    const flushProductsAndVariants = async () => {
      if (productBatch.length === 0 && rootVariantBatch.length === 0) return;

      const currentProducts = productBatch;
      const currentRootVariants = rootVariantBatch;
      const currentMetaobjectIds = batchReferencedMetaobjectIds;

      productBatch = [];
      rootVariantBatch = [];
      batchReferencedMetaobjectIds = new Set();

      const productRows = [];
      const variantRows = [];
      const productMetafieldRows = [];

      /**
       * FAST PATH:
       * Do not call Shopify while streaming JSONL.
       * Metaobject labels can be resolved later by a background enrichment job.
       */
      const metaobjectLookup = new Map();

      if (currentMetaobjectIds.size > 0) {
        skippedMetaobjectReferenceCount += currentMetaobjectIds.size;
        console.log(
          `[sync:metaobjects_skipped_fast_path] shop=${shop} count=${currentMetaobjectIds.size}`,
        );
      }

      for (const rawProduct of currentProducts) {
        productRows.push(flattenProduct(rawProduct, shop, metaobjectLookup));

        const rawVariants = Array.isArray(rawProduct.variants)
          ? rawProduct.variants
          : [];
        const rawMetafields = Array.isArray(rawProduct.metafields)
          ? rawProduct.metafields
          : [];

        for (const rawVariant of rawVariants) {
          if (!rawVariant?.id) continue;
          variantRows.push(flattenVariant(rawProduct.id, rawVariant, shop));
        }

        for (const rawMetafield of rawMetafields) {
          const row = flattenProductMetafield(rawProduct.id, rawMetafield, shop);
          if (row) productMetafieldRows.push(row);
        }
      }

      for (const rawVariant of currentRootVariants) {
        const productId = rawVariant?.product?.id;
        if (!rawVariant?.id || !productId) {
          orphanChildCount += 1;
          continue;
        }

        variantRows.push(flattenVariant(productId, rawVariant, shop));
      }

      await insertProductMirrorBatch({
        productRows,
        variantRows,
        productMetafieldRows,
        syncBatchId,
      });

      totalProductsProcessed += productRows.length;
      totalVariantsProcessed += variantRows.length;

      console.log(
        `[sync:flush] shop=${shop} products=${productRows.length} variants=${variantRows.length} metafields=${productMetafieldRows.length} totalProductsProcessed=${totalProductsProcessed} totalVariantsProcessed=${totalVariantsProcessed}`,
      );

      if (totalProductsProcessed > 0) {
        await updateInitialSyncProgress({ shop, totalProductsProcessed });
      }
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
    await stageProductMirrorBatch({ shop, syncBatchId, syncHistoryId });
    console.log(`[sync:staging_done] shop=${shop}`);

    const rl = readline.createInterface({
      input: dataStream,
      crlfDelay: Infinity,
    });

    let lineCount = 0;

    for await (const line of rl) {
      if (!line.trim()) continue;

      lineCount += 1;

      if (lineCount % STREAM_PROGRESS_LOG_INTERVAL === 0) {
        console.log(
          `[sync:stream_reading] shop=${shop} linesRead=${lineCount} bufferedProducts=${productBatch.length} bufferedRootVariants=${rootVariantBatch.length} pendingParents=${pendingChildren.size} hasCurrentProduct=${Boolean(currentProduct)}`,
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

      if (!json.__parentId && json.__typename === "ProductVariant") {
        rootVariantBatch.push(json);

        if (rootVariantBatch.length >= VARIANT_ROOT_BATCH_SIZE) {
          await flushProductsAndVariants();
        }

        continue;
      }

      const parentId = json.__parentId;
      if (!parentId) continue;

      const parent = currentProduct?.id === parentId ? currentProduct : null;
      const pending = parent ? null : getPendingBucket(parentId);

      switch (json.__typename) {
        case "ProductVariant": {
          const variant = {
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
          };

          if (parent) parent.variants.push(variant);
          else pending.variants.push(variant);

          break;
        }

        case "Collection": {
          const collection = {
            id: json.id,
            title: json.title,
          };

          if (parent) parent.collections.push(collection);
          else pending.collections.push(collection);

          break;
        }

        case "Metafield": {
          const metafield = {
            namespace: json.namespace,
            key: json.key,
            type: json.type,
            value: json.value,
          };

          if (parent) parent.metafields.push(metafield);
          else pending.metafields.push(metafield);

          break;
        }

        case "MediaImage":
          if (parent) parent.featuredMedia = json;
          else pending.featuredMedia = json;
          break;

        default:
          break;
      }

      if (!parent) {
        orphanChildCount += 1;
      }
    }

    await finalizeCurrentProduct();
    await flushProductsAndVariants();

    if (pendingChildren.size > 0) {
      orphanChildCount += pendingChildren.size;
      console.warn(
        `[sync:orphan_children] shop=${shop} count=${pendingChildren.size}`,
      );
    }

    console.log(
      `[sync:stream_done] shop=${shop} totalLinesRead=${lineCount} malformedLines=${malformedLineCount} duplicateProducts=${duplicateProductCount} orphanChildren=${orphanChildCount} skippedMetaobjectReferenceCount=${skippedMetaobjectReferenceCount}`,
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

    const consistency = await validateCatalogConsistency({
      shop,
      mirrorBatchId: syncBatchId,
    });

    if (consistency.status !== "READY") {
      throw new Error(
        `Catalog consistency validation failed: ${consistency.errors.join(", ")}`,
      );
    }

    try {
      await enqueueAutomationAfterSync({
        shop,
        mirrorBatchId: syncBatchId,
      });
    } catch (enqueueError) {
      console.warn(
        `[automation:enqueue_failed] shop=${shop} mirrorBatchId=${syncBatchId} error=${enqueueError.message}`,
      );
    }

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
      skippedMetaobjectReferenceCount,
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

    alertingService.syncFailure({
      shop,
      syncRunId: syncBatchId,
      error,
    });

    throw error;
  } finally {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
  }
}