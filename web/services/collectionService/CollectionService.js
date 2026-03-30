import logger from "../../utils/loggerUtils.js";
import promClient from "prom-client";
import { getCache, setCache } from "../../utils/cacheUtils.js";

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

const BULK_OPERATION_MUTATION = `mutation {
      bulkOperationRunQuery(
        query: """
          {
      collections {
        edges {
          node {
            id
            title
          }
        }
      }
    }
        """
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

  async fetchCollections(session, search = "") {
    const shop = session.shop;
    const cacheKey = `${shop}:fetchCollections:${search}`;
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
        ...(search
          ? {
              title: {
                contains: search,
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

  async clearCollections(session) {
    try {
      const shop = session.shop;
      const client = new this.shopify.api.clients.Graphql({ session });
      const bulkResponse = await client.query({
        data: {
          query: BULK_OPERATION_MUTATION,
        },
      });
      if (bulkResponse.body.errors) {
        throw new Error(bulkResponse.body.errors[0].message);
      }
      const bulkOperationId =
        bulkResponse.body.data.bulkOperationRunQuery.bulkOperation.id;
      const syncBatchId = createMirrorBatchId("collection_sync");

     await prisma.store.update({
  where: { shopUrl: shop },
  data: {
    isCollectionSyncing: true,
    lastCollectionSyncAt: new Date(),
  },
});
     await prisma.syncHistory.create({
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
      return {
        message: `Collections syncing started`,
        operationId: bulkOperationId,
      };
    } catch (err) {
      logger.error("Failed to clear collections", {
        shop: session.shop,
        error: err.message,
      });
      throw new Error(err.message);
    }
  }
}
