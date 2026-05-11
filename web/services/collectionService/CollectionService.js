import logger from "../../utils/loggerUtils.js";
import promClient from "prom-client";
import { getCache, setCache } from "../../utils/cacheUtils.js";
import { adminGraphqlWithRetry } from "../../utils/shopifyAdminApi.js";
import { graphqlProductCollectionsBulkSyncQuery } from "../../graphql/product.js";

import { prisma } from "../../config/database.js";
import { createMirrorBatchId } from "../mirrorHealthService.js";

export const metrics = {
  collectionFetchLatency: new promClient.Histogram({
    name: "collection_fetch_latency_seconds",
    help: "Time to fetch collections by source",
    buckets: [0.1, 0.3, 0.5, 1, 2, 5],
    labelNames: ["source"],
  }),
  cacheHits: new promClient.Counter({
    name: "collection_cache_hit_total",
    help: "Cache hits by source",
    labelNames: ["source"],
  }),
  cacheMisses: new promClient.Counter({
    name: "collection_cache_miss_total",
    help: "Cache misses total",
    labelNames: ["level"], // version | data
  }),
  syncJobs: new promClient.Counter({
    name: "collection_sync_jobs_total",
    help: "Total sync jobs by status",
    labelNames: ["status"],
  }),
};

const BULK_OPERATION_MUTATION = `mutation RunCollectionBulkFetch($query: String!) {
      bulkOperationRunQuery(
        query: $query
      ) {
        bulkOperation {
          id
          status
        }
        userErrors {
          field
          message
        }
      }
    }`;

export class CollectionService {
  constructor(shopifyClient) {
    this.shopify = shopifyClient;
  }

  async fetchCollections(input, search = "") {
    const session = input?.session || input;
    const shop = input?.shop || session?.shop;
    const searchText = input?.searchText ?? search;

    if (!session?.shop || !shop || session.shop !== shop) {
      throw new Error("COLLECTION_FETCH_SHOP_MISMATCH");
    }

    const cacheKey = `${shop}:fetchCollections:${searchText}`;
    const cacheCollections = await getCache(cacheKey);

    if (cacheCollections)
      return { message: "Collections from cache", data: cacheCollections };

    const store = await prisma.store.findUnique({
      where: { shopUrl: shop },
      select: { activeCollectionBatchId: true },
    });

    const dbCollection = await prisma.collection.findMany({
      where: {
        shop,
        ...(store?.activeCollectionBatchId
          ? { mirrorBatchId: store.activeCollectionBatchId }
          : {}),
        ...(searchText
          ? {
              title: {
                contains: searchText,
                mode: "insensitive",
              },
            }
          : {}),
      },
      take: 20,
    });
    await setCache(cacheKey, dbCollection, 300); // Cache for 5 minutes
    return { message: "Collection from database", data: dbCollection };
  }

  async clearCollections(input) {
    let session = null;
    let shop = null;

    try {
      session = input?.session || input;
      shop = input?.shop || session?.shop;
      if (!session?.shop || !shop || session.shop !== shop) {
        throw new Error("COLLECTION_SYNC_SHOP_MISMATCH");
      }

      const bulkResponse = await adminGraphqlWithRetry({
        session,
        shop: session.shop,
        operationName: "CollectionBulkOperationRunQuery",
        data: {
          query: BULK_OPERATION_MUTATION,
          variables: {
            query: graphqlProductCollectionsBulkSyncQuery.trim(),
          },
        },
      });
      if (bulkResponse.body.errors) {
        throw new Error(bulkResponse.body.errors[0].message);
      }
      const bulkOperationId =
        bulkResponse.body.data.bulkOperationRunQuery.bulkOperation.id;
      const syncBatchId = createMirrorBatchId("collection_sync");

      const syncHistory = await prisma.$transaction(async (tx) => {
        await tx.collectionMirrorBatch.create({
          data: {
            id: syncBatchId,
            shop,
            bulkOperationId,
            status: "SHOPIFY_BULK_RUNNING",
          },
        });

        return tx.syncHistory.create({
          data: {
            shop,
            status: "processing",
            bulkOperationId,
            syncBatchId,
            stage: "SHOPIFY_BULK_RUNNING",
            operationType: "Collection",
            duration: 0,
            recordCount: 0,
          },
        });
      });

      return {
        message: "Collection mirror sync started",
        operationId: bulkOperationId,
        syncBatchId,
        syncHistoryId: syncHistory.id,
      };
    } catch (err) {
      logger.error("Failed to start collection mirror sync", {
        shop,
        error: err.message,
      });
      throw new Error(err.message);
    }
  }
}
