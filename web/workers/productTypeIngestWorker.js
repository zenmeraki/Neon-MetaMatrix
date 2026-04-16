import { prisma } from "../Config/database.js";
import * as domainFreshnessService from "../services/sync/domainFreshnessService.js";
import * as syncRunService from "../services/sync/syncRunService.js";
import { clearKeyCaches } from "../utils/cacheUtils.js";
import {
  downloadJsonlStream,
  parseJsonlStream,
} from "../utils/jsonlStreamUtils.js";

/**
 * Product type ingest worker.
 *
 * Current behavior:
 * - streams product id/productType rows from a Shopify bulk query
 * - updates existing Product mirror rows for the shop
 * - clears product-type/filter caches
 */

const PRODUCT_TYPE_CACHE_KEYS = (shop) => [
  `${shop}:sync_details`,
  `${shop}:productTypes:`,
  `${shop}:ProductFilterValues:product_type`,
];

const assertShop = (shop) => {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required");
  }
};

const assertUrl = (sourceUrl) => {
  if (!sourceUrl || typeof sourceUrl !== "string") {
    throw new Error("sourceUrl is required");
  }
};

const normalizeProductTypeRow = (json) => {
  if (!json || !json.id) {
    return null;
  }

  if (json.__typename && json.__typename !== "Product") {
    return null;
  }

  return {
    id: json.id,
    productType: json.productType || null,
  };
};

const PRODUCT_TYPE_BATCH_SIZE = 1000;

const parseAndApplyProductTypes = async ({ dataStream, shop }) => {
  const rows = [];

  for await (const { value: json } of parseJsonlStream(dataStream)) {
    const row = normalizeProductTypeRow(json);
    if (row) rows.push(row);
  }

  if (rows.length === 0) return { recordCount: 0 };

  const now = new Date();
  let recordCount = 0;

  for (let i = 0; i < rows.length; i += PRODUCT_TYPE_BATCH_SIZE) {
    const chunk = rows.slice(i, i + PRODUCT_TYPE_BATCH_SIZE);
    const results = await prisma.$transaction(
      chunk.map((row) =>
        prisma.product.updateMany({
          where: { shop, id: row.id },
          data: { productType: row.productType, lastReconciledAt: now },
        }),
      ),
    );
    recordCount += results.reduce((sum, r) => sum + r.count, 0);
  }

  return { recordCount };
};

export const ingestProductTypeArtifact = async ({
  shop,
  sourceUrl,
  syncRunId = null,
  syncHistoryId = null,
}) => {
  assertShop(shop);
  assertUrl(sourceUrl);

  try {
    if (syncRunId) {
      await syncRunService.heartbeatSyncRun({
        syncRunId,
        stage: "PRODUCT_TYPE_STAGING",
        responseUrl: sourceUrl,
      });
    }

    const dataStream = await downloadJsonlStream({
      sourceUrl,
      errorLabel: "product type artifact",
    });
    const { recordCount } = await parseAndApplyProductTypes({
      dataStream,
      shop,
    });

    await domainFreshnessService.markDomainFresh({
      shop,
      domain: domainFreshnessService.FRESHNESS_DOMAIN.PRODUCT_TYPE,
      lastFreshAt: new Date(),
      source: "PRODUCT_TYPE_INGEST",
      sourceRunId: syncRunId,
      details: {
        recordCount,
      },
    }).catch(() => {});

    await prisma.store.update({
      where: { shopUrl: shop },
      data: {
        isProductTypeSyncing: false,
        lastProductTypeSyncAt: new Date(),
      },
    });

    if (syncHistoryId) {
      await prisma.syncHistory.update({
        where: { id: syncHistoryId },
        data: {
          status: "completed",
          stage: "COMPLETED",
          responseUrl: sourceUrl,
          recordCount,
        },
      }).catch(() => {});
    }

    if (syncRunId) {
      await syncRunService.markSyncRunCompleted({
        syncRunId,
        stage: "PRODUCT_TYPE_COMPLETED",
        rowCount: recordCount,
        responseUrl: sourceUrl,
      }).catch(() => {});
    }

    await Promise.all(
      PRODUCT_TYPE_CACHE_KEYS(shop).map((cacheKey) => clearKeyCaches(cacheKey)),
    );

    return {
      success: true,
      shop,
      recordCount,
    };
  } catch (error) {
    if (syncRunId) {
      await syncRunService.markSyncRunFailed({
        syncRunId,
        stage: "PRODUCT_TYPE_FAILED",
        failureCode: error.code || "PRODUCT_TYPE_INGEST_FAILED",
        failureMessage: error.message || "Product type ingest failed",
        responseUrl: sourceUrl,
      }).catch(() => {});
    }

    await domainFreshnessService.markDomainStale({
      shop,
      domain: domainFreshnessService.FRESHNESS_DOMAIN.PRODUCT_TYPE,
      staleReason: error.message || "Product type ingest failed",
      repairRequired: false,
      source: "PRODUCT_TYPE_INGEST",
      sourceRunId: syncRunId,
    }).catch(() => {});

    throw error;
  }
};

export const processProductTypeIngestJob = ingestProductTypeArtifact;
