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
  fetchMetaobjectLookupByIds,
} from "./productSyncMetaobjects.js";

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
  let metaobjectLookup = new Map();

  return new Promise((resolve, reject) => {
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

    rl.on("line", (line) => {
      if (!line.trim()) return;

      try {
        const json = JSON.parse(line);

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
          return;
        }

        const parent = productsMap.get(json.__parentId);
        if (!parent) return;

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
      } catch (error) {
        console.error("Product sync line parse error:", error.message);
      }
    });

    rl.on("close", async () => {
      try {
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

        await stageProductMirrorBatch({ shop, syncBatchId });

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

        resolve({
          totalProductsProcessed,
          totalVariantsProcessed,
          syncBatchId,
        });
      } catch (error) {
        reject(error);
      }
    });

    rl.on("error", reject);
  });
}
