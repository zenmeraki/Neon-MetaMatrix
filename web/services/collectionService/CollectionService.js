import promClient from "prom-client";
import { getCache, setCache } from "../../utils/cacheUtils.js";

import * as domainFreshnessService from "../sync/domainFreshnessService.js";
import {
  getActiveBatchIds,
  MirrorNotReadyError,
} from "../sync/catalogSnapshotService.js";
import * as collectionMembershipRepository from "../../repositories/collectionMembershipRepository.js";
import * as catalogSyncService from "../sync/catalogSyncService.js";

const COLLECTION_SELECTOR_LIMIT_MAX = 50;

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
    labelNames: ["source"],
  }),
  syncJobs: new promClient.Counter({
    name: "collection_sync_jobs_total",
    help: "Total sync jobs by status",
    labelNames: ["status"],
  }),
};

const normalizeCollectionFetchArgs = ({ search, take }) => {
  const normalizedSearch = String(search || "").trim();
  const numericTake = Number(take);
  const normalizedTake =
    Number.isInteger(numericTake) && numericTake > 0
      ? Math.min(numericTake, COLLECTION_SELECTOR_LIMIT_MAX)
      : 20;

  return {
    search: normalizedSearch,
    cacheSearch: normalizedSearch.toLowerCase(),
    take: normalizedTake,
  };
};

const unavailableCollectionMirrorResult = ({ reason, activeBatch = null }) => ({
  message: "Collection mirror snapshot unavailable",
  data: [],
  syncRequired: true,
  cacheable: false,
  meta: {
    reason,
    catalogBatchId: activeBatch?.catalogBatchId || null,
    snapshotId: activeBatch?.snapshotId || null,
  },
});

const resolveActiveCollectionMembershipBatch = async ({
  shop,
  activeBatch = null,
}) => {
  const resolvedBatch =
    activeBatch || (await getActiveBatchIds({ shop, path: "collection_fetch" }));

  if (!resolvedBatch?.catalogBatchId) {
    return {
      available: false,
      result: unavailableCollectionMirrorResult({
        reason: resolvedBatch?.reason || "active_catalog_snapshot_missing",
        activeBatch: resolvedBatch,
      }),
    };
  }

  return {
    available: true,
    catalogBatchId: resolvedBatch.catalogBatchId,
    collectionMembershipBatchId: resolvedBatch.catalogBatchId,
    collectionMirrorBatchId: resolvedBatch.catalogBatchId,
  };
};

export class CollectionService {
  async fetchCollections(session, search = "", take = 20) {
    const shop = session.shop;
    const endTimer = metrics.collectionFetchLatency.startTimer();
    let timerSource = "error";

    try {
      const normalized = normalizeCollectionFetchArgs({ search, take });
      const cacheKey =
        `${shop}:fetchCollections:${normalized.cacheSearch}:${normalized.take}`;
      const cacheCollections = await getCache(cacheKey);

      if (cacheCollections) {
        metrics.cacheHits.inc({ source: "mirror" });
        timerSource = "cache";
        return { message: "Collections from cache", data: cacheCollections };
      }

      metrics.cacheMisses.inc({ source: "mirror" });

      const freshnessGate = await domainFreshnessService.assertDomainsFresh({
        shop,
        domains: [domainFreshnessService.FRESHNESS_DOMAIN.COLLECTION],
        source: "CollectionService.fetchCollections",
      });

      let batchScope;

      try {
        batchScope = await resolveActiveCollectionMembershipBatch({
          shop,
          activeBatch: freshnessGate?.freshness?.activeCatalogBatch || null,
        });
      } catch (error) {
        if (!(error instanceof MirrorNotReadyError)) {
          throw error;
        }

        timerSource = "unavailable";
        return unavailableCollectionMirrorResult({
          reason: error.details?.reason || "active_catalog_snapshot_unavailable",
          activeBatch: error.details,
        });
      }

      if (!batchScope.available) {
        timerSource = "unavailable";
        return batchScope.result;
      }

      // Collection and membership rows share catalogBatchId as the read-plane
      // authority. mirrorBatchId is only a legacy alias on Collection.
      const dbCollection =
        await collectionMembershipRepository.listCollectionMirrorsByBatch({
          shop,
          catalogBatchId: batchScope.collectionMirrorBatchId,
          search: normalized.search,
          take: normalized.take,
        });

      await setCache(cacheKey, dbCollection, 300); // Cache for 5 minutes
      timerSource = "db";
      return { message: "Collections from database", data: dbCollection };
    } finally {
      endTimer({ source: timerSource });
    }
  }

  async clearCollections(session) {
    if (!session?.shop) {
      throw new Error("Shopify session missing");
    }

    metrics.syncJobs.inc({ status: "started" });

    try {
      const result = await catalogSyncService.startCollectionMembershipSync({
        shop: session.shop,
        session,
      });

      metrics.syncJobs.inc({ status: "accepted" });
      return result;
    } catch (err) {
      metrics.syncJobs.inc({ status: "failed" });
      throw err;
    }
  }
}
