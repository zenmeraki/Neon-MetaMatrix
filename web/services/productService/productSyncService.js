import readline from "readline";
import {
  activateProductMirrorBatch,
  clearProductSyncCache,
  createProductSyncHistory,
  insertProductMirrorBatch,
  markProductSyncStarted,
  markSyncHistoryFailed,
  setStoreSyncQueued,
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

export async function startBulkOperationToFetchProducts({
  session,
  isInitialSync = false,
}) {
  const { bulkOperationId, responseBody } = await runProductBulkFetch({ session });

  await markProductSyncStarted({ shop: session.shop });
  await setStoreSyncQueued({ shop: session.shop, isInitialSync });
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
  let metaobjectLookup = new Map();

  try {
    const PRODUCT_BATCH_SIZE = 1000;

    let productBatch = [];
    let totalProductsProcessed = 0;
    let totalVariantsProcessed = 0;

    const productsMap = new Map();
    const referencedMetaobjectIds = new Set();

    const flushProductsAndVariants = async () => {
      if (productBatch.length === 0) return;

      const currentProducts = productBatch;
      productBatch = [];

      const productRows = [];
      const variantRows = [];

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

      await insertProductMirrorBatch({
        productRows,
        variantRows,
        syncBatchId,
      });

      totalProductsProcessed += productRows.length;
      totalVariantsProcessed += variantRows.length;

      if (totalProductsProcessed > 0 && totalProductsProcessed % 5000 === 0) {
        await updateInitialSyncProgress({ shop, totalProductsProcessed });
      }
    };

    const rl = readline.createInterface({
      input: dataStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;

      let json;
      try {
        json = JSON.parse(line);
      } catch (error) {
        throw new Error(`Product sync JSONL parse error: ${error.message}`);
      }

      if (!json.__parentId && json.__typename === "Product") {
        if (!productsMap.has(json.id)) {
          const productMetafields = extractMetafields(json.metafields);

          for (const metafield of productMetafields) {
            for (const id of extractMetaobjectIds(metafield?.value)) {
              referencedMetaobjectIds.add(id);
            }
          }

          productsMap.set(json.id, {
            ...json,
            variants: extractVariants(json.variants),
            metafields: productMetafields,
            collections: extractCollections(json.collections),
            options: Array.isArray(json.options) ? json.options : [],
            featuredMedia: json.featuredMedia || null,
          });
        }
        continue;
      }

      const parent = productsMap.get(json.__parentId);
      if (!parent) continue;

      switch (json.__typename) {
        case "ProductVariant":
          parent.variants.push({
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
          parent.collections.push({
            id: json.id,
            title: json.title,
          });
          break;

        case "Metafield":
          for (const id of extractMetaobjectIds(json.value)) {
            referencedMetaobjectIds.add(id);
          }

          parent.metafields.push({
            namespace: json.namespace,
            key: json.key,
            type: json.type,
            value: json.value,
          });
          break;

        case "MediaImage":
          parent.featuredMedia = json;
          break;

        default:
          break;
      }
    }

    if (!syncBatchId) {
      throw new Error("syncBatchId is required for staged product sync");
    }

    if (session?.accessToken && referencedMetaobjectIds.size > 0) {
      try {
        metaobjectLookup = await fetchMetaobjectLookupByIds(
          session,
          Array.from(referencedMetaobjectIds),
        );
      } catch (error) {
        console.error(
          `Failed to resolve metaobject labels for shop ${shop}: ${error.message}`,
        );
      }
    }

    await stageProductMirrorBatch({ shop, syncBatchId, syncHistoryId });

    for (const product of productsMap.values()) {
      productBatch.push(product);

      if (productBatch.length >= PRODUCT_BATCH_SIZE) {
        await flushProductsAndVariants();
      }
    }

    await flushProductsAndVariants();

    await activateProductMirrorBatch({
      shop,
      syncBatchId,
      totalProductsProcessed,
      syncHistoryId,
    });

    return {
      totalProductsProcessed,
      totalVariantsProcessed,
      syncBatchId,
    };
  } catch (error) {
    await markSyncHistoryFailed({
      syncHistoryId,
      errorMessage: error.message,
    });
    throw error;
  }
}