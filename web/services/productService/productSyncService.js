import readline from "readline";
import {
  activateProductMirrorBatch,
  clearProductSyncCache,
  createProductSyncHistory,
  insertProductMirrorBatch,
  markProductSyncStarted,
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
  fetchMetaobjectLookupByIdsDetailed,
} from "./productSyncMetaobjects.js";
import {
  SYNC_EXECUTION_STATES,
  updateSyncExecutionState,
} from "../syncExecutionStateService.js";
import { markRepairRequired, MIRROR_STALE_REASONS } from "../mirrorHealthService.js";
import { recordMirrorAnomaly } from "../mirrorAnomalyService.js";

export async function startBulkOperationToFetchProducts({
  session,
  isInitialSync = false,
}) {
  const { bulkOperationId, responseBody } = await runProductBulkFetch({ session });

  await markProductSyncStarted({ shop: session.shop });
  await clearProductSyncCache(session.shop);
  const syncHistory = await createProductSyncHistory({
    shop: session.shop,
    bulkOperationId,
    isInitialSync,
  });

  return {
    message: "Bulk product sync started",
    bulkOperationId,
    syncHistoryId: syncHistory.id,
    syncBatchId: syncHistory.syncBatchId,
    response: responseBody,
  };
}

export async function formatAndSyncProductsToDB({
  dataStream,
  shop,
  session,
  syncBatchId,
  syncHistoryId = null,
}) {
  const PRODUCT_BATCH_SIZE = 1000;
  let productBatch = [];
  let referencedMetaobjectIds = new Set();
  let totalProductsProcessed = 0;
  let totalVariantsProcessed = 0;
  let lineNumber = 0;
  let currentProduct = null;
  let metaobjectEnrichmentDegraded = false;

  const enrichProductNode = (json) => {
    const productMetafields = extractMetafields(json.metafields);

    for (const metafield of productMetafields) {
      for (const id of extractMetaobjectIds(metafield?.value)) {
        referencedMetaobjectIds.add(id);
      }
    }

    return {
      ...json,
      variants: extractVariants(json.variants),
      metafields: productMetafields,
      collections: extractCollections(json.collections),
      options: Array.isArray(json.options) ? json.options : [],
      featuredMedia: json.featuredMedia || null,
    };
  };

  const queueCompletedProduct = async () => {
    if (!currentProduct) {
      return;
    }

    productBatch.push(currentProduct);
    currentProduct = null;

    if (productBatch.length >= PRODUCT_BATCH_SIZE) {
      await flushProductsAndVariants();
    }
  };

  const flushProductsAndVariants = async () => {
    if (productBatch.length === 0) return;

    const currentProducts = productBatch;
    productBatch = [];
    const currentMetaobjectIds = Array.from(referencedMetaobjectIds);
    referencedMetaobjectIds = new Set();
    let metaobjectLookup = new Map();

    const productRows = [];
    const variantRows = [];

    if (session?.accessToken && currentMetaobjectIds.length > 0) {
      const metaobjectResult = await fetchMetaobjectLookupByIdsDetailed(
        session,
        currentMetaobjectIds,
        { bestEffort: true },
      );
      metaobjectLookup = metaobjectResult.lookup;
      if (metaobjectResult.degraded) {
        metaobjectEnrichmentDegraded = true;
      }
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

    const insertResult = await insertProductMirrorBatch({
      productRows,
      variantRows,
      syncBatchId,
    });

    totalProductsProcessed += insertResult?.insertedProducts ?? productRows.length;
    totalVariantsProcessed += insertResult?.insertedVariants ?? variantRows.length;

    if (totalProductsProcessed > 0 && totalProductsProcessed % 5000 === 0) {
      await updateInitialSyncProgress({ shop, totalProductsProcessed });
      if (syncHistoryId) {
        await updateSyncExecutionState({
          syncHistoryId,
          shop,
          state: SYNC_EXECUTION_STATES.FINALIZING,
          stage: "MIRROR_STAGING",
        });
      }
    }
  };

  const rl = readline.createInterface({
    input: dataStream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl) {
      lineNumber += 1;

      if (!line.trim()) {
        continue;
      }

      let json;
      try {
        json = JSON.parse(line);
      } catch (error) {
        throw new Error(
          `Product sync JSONL parse failed at line ${lineNumber}: ${error.message}`,
        );
      }

      if (!json.__parentId && json.__typename === "Product") {
        await queueCompletedProduct();
        currentProduct = enrichProductNode(json);
        continue;
      }

      if (!currentProduct || currentProduct.id !== json.__parentId) {
        continue;
      }

      switch (json.__typename) {
        case "ProductVariant":
          currentProduct.variants.push({
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
          currentProduct.collections.push({
            id: json.id,
            title: json.title,
          });
          break;

        case "Metafield":
          for (const id of extractMetaobjectIds(json.value)) {
            referencedMetaobjectIds.add(id);
          }

          currentProduct.metafields.push({
            namespace: json.namespace,
            key: json.key,
            type: json.type,
            value: json.value,
          });
          break;

        case "MediaImage":
          currentProduct.featuredMedia = json;
          break;

        default:
          break;
      }
    }

    if (!syncBatchId) {
      throw new Error("syncBatchId is required for staged product sync");
    }

    await stageProductMirrorBatch({ shop, syncBatchId });
    if (syncHistoryId) {
      await updateSyncExecutionState({
        syncHistoryId,
        shop,
        state: SYNC_EXECUTION_STATES.FINALIZING,
        stage: "MIRROR_STAGING",
      });
    }

    await queueCompletedProduct();

    await flushProductsAndVariants();

    await activateProductMirrorBatch({
      shop,
      syncBatchId,
      totalProductsProcessed,
      syncHistoryId,
    });

    if (metaobjectEnrichmentDegraded) {
      await markRepairRequired({
        shop,
        reason: MIRROR_STALE_REASONS.PARTIAL_MIRROR_DETECTED,
        summary: "Metaobject/category enrichment was incomplete during full sync",
        severity: "medium",
        details: {
          syncHistoryId,
          syncBatchId,
          source: "product_full_sync",
        },
      }).catch(() => {});

      await recordMirrorAnomaly({
        shop,
        severity: "medium",
        type: "metaobject_enrichment_degraded",
        entityType: "syncHistory",
        entityId: syncHistoryId,
        message: "Metaobject/category enrichment was incomplete during full sync",
        details: {
          syncBatchId,
        },
      }).catch(() => {});
    }

    return {
      totalProductsProcessed,
      totalVariantsProcessed,
      syncBatchId,
    };
  } finally {
    rl.close();
  }
}
