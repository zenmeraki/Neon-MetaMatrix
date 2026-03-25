import readline from "readline";
import {
  clearProductSyncCache,
  createProductSyncHistory,
  insertProductMirrorBatch,
  markProductSyncStarted,
  replaceShopProducts,
  updateInitialSyncProgress,
} from "./productSyncRepository.js";
import { runProductBulkFetch } from "./productSyncGateway.js";
import {
  extractCollections,
  extractVariants,
  flattenProduct,
  flattenVariant,
} from "./productSyncTransformers.js";

export async function startBulkOperationToFetchProducts({
  session,
  isInitialSync = false,
}) {
  const { bulkOperationId, responseBody } = await runProductBulkFetch({ session });

  await markProductSyncStarted({ shop: session.shop });
  await clearProductSyncCache(session.shop);
  await createProductSyncHistory({
    shop: session.shop,
    bulkOperationId,
    isInitialSync,
  });

  return {
    message: "Bulk product sync started",
    bulkOperationId,
    response: responseBody,
  };
}

export async function formatAndSyncProductsToDB({
  dataStream,
  shop,
  replaceShopData = true,
}) {
  return new Promise((resolve, reject) => {
    const PRODUCT_BATCH_SIZE = 1000;

    let productBatch = [];
    let totalProductsProcessed = 0;
    let totalVariantsProcessed = 0;

    const productsMap = new Map();

    const flushProductsAndVariants = async () => {
      if (productBatch.length === 0) return;

      const currentProducts = productBatch;
      productBatch = [];

      const productRows = [];
      const variantRows = [];

      for (const rawProduct of currentProducts) {
        productRows.push(flattenProduct(rawProduct, shop));

        const rawVariants = Array.isArray(rawProduct.variants)
          ? rawProduct.variants
          : [];

        for (const rawVariant of rawVariants) {
          if (!rawVariant?.id) continue;
          variantRows.push(flattenVariant(rawProduct.id, rawVariant, shop));
        }
      }

      await insertProductMirrorBatch({ productRows, variantRows });

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
            productsMap.set(json.id, {
              ...json,
              variants: extractVariants(json.variants),
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

          case "MediaImage":
            parent.featuredMedia = json;
            break;

          default:
            break;
        }
      } catch (err) {
        console.error("âŒ Line parse error:", err.message);
      }
    });

    rl.on("close", async () => {
      try {
        if (replaceShopData) {
          await replaceShopProducts(shop);
        }

        for (const product of productsMap.values()) {
          productBatch.push(product);

          if (productBatch.length >= PRODUCT_BATCH_SIZE) {
            await flushProductsAndVariants();
          }
        }

        await flushProductsAndVariants();

        console.log(
          `âœ… Product+Variant sync completed. products=${totalProductsProcessed} variants=${totalVariantsProcessed}`,
        );

        resolve({
          totalProductsProcessed,
          totalVariantsProcessed,
        });
      } catch (err) {
        reject(err);
      }
    });

    rl.on("error", (err) => {
      console.error("âŒ Readline error:", err);
      reject(err);
    });
  });
}
