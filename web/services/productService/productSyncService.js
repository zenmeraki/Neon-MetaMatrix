import readline from "readline";
import {
  activateProductMirrorBatch,
  insertProductMirrorBatch,
  markSyncHistoryFailed,
  stageProductMirrorBatch,
  updateInitialSyncProgress,
} from "./productSyncRepository.js";
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

const getPendingChildren = (pendingChildrenByParentId, parentId) => {
  const pendingChildren = pendingChildrenByParentId.get(parentId) || [];
  pendingChildrenByParentId.delete(parentId);
  return pendingChildren;
};

const appendProductChild = ({ parent, json, referencedMetaobjectIds }) => {
  switch (json.__typename) {
    case "ProductVariant":
      if (parent.variants.some((variant) => variant?.id === json.id)) {
        break;
      }

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
};

export async function ingestCatalogJsonl({
  dataStream,
  shop,
  session,
  syncBatchId,
  catalogBatchId,
  syncHistoryId = null,
  responseUrl = null,
  onIngestHeartbeat = null,
}) {
  if (!catalogBatchId) {
    throw new Error("catalogBatchId is required for catalog JSONL ingest");
  }

  let metaobjectLookup = new Map();

  try {
    const PRODUCT_BATCH_SIZE = 1000;
    const HEARTBEAT_INTERVAL_MS = 30_000;

    let productBatch = [];
    let totalProductsProcessed = 0;
    let totalVariantsProcessed = 0;
    let lastHeartbeatAt = 0;

    const productsMap = new Map();
    const pendingChildrenByParentId = new Map();
    const referencedMetaobjectIds = new Set();

    const legacyMirrorBatchId = syncBatchId;
    const resolvedCatalogBatchId = catalogBatchId || legacyMirrorBatchId;

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
        syncBatchId: legacyMirrorBatchId,
        catalogBatchId: resolvedCatalogBatchId,
      });

      totalProductsProcessed += productRows.length;
      totalVariantsProcessed += variantRows.length;

      if (
        typeof onIngestHeartbeat === "function" &&
        Date.now() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS
      ) {
        lastHeartbeatAt = Date.now();
        await onIngestHeartbeat();
      }

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

          const product = {
            ...json,
            variants: extractVariants(json.variants),
            metafields: productMetafields,
            collections: extractCollections(json.collections),
            options: Array.isArray(json.options) ? json.options : [],
            featuredMedia: json.featuredMedia || null,
          };

          for (const pendingChild of getPendingChildren(
            pendingChildrenByParentId,
            json.id,
          )) {
            appendProductChild({
              parent: product,
              json: pendingChild,
              referencedMetaobjectIds,
            });
          }

          productsMap.set(json.id, product);
        }
        continue;
      }

      const parent = productsMap.get(json.__parentId);
      if (!parent) {
        const pendingChildren =
          pendingChildrenByParentId.get(json.__parentId) || [];
        pendingChildren.push(json);
        pendingChildrenByParentId.set(json.__parentId, pendingChildren);
        continue;
      }

      appendProductChild({ parent, json, referencedMetaobjectIds });
    }

    if (!legacyMirrorBatchId) {
      throw new Error("syncBatchId is required for staged product sync");
    }

    if (!resolvedCatalogBatchId) {
      throw new Error("catalogBatchId is required for staged product sync");
    }

    const orphanVariantParentIds = Array.from(
      pendingChildrenByParentId.entries(),
    )
      .filter(([, children]) =>
        children.some((child) => child.__typename === "ProductVariant"),
      )
      .map(([parentId]) => parentId);

    if (orphanVariantParentIds.length > 0) {
      const error = new Error(
        "Product sync artifact contains variant rows without parent product rows",
      );
      error.code = "PRODUCT_SYNC_ORPHAN_VARIANTS";
      error.httpStatus = 409;
      error.details = {
        orphanParentCount: orphanVariantParentIds.length,
        sampleParentIds: orphanVariantParentIds.slice(0, 10),
      };
      throw error;
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

    await stageProductMirrorBatch({
      shop,
      syncBatchId: legacyMirrorBatchId,
      syncHistoryId,
    });

    for (const product of productsMap.values()) {
      productBatch.push(product);

      if (productBatch.length >= PRODUCT_BATCH_SIZE) {
        await flushProductsAndVariants();
      }
    }

    await flushProductsAndVariants();

    await activateProductMirrorBatch({
      shop,
      syncBatchId: legacyMirrorBatchId,
      catalogBatchId: resolvedCatalogBatchId,
      totalProductsProcessed,
      syncHistoryId,
      responseUrl,
    });

    return {
      totalProductsProcessed,
      totalVariantsProcessed,
      syncBatchId: legacyMirrorBatchId,
      catalogBatchId: resolvedCatalogBatchId,
    };
  } catch (error) {
    await markSyncHistoryFailed({
      shop,
      syncHistoryId,
      errorMessage: error.message,
    });
    throw error;
  }
}
