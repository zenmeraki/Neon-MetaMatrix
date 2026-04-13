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
  console.log(`[sync:start] shop=${session.shop} isInitialSync=${isInitialSync}`);

  const { bulkOperationId, responseBody } = await runProductBulkFetch({ session });
  console.log(`[sync:bulk_created] shop=${session.shop} bulkOperationId=${bulkOperationId}`);
  await markProductSyncStarted({ shop: session.shop });
  await setStoreSyncQueued({ shop: session.shop, isInitialSync });
  await clearProductSyncCache(session.shop);

  const syncHistory = await createProductSyncHistory({
    shop: session.shop,
    bulkOperationId,
    isInitialSync,
  });

  console.log(`[sync:history_created] shop=${session.shop} syncHistoryId=${syncHistory.id} syncBatchId=${syncHistory.syncBatchId}`);


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
  if (!syncBatchId) {
    throw new Error("syncBatchId is required for staged product sync");
  }

  console.log(`[sync:stream_start] shop=${shop} syncBatchId=${syncBatchId} syncHistoryId=${syncHistoryId}`);

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

      console.log(`[sync:flush] shop=${shop} totalProductsProcessed=${totalProductsProcessed} totalVariantsProcessed=${totalVariantsProcessed}`);


      if (totalProductsProcessed > 0 && totalProductsProcessed % 5000 === 0) {
        await updateInitialSyncProgress({ shop, totalProductsProcessed });
      }
    };

    const rl = readline.createInterface({
      input: dataStream,
      crlfDelay: Infinity,
    });

    let lineCount = 0;
    for await (const line of rl) {
      if (!line.trim()) continue;
      lineCount++;

      // Log every 10k lines so you can see the stream is moving
      if (lineCount % 10000 === 0) {
        console.log(`[sync:stream_reading] shop=${shop} linesRead=${lineCount} productsMapSize=${productsMap.size}`);
      }

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

    console.log(`[sync:stream_done] shop=${shop} totalLinesRead=${lineCount} uniqueProducts=${productsMap.size} referencedMetaobjects=${referencedMetaobjectIds.size}`);


    if (session?.accessToken && referencedMetaobjectIds.size > 0) {
      console.log(`[sync:metaobjects_start] shop=${shop} count=${referencedMetaobjectIds.size}`);

      try {
        metaobjectLookup = await fetchMetaobjectLookupByIds(
          session,
          Array.from(referencedMetaobjectIds),
        );
        console.log(`[sync:metaobjects_done] shop=${shop} resolved=${metaobjectLookup.size}`);

      } catch (error) {
        console.error(
          `Failed to resolve metaobject labels for shop ${shop}: ${error.message}`,
        );
      }
    }
    console.log(`[sync:staging_start] shop=${shop} syncBatchId=${syncBatchId}`);

    await stageProductMirrorBatch({ shop, syncBatchId, syncHistoryId });
    console.log(`[sync:staging_done] shop=${shop}`);

    for (const product of productsMap.values()) {
      productBatch.push(product);

      if (productBatch.length >= PRODUCT_BATCH_SIZE) {
        await flushProductsAndVariants();
      }
    }

    await flushProductsAndVariants();

    console.log(`[sync:activating] shop=${shop} syncBatchId=${syncBatchId} totalProductsProcessed=${totalProductsProcessed}`);


    await activateProductMirrorBatch({
      shop,
      syncBatchId,
      totalProductsProcessed,
      syncHistoryId,
    });

    console.log(`[sync:complete] shop=${shop} syncBatchId=${syncBatchId} totalProductsProcessed=${totalProductsProcessed} totalVariantsProcessed=${totalVariantsProcessed}`);


    return {
      totalProductsProcessed,
      totalVariantsProcessed,
      syncBatchId,
    };
  } catch (error) {
     console.error(`[sync:failed] shop=${shop} syncBatchId=${syncBatchId} syncHistoryId=${syncHistoryId} error=${error.message}`);
    console.error(error.stack);
    
    await markSyncHistoryFailed({
      shop,
      syncHistoryId,
      errorMessage: error.message,
    });
    throw error;
  }
}